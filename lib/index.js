import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CHANNEL, badRequest, err, ok, toError, validId } from './protocol.js';
import { readArtifact } from './raw-storage.js';
import { validateEvents } from './doctor-core.js';
import { applyEmptyToolChains, atomicWrite, findEmptyToolChains, repairJsonlFrames } from './repair.js';
import { backupDirectory, stableCopy } from './backup-store.js';
export const name = 'dsh-session-repair';
// Optional services are resolved through ctx.get so a missing capability becomes a reportable
// unavailable result rather than preventing the plugin from loading.
export const inject = [];
const root = join(homedir(), '.dsh', 'session-repair');
const pendingRepairs = new Map();
const REPAIR_TTL_MS = 5 * 60 * 1000;
function pruneRepairs() {
    const now = Date.now();
    for (const [id, plan] of pendingRepairs)
        if (plan.expiresAt <= now)
            pendingRepairs.delete(id);
}
function persistenceOf(ctx) { return ctx.get('sessionPersistence'); }
function projectKeyOf(path) {
    const marker = '/sessions/';
    const index = path.indexOf(marker);
    return index < 0 ? 'unknown-project' : path.slice(index + marker.length).split('/')[0] || 'unknown-project';
}
async function writeAudit(entry) {
    await mkdir(join(root, 'audit'), { recursive: true, mode: 0o700 });
    const name = 'repair-' + new Date().toISOString().replaceAll(':', '-') + '-' + entry.sessionId + '.json';
    const path = join(root, 'audit', name);
    await writeFile(path, JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 });
    return path;
}
async function locate(ctx, sessionId) {
    const p = persistenceOf(ctx);
    if (!p)
        return undefined;
    const headers = await p.list();
    const header = headers.find(x => String(x.id) === sessionId);
    if (!header)
        return undefined;
    const location = p.locate(header);
    return location?.path;
}
async function inspectSession(ctx, sessionId) {
    if (!validId(sessionId))
        return err('bad-request', 'sessionId must be a safe non-empty string');
    const path = await locate(ctx, sessionId);
    if (!path)
        return err('artifact-missing', 'session artifact is not available');
    let artifact;
    try {
        artifact = await readArtifact(path);
    }
    catch (e) {
        return err('zstd-invalid', e instanceof Error ? e.message : String(e));
    }
    const live = Boolean(ctx.get('sessions')?.get?.(sessionId) ?? ctx.get('agents')?.get?.(sessionId));
    const report = validateEvents(artifact.events, sessionId, artifact, { live });
    const merged = report;
    merged.sessionId = sessionId;
    merged.path = path;
    merged.repairPlans = findEmptyToolChains(artifact.events);
    merged.generatedAt = new Date().toISOString();
    merged.live = live;
    return ok(merged);
}
async function compareWithBackup(ctx, sessionId, backupId) {
    if (!validId(sessionId))
        return err('bad-request', 'sessionId must be a safe non-empty string');
    if (!validId(backupId) || !backupId.endsWith('.manifest.json'))
        return err('bad-request', 'backupId must be a manifest file name');
    const current = await inspectSession(ctx, sessionId);
    if (!current.ok)
        return current;
    const dir = backupDirectory(root, 'pre-repair', sessionId);
    let manifestText;
    try {
        manifestText = await readFile(join(dir, backupId), 'utf8');
    }
    catch (e) {
        return err('artifact-missing', 'backup manifest is not available');
    }
    let manifest;
    try {
        manifest = JSON.parse(manifestText);
    }
    catch {
        return err('json-invalid', 'backup manifest is not valid JSON');
    }
    const currentArtifact = current.value.artifact;
    const currentSeqs = current.value.checks;
    const newEvents = current.value.maxSeq > manifest.maxSeq ? current.value.maxSeq - manifest.maxSeq : 0;
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
    });
}
export function createHandler(ctx) {
    return async (endpoint, payload = {}) => {
        try {
            const sessionId = payload.sessionId;
            if (endpoint === 'inspect')
                return inspectSession(ctx, sessionId);
            if (endpoint === 'listBackups') {
                if (!validId(sessionId))
                    return badRequest('sessionId must be a safe non-empty string');
                const dir = backupDirectory(root, 'pre-repair', sessionId);
                try {
                    const names = await readdir(dir);
                    return ok({ root, items: names.filter(name => name.endsWith('.manifest.json')).slice(-100) });
                }
                catch (error) {
                    if (error?.code === 'ENOENT')
                        return ok({ root, items: [] });
                    throw error;
                }
            }
            if (endpoint === 'createCheckpoint') {
                const inspected = await inspectSession(ctx, sessionId);
                if (!inspected.ok)
                    return inspected;
                if (inspected.value.severity !== 'healthy' && inspected.value.severity !== 'warning')
                    return err('checkpoint-blocked', 'only healthy or warning artifacts can become trusted checkpoints');
                const projectKey = projectKeyOf(inspected.value.path);
                const saved = await stableCopy(inspected.value.path, backupDirectory(root, projectKey, sessionId), { sessionId, projectKey, cwd: null, maxSeq: inspected.value.maxSeq, trigger: 'explicit-inspect', validation: { severity: inspected.value.severity, checks: inspected.value.checks.length }, kind: 'checkpoint' });
                return ok({ checkpoint: saved });
            }
            if (endpoint === 'compareBackup')
                return compareWithBackup(ctx, sessionId, payload.backupId);
            if (endpoint === 'prepareRepair') {
                pruneRepairs();
                const inspected = await inspectSession(ctx, sessionId);
                if (!inspected.ok)
                    return inspected;
                if (inspected.value.severity !== 'repairable' || inspected.value.repairPlans.length === 0)
                    return err('repair-blocked', 'repair requires at least one deterministic plan');
                const batchId = 'batch-' + randomUUID();
                const batch = {
                    batchId,
                    sessionId,
                    path: inspected.value.path,
                    fingerprint: inspected.value.artifact,
                    plans: inspected.value.repairPlans.map(plan => ({ ...plan, sessionId })),
                    expiresAt: Date.now() + REPAIR_TTL_MS,
                };
                pendingRepairs.set(batchId, batch);
                return ok({ batchId: batch.batchId, sessionId: batch.sessionId, fingerprint: batch.fingerprint, plans: batch.plans, seqs: batch.plans.flatMap(plan => plan.seqs), expiresAt: batch.expiresAt });
            }
            if (endpoint === 'repair') {
                pruneRepairs();
                const batch = pendingRepairs.get(payload.batchId);
                if (!batch || batch.sessionId !== sessionId)
                    return err('repair-expired', 'repair plan is missing, expired, or for another session');
                const current = await readArtifact(batch.path);
                if (!current.stable || current.fingerprint.sha256 !== batch.fingerprint.sha256 || current.fingerprint.bytes !== batch.fingerprint.bytes)
                    return err('artifact-changed', 'artifact changed since repair preparation');
                const session = ctx.get('sessions')?.get?.(sessionId);
                const agent = ctx.get('agents')?.get?.(sessionId);
                if (session || agent)
                    return err('live-session', 'live or attached sessions are read-only');
                if (payload.expectedFingerprint?.sha256 !== batch.fingerprint.sha256)
                    return err('artifact-changed', 'client fingerprint does not match repair plan');
                const projectKey = projectKeyOf(batch.path);
                const pre = await stableCopy(batch.path, backupDirectory(root, projectKey, batch.sessionId), { sessionId: batch.sessionId, projectKey, cwd: null, maxSeq: Math.max(0, ...current.events.map(event => event.seq ?? 0)), trigger: 'pre-repair', validation: { kind: 'pre-repair' }, kind: 'pre-repair', trusted: false });
                const fixed = applyEmptyToolChains(current.events, batch.plans);
                const changedSeqs = batch.plans.flatMap(plan => plan.seqs);
                const bytes = repairJsonlFrames(current.bytes, fixed.events, changedSeqs);
                await atomicWrite(batch.path, bytes);
                const repaired = await readArtifact(batch.path);
                const afterReport = validateEvents(repaired.events, batch.sessionId, repaired);
                const auditPath = await writeAudit({ sessionId: batch.sessionId, seqs: changedSeqs, repairIds: batch.plans.map(plan => plan.repairId), batchId: batch.batchId, before: batch.fingerprint, after: repaired.fingerprint, preRepair: pre.id, result: afterReport.severity });
                pendingRepairs.delete(batch.batchId);
                return ok({ repaired: afterReport.severity === 'healthy' || afterReport.severity === 'warning', sessionId: batch.sessionId, preRepair: pre, auditPath, fingerprint: repaired.fingerprint, report: afterReport });
            }
            if (endpoint === 'exportReport') {
                const inspected = await inspectSession(ctx, sessionId);
                if (!inspected.ok)
                    return inspected;
                return ok({ report: inspected.value, exportedAt: new Date().toISOString() });
            }
            return badRequest('unknown endpoint: ' + endpoint);
        }
        catch (e) {
            return toError(e);
        }
    };
}
export function apply(ctx) {
    const handler = createHandler(ctx);
    let disposeRpc = () => { };
    ctx.inject(['connection'], web => { if (!web.connection)
        return; const d = web.connection.rpc.handle(CHANNEL, handler, { authority: 'loopback' }); if (typeof d === 'function')
        disposeRpc = d; });
    const skillPath = join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', 'skills', 'dsh-session-repair', 'SKILL.md');
    let disposeSkill = () => { };
    const skills = ctx.get('skills');
    if (skills?.register) {
        void readFile(skillPath, 'utf8').then(content => { disposeSkill = skills.register({ name: 'dsh-session-repair', description: 'Diagnose and safely repair corrupted DSH session history.', whenToUse: 'history unavailable or session persistence validation fails', invocation: { modelInvocable: true, userInvocable: true }, source: 'bundled', provider: name, resourceBase: { kind: 'directory', path: join(skillPath, '..') }, path: skillPath, content }); }).catch(error => ctx.logger?.warn?.('dsh-session-repair skill unavailable: ' + String(error)));
    }
    const tools = ctx.get('tools');
    if (tools?.register) {
        const disposeTool = tools.register({
            name: 'dsh_session_repair',
            description: 'Inspect a DSH session artifact and return a structured diagnostic report.',
            parameters: { sessionId: { type: 'string', required: false } },
            output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
            async execute(args, exec) {
                const id = args?.sessionId ?? exec.agent?.session?.id;
                if (!id)
                    throw new Error('sessionId is required when no current session exists');
                const result = await inspectSession(ctx, id);
                if (!result.ok)
                    throw new Error(result.error.message);
                return result.value;
            },
        });
        ctx.effect(() => disposeTool, 'dsh-session-repair tool');
    }
    return async () => {
        if (typeof disposeRpc === 'function')
            await disposeRpc();
        disposeSkill();
        pendingRepairs.clear();
    };
}
//# sourceMappingURL=index.js.map