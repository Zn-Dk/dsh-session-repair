import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CHANNEL, badRequest, err, ok, toError, validId, type Result } from './protocol.js'
import { readArtifact } from './raw-storage.js'
import { validateEvents, type ValidationReport } from './doctor-core.js'
import { applyEmptyToolChains, atomicWrite, findEmptyToolChains, repairJsonlFrames, type RepairPlan } from './repair.js'
import { backupDirectory, clearSafetySlots, stableCopy } from './backup-store.js'

export const name = 'dsh-session-repair'
// Optional services are resolved through ctx.get so a missing capability becomes a reportable
// unavailable result rather than preventing the plugin from loading.
export const inject = []
const root = join(homedir(), '.dsh', 'session-repair')
const pendingRepairs = new Map<string, RepairBatch>()
const REPAIR_TTL_MS = 5 * 60 * 1000

type Ctx = {
  get: (service: string) => unknown
  inject: (services: string[], fn: (web: { connection?: unknown }) => void) => void
  effect: (dispose: () => unknown, label: string) => void
  logger?: { warn?: (msg: string) => void }
}
interface RepairBatch {
  batchId: string
  sessionId: string
  path: string
  fingerprint: { sha256: string; bytes: number }
  plans: RepairPlan[]
  expiresAt: number
}
interface SessionPersistence {
  list: () => Promise<Array<{ id: unknown }>>
  locate: (header: { id: unknown }) => { path?: string } | undefined
}
interface SessionEventsLike { seq?: number }

function pruneRepairs() {
  const now = Date.now()
  for (const [id, plan] of pendingRepairs) if (plan.expiresAt <= now) pendingRepairs.delete(id)
}

function persistenceOf(ctx: Ctx): SessionPersistence | undefined { return ctx.get('sessionPersistence') as SessionPersistence | undefined }
function projectKeyOf(path: string) {
  const marker = '/sessions/'
  const index = path.indexOf(marker)
  return index < 0 ? 'unknown-project' : path.slice(index + marker.length).split('/')[0] || 'unknown-project'
}
async function writeAudit(entry: Record<string, unknown>) {
  await mkdir(join(root, 'audit'), { recursive: true, mode: 0o700 })
  const name = 'repair-' + new Date().toISOString().replaceAll(':', '-') + '-' + entry.sessionId + '.json'
  const path = join(root, 'audit', name)
  await writeFile(path, JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 })
  return path
}
async function locate(ctx: Ctx, sessionId: string): Promise<string | undefined> {
  const p = persistenceOf(ctx); if (!p) return undefined
  const headers = await p.list(); const header = headers.find(x => String(x.id) === sessionId)
  if (!header) return undefined
  const location = p.locate(header); return location?.path
}
async function inspectSession(ctx: Ctx, sessionId: string): Promise<Result<ValidationReport & { sessionId: string; path: string; repairPlans: RepairPlan[]; generatedAt: string; live: boolean; cleanedBackups: string[] }>> {
  if (!validId(sessionId)) return err('bad-request', 'sessionId must be a safe non-empty string')
  const path = await locate(ctx, sessionId)
  if (!path) return err('artifact-missing', 'session artifact is not available')
  let artifact
  try { artifact = await readArtifact(path) } catch (e) { return err('zstd-invalid', e instanceof Error ? e.message : String(e)) }
  const live = Boolean((ctx.get('sessions') as { get?: (id: string) => unknown } | undefined)?.get?.(sessionId) ?? (ctx.get('agents') as { get?: (id: string) => unknown } | undefined)?.get?.(sessionId))
  const report = validateEvents(artifact.events as never[], sessionId, artifact, { live })
  const merged = report as ValidationReport & { sessionId: string; path: string; repairPlans: RepairPlan[]; generatedAt: string; live: boolean; cleanedBackups: string[] }
  merged.sessionId = sessionId; merged.path = path; merged.repairPlans = findEmptyToolChains(artifact.events as never[]); merged.generatedAt = new Date().toISOString(); merged.live = live; merged.cleanedBackups = []
  // Auto-clean single-slot safety backups only when the artifact is settled and
  // healthy/warning (i.e. the repair already succeeded and the session opened
  // normally). Live sessions keep their rollback point.
  if (!live && (report.severity === 'healthy' || report.severity === 'warning')) {
    const dir = backupDirectory(root, projectKeyOf(path), sessionId)
    merged.cleanedBackups = await clearSafetySlots(dir)
  }
  return ok(merged)
}

interface BackupManifestLike {
  sha256: string
  bytes: number
  maxSeq: number
  capturedAt: string
  trigger: string
  trust: string
  sourcePath: string
}
async function compareWithBackup(ctx: Ctx, sessionId: string, backupId: string) {
  if (!validId(sessionId)) return err('bad-request', 'sessionId must be a safe non-empty string')
  if (!validId(backupId) || !backupId.endsWith('.manifest.json')) return err('bad-request', 'backupId must be a manifest file name')
  const current = await inspectSession(ctx, sessionId)
  if (!current.ok) return current
  const dir = backupDirectory(root, projectKeyOf(current.value.path), sessionId)
  let manifestText: string
  try { manifestText = await readFile(join(dir, backupId), 'utf8') } catch (e) { return err('artifact-missing', 'backup manifest is not available') }
  let manifest: BackupManifestLike
  try { manifest = JSON.parse(manifestText) } catch { return err('json-invalid', 'backup manifest is not valid JSON') }
  const currentArtifact = current.value.artifact as { sha256: string; bytes: number }
  const currentSeqs = (current.value as unknown as { checks: Array<{ seqs: number[] }> }).checks
  const newEvents = current.value.maxSeq > manifest.maxSeq ? current.value.maxSeq - manifest.maxSeq : 0
  return ok({
    sessionId,
    backupId,
    current: {
      sha256: currentArtifact.sha256,
      bytes: currentArtifact.bytes,
      maxSeq: current.value.maxSeq,
      eventCount: current.value.eventCount,
      severity: current.value.severity,
    },
    backup: {
      sha256: manifest.sha256,
      bytes: manifest.bytes,
      maxSeq: manifest.maxSeq,
      capturedAt: manifest.capturedAt,
      trigger: manifest.trigger,
      trust: manifest.trust,
    },
    sameContent: currentArtifact.sha256 === manifest.sha256 && currentArtifact.bytes === manifest.bytes,
    advanced: current.value.maxSeq > manifest.maxSeq,
    newEvents,
  })
}

export function createHandler(ctx: Ctx) { return async (endpoint: string, payload: Record<string, unknown> = {}): Promise<Result<unknown>> => { try {
  const sessionId = payload.sessionId as string
  if (endpoint === 'inspect') return inspectSession(ctx, sessionId)
  if (endpoint === 'listBackups') {
    if (!validId(sessionId)) return badRequest('sessionId must be a safe non-empty string')
    const inspected = await inspectSession(ctx, sessionId)
    if (!inspected.ok) return inspected
    const dir = backupDirectory(root, projectKeyOf(inspected.value.path), sessionId)
    try {
      const names = await readdir(dir)
      return ok({ root, items: names.filter(name => name.endsWith('.manifest.json')).slice(-100) })
    } catch (error) {
      if ((error as { code?: string })?.code === 'ENOENT') return ok({ root, items: [] })
      throw error
    }
  }
  if (endpoint === 'clearBackups') {
    if (!validId(sessionId)) return badRequest('sessionId must be a safe non-empty string')
    const inspected = await inspectSession(ctx, sessionId)
    if (!inspected.ok) return inspected
    const dir = backupDirectory(root, projectKeyOf(inspected.value.path), sessionId)
    const removed = await clearSafetySlots(dir)
    return ok({ removed, count: removed.length })
  }
  if (endpoint === 'createCheckpoint') {
    const inspected = await inspectSession(ctx, sessionId)
    if (!inspected.ok) return inspected
    if (inspected.value.severity !== 'healthy' && inspected.value.severity !== 'warning') return err('checkpoint-blocked', 'only healthy or warning artifacts can become trusted checkpoints')
    const projectKey = projectKeyOf(inspected.value.path)
    const saved = await stableCopy(inspected.value.path, backupDirectory(root, projectKey, sessionId), { sessionId, projectKey, cwd: null, maxSeq: inspected.value.maxSeq, trigger: 'explicit-inspect', validation: { severity: inspected.value.severity, checks: inspected.value.checks.length }, kind: 'checkpoint' })
    return ok({ checkpoint: saved })
  }
  if (endpoint === 'compareBackup') return compareWithBackup(ctx, sessionId, payload.backupId as string)
  if (endpoint === 'prepareRepair') {
    pruneRepairs()
    const inspected = await inspectSession(ctx, sessionId)
    if (!inspected.ok) return inspected
    if (inspected.value.severity !== 'repairable' || inspected.value.repairPlans.length === 0) return err('repair-blocked', 'repair requires at least one deterministic plan')
    const batchId = 'batch-' + randomUUID()
    const batch: RepairBatch = {
      batchId,
      sessionId,
      path: inspected.value.path,
      fingerprint: inspected.value.artifact as { sha256: string; bytes: number },
      plans: inspected.value.repairPlans.map(plan => ({ ...plan, sessionId })),
      expiresAt: Date.now() + REPAIR_TTL_MS,
    }
    pendingRepairs.set(batchId, batch)
    return ok({ batchId: batch.batchId, sessionId: batch.sessionId, fingerprint: batch.fingerprint, plans: batch.plans, seqs: batch.plans.flatMap(plan => plan.seqs), expiresAt: batch.expiresAt })
  }
  if (endpoint === 'repair') {
    pruneRepairs()
    const batch = pendingRepairs.get(payload.batchId as string)
    if (!batch || batch.sessionId !== sessionId) return err('repair-expired', 'repair plan is missing, expired, or for another session')
    const current = await readArtifact(batch.path)
    if (!current.stable || current.fingerprint.sha256 !== batch.fingerprint.sha256 || current.fingerprint.bytes !== batch.fingerprint.bytes) return err('artifact-changed', 'artifact changed since repair preparation')
    const session = (ctx.get('sessions') as { get?: (id: string) => unknown } | undefined)?.get?.(sessionId)
    const agent = (ctx.get('agents') as { get?: (id: string) => unknown } | undefined)?.get?.(sessionId)
    if (session || agent) return err('live-session', 'live or attached sessions are read-only')
    if ((payload.expectedFingerprint as { sha256?: string } | undefined)?.sha256 !== batch.fingerprint.sha256) return err('artifact-changed', 'client fingerprint does not match repair plan')
    const projectKey = projectKeyOf(batch.path)
    const backupDir = backupDirectory(root, projectKey, batch.sessionId)
    await clearSafetySlots(backupDir) // single-slot: replace the previous pre-repair rollback point
    const pre = await stableCopy(batch.path, backupDir, { sessionId: batch.sessionId, projectKey, cwd: null, maxSeq: Math.max(0, ...(current.events as SessionEventsLike[]).map(event => event.seq ?? 0)), trigger: 'pre-repair', validation: { kind: 'pre-repair' }, kind: 'pre-repair', trusted: false })
    const fixed = applyEmptyToolChains(current.events as never[], batch.plans)
    const changedSeqs = batch.plans.flatMap(plan => plan.seqs)
    const bytes = repairJsonlFrames(current.bytes, fixed.events, changedSeqs)
    await atomicWrite(batch.path, bytes)
    const repaired = await readArtifact(batch.path)
    const afterReport = validateEvents(repaired.events as never[], batch.sessionId, repaired)
    const auditPath = await writeAudit({ sessionId: batch.sessionId, seqs: changedSeqs, repairIds: batch.plans.map(plan => plan.repairId), batchId: batch.batchId, before: batch.fingerprint, after: repaired.fingerprint, preRepair: pre.id, result: afterReport.severity })
    pendingRepairs.delete(batch.batchId)
    return ok({ repaired: afterReport.severity === 'healthy' || afterReport.severity === 'warning', sessionId: batch.sessionId, preRepair: pre, auditPath, fingerprint: repaired.fingerprint, report: afterReport })
  }
  if (endpoint === 'restoreBackup') {
    if (!validId(sessionId)) return badRequest('sessionId must be a safe non-empty string')
    const backupId = payload.backupId as string
    if (!validId(backupId) || !backupId.endsWith('.manifest.json')) return badRequest('backupId must be a manifest file name')
    const inspected = await inspectSession(ctx, sessionId)
    if (!inspected.ok) return inspected
    // Restore is only offered for a broken artifact; healthy/warning has nothing to roll back.
    if (inspected.value.severity !== 'repairable' && inspected.value.severity !== 'blocked') return err('restore-blocked', 'restore is only available for repairable or blocked sessions')
    const live = Boolean((ctx.get('sessions') as { get?: (id: string) => unknown } | undefined)?.get?.(sessionId) ?? (ctx.get('agents') as { get?: (id: string) => unknown } | undefined)?.get?.(sessionId))
    if (live) return err('live-session', 'live or attached sessions are read-only')
    const projectKey = projectKeyOf(inspected.value.path)
    const dir = backupDirectory(root, projectKey, sessionId)
    let manifestText: string
    try { manifestText = await readFile(join(dir, backupId), 'utf8') } catch { return err('artifact-missing', 'backup manifest is not available') }
    let manifest: { sha256: string; bytes: number; maxSeq: number }
    try { manifest = JSON.parse(manifestText) } catch { return err('json-invalid', 'backup manifest is not valid JSON') }
    const artifactPath = join(dir, backupId.slice(0, -'.manifest.json'.length))
    let backupBytes: Buffer
    try { backupBytes = await readFile(artifactPath) } catch { return err('artifact-missing', 'backup artifact is not available') }
    const current = await readArtifact(inspected.value.path)
    if (!current.stable) return err('artifact-changed', 'artifact changed while being read')
    // Safety net: save the current broken state before overwriting it.
    await clearSafetySlots(dir)
    const pre = await stableCopy(inspected.value.path, dir, { sessionId, projectKey, cwd: null, maxSeq: current.events.length ? Math.max(0, ...(current.events as SessionEventsLike[]).map(event => event.seq ?? 0)) : 0, trigger: 'pre-restore', validation: { kind: 'pre-restore' }, kind: 'pre-restore', trusted: false })
    await atomicWrite(inspected.value.path, backupBytes)
    const restored = await readArtifact(inspected.value.path)
    const afterReport = validateEvents(restored.events as never[], sessionId, restored)
    const auditPath = await writeAudit({ sessionId, backupId, restore: true, before: current.fingerprint, after: restored.fingerprint, preRestore: pre.id, result: afterReport.severity })
    // A successful restore resolves the rollback decision: clear every safety slot
    // (including the pre-restore we just wrote) so the session starts clean and the
    // UI only offers a fresh repair — never another restore into the broken state.
    await clearSafetySlots(dir)
    return ok({ restored: afterReport.severity === 'healthy' || afterReport.severity === 'warning', sessionId, preRestore: pre, auditPath, fingerprint: restored.fingerprint, report: afterReport })
  }
  if (endpoint === 'exportReport') {
    const inspected = await inspectSession(ctx, sessionId)
    if (!inspected.ok) return inspected
    return ok({ report: inspected.value, exportedAt: new Date().toISOString() })
  }
  return badRequest('unknown endpoint: ' + endpoint)
} catch (e) { return toError(e) } } }

export function apply(ctx: Ctx) {
  const handler = createHandler(ctx)
  let disposeRpc: unknown = () => {}
  ctx.inject(['connection'], web => { if (!web.connection) return; const d = (web.connection as { rpc: { handle: (ch: string, h: unknown, opts: { authority: string }) => unknown } }).rpc.handle(CHANNEL, handler, { authority: 'loopback' }); if (typeof d === 'function') disposeRpc = d })
  const skillPath = join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', 'skills', 'dsh-session-repair', 'SKILL.md')
  let disposeSkill = () => {}
  const skills = ctx.get('skills') as { register?: (opts: Record<string, unknown>) => () => void } | undefined
  if (skills?.register) { void readFile(skillPath, 'utf8').then(content => { disposeSkill = skills.register!({ name:'dsh-session-repair', description:'Diagnose and safely repair corrupted DSH session history.', whenToUse:'history unavailable or session persistence validation fails', invocation:{modelInvocable:true,userInvocable:true}, source:'bundled', provider:name, resourceBase:{kind:'directory',path:join(skillPath,'..')}, path:skillPath, content }) }).catch(error => ctx.logger?.warn?.('dsh-session-repair skill unavailable: '+String(error))) }
  const tools = ctx.get('tools') as { register?: (opts: Record<string, unknown>) => () => void } | undefined
  if (tools?.register) {
    const disposeTool = tools.register!({
      name: 'dsh_session_repair',
      description: 'Inspect a DSH session artifact and return a structured diagnostic report.',
      parameters: { sessionId: { type: 'string', required: false } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
      async execute(args: { sessionId?: string }, exec: { agent?: { session?: { id?: string } } }) {
        const id = args?.sessionId ?? exec.agent?.session?.id
        if (!id) throw new Error('sessionId is required when no current session exists')
        const result = await inspectSession(ctx, id)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    })
    ctx.effect(() => disposeTool, 'dsh-session-repair tool')
  }
  return async () => {
    if (typeof disposeRpc === 'function') await disposeRpc()
    disposeSkill()
    pendingRepairs.clear()
  }
}
