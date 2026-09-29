import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CHANNEL, badRequest, err, ok, toError, validId } from './protocol.js';
import { readArtifact } from './raw-storage.js';
import { validateEvents } from './doctor-core.js';
import { applyEmptyToolChains, atomicWrite, findEmptyToolChains, repairJsonlFrames } from './repair.js';
import { backupDirectory, clearSafetySlots, stableCopy } from './backup-store.js';
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
/**
 * The JSONL backend's session root. The backend itself takes this as
 * configuration and never exposes it, so the plugin resolves the same default
 * the shipped Web composition uses: `$DSH_HOME/sessions`.
 */
function sessionsRoot() {
    const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh');
    return join(home, 'sessions');
}
/**
 * One path segment, encoded exactly as the JSONL backend's `encodeSegment`
 * does: safe ASCII passes through, `'.'`/`'..'` and every other character
 * become `~<4 uppercase hex>`.
 */
function encodeSegment(raw) {
    if (raw.length === 0)
        throw new Error('cannot encode an empty path segment');
    if (raw === '.')
        return '~002E';
    if (raw === '..')
        return '~002E~002E';
    let out = '';
    for (let i = 0; i < raw.length; i++) {
        const code = raw.charCodeAt(i);
        const ch = String.fromCharCode(code);
        out += ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)
            ? ch
            : '~' + code.toString(16).toUpperCase().padStart(4, '0');
    }
    return out;
}
/**
 * The project directory name for one cwd, matching the backend's `projectKey`:
 * separator runs collapse to a single `-`, unsafe characters become `~<hex>`,
 * and the slug is wrapped as `--<slug>--` (empty slug becomes `root`).
 */
function projectKey(cwd) {
    if (cwd.length === 0)
        throw new Error('cannot encode an empty project path');
    let readable = '';
    let separatorRun = false;
    for (let i = 0; i < cwd.length; i++) {
        const code = cwd.charCodeAt(i);
        const ch = String.fromCharCode(code);
        if (ch === '/' || ch === '\\' || ch === ':') {
            if (!separatorRun)
                readable += '-';
            separatorRun = true;
        }
        else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
            readable += ch;
            separatorRun = false;
        }
        else {
            readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
            separatorRun = false;
        }
    }
    const slug = readable.replace(/^-+/, '') || 'root';
    return `--${slug.slice(0, 251)}--`;
}
/** Normalize either snapshot shape into the fields path resolution needs. */
function sessionRefOf(snapshot) {
    const nested = snapshot.header;
    const id = nested !== undefined ? nested.id : snapshot.id;
    if (typeof id !== 'string' || id.length === 0)
        return undefined;
    const cwd = nested !== undefined ? nested.cwd : snapshot.cwd;
    return { id, cwd: typeof cwd === 'string' ? cwd : undefined };
}
/**
 * Resolve one session's JSONL artifact path.
 *
 * Preference order:
 * 1. the backend's own `locate` (DSH <= 0.1.2);
 * 2. a path recomputed from the snapshot's `cwd` + `id` (DSH >= 0.1.5-rc.1);
 * 3. an on-disk scan of the session root for the encoded id, which covers a
 *    stored session whose header carries no `cwd` (backend files it under
 *    `_no-cwd`, but a moved/imported root may differ).
 * @param ctx - hosting context carrying the optional persistence service.
 * @param sessionId - the requested session id.
 * @returns the artifact path, or undefined when the session is not observable.
 */
async function locate(ctx, sessionId) {
    const p = persistenceOf(ctx);
    const snapshots = p === undefined ? [] : await p.list();
    const ref = snapshots.map(sessionRefOf).find(candidate => candidate?.id === sessionId);
    // 1. Backend-provided location, when this DSH still exposes it.
    if (p?.locate !== undefined) {
        const direct = p.locate({ id: sessionId });
        if (direct?.path !== undefined)
            return direct.path;
    }
    if (ref === undefined)
        return undefined;
    // 2. Recompute from the snapshot (the rc.1 path).
    const candidates = [
        join(sessionsRoot(), projectKey(ref.cwd ?? ''), encodeSegment(ref.id), 'session.jsonl.zstd'),
        join(sessionsRoot(), '_no-cwd', encodeSegment(ref.id), 'session.jsonl.zstd'),
    ];
    for (const candidate of candidates) {
        if (await exists(candidate))
            return candidate;
    }
    // 3. Last resort: scan one level of project dirs for the encoded id.
    try {
        for (const entry of await readdir(sessionsRoot())) {
            const candidate = join(sessionsRoot(), entry, encodeSegment(ref.id), 'session.jsonl.zstd');
            if (await exists(candidate))
                return candidate;
        }
    }
    catch { /* an unreadable root stays unreported here; inspect() reports it */ }
    return undefined;
}
/** Existence probe that never throws for a missing path. */
async function exists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
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
    merged.cleanedBackups = [];
    // Auto-clean single-slot safety backups only when the artifact is settled and
    // healthy/warning (i.e. the repair already succeeded and the session opened
    // normally). Live sessions keep their rollback point.
    if (!live && (report.severity === 'healthy' || report.severity === 'warning')) {
        const dir = backupDirectory(root, projectKeyOf(path), sessionId);
        merged.cleanedBackups = await clearSafetySlots(dir);
    }
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
    const dir = backupDirectory(root, projectKeyOf(current.value.path), sessionId);
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
                const inspected = await inspectSession(ctx, sessionId);
                if (!inspected.ok)
                    return inspected;
                const dir = backupDirectory(root, projectKeyOf(inspected.value.path), sessionId);
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
            if (endpoint === 'clearBackups') {
                if (!validId(sessionId))
                    return badRequest('sessionId must be a safe non-empty string');
                const inspected = await inspectSession(ctx, sessionId);
                if (!inspected.ok)
                    return inspected;
                const dir = backupDirectory(root, projectKeyOf(inspected.value.path), sessionId);
                const removed = await clearSafetySlots(dir);
                return ok({ removed, count: removed.length });
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
                const backupDir = backupDirectory(root, projectKey, batch.sessionId);
                await clearSafetySlots(backupDir); // single-slot: replace the previous pre-repair rollback point
                const pre = await stableCopy(batch.path, backupDir, { sessionId: batch.sessionId, projectKey, cwd: null, maxSeq: Math.max(0, ...current.events.map(event => event.seq ?? 0)), trigger: 'pre-repair', validation: { kind: 'pre-repair' }, kind: 'pre-repair', trusted: false });
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
            if (endpoint === 'restoreBackup') {
                if (!validId(sessionId))
                    return badRequest('sessionId must be a safe non-empty string');
                const backupId = payload.backupId;
                if (!validId(backupId) || !backupId.endsWith('.manifest.json'))
                    return badRequest('backupId must be a manifest file name');
                const inspected = await inspectSession(ctx, sessionId);
                if (!inspected.ok)
                    return inspected;
                // Restore is only offered for a broken artifact; healthy/warning has nothing to roll back.
                if (inspected.value.severity !== 'repairable' && inspected.value.severity !== 'blocked')
                    return err('restore-blocked', 'restore is only available for repairable or blocked sessions');
                const live = Boolean(ctx.get('sessions')?.get?.(sessionId) ?? ctx.get('agents')?.get?.(sessionId));
                if (live)
                    return err('live-session', 'live or attached sessions are read-only');
                const projectKey = projectKeyOf(inspected.value.path);
                const dir = backupDirectory(root, projectKey, sessionId);
                let manifestText;
                try {
                    manifestText = await readFile(join(dir, backupId), 'utf8');
                }
                catch {
                    return err('artifact-missing', 'backup manifest is not available');
                }
                let manifest;
                try {
                    manifest = JSON.parse(manifestText);
                }
                catch {
                    return err('json-invalid', 'backup manifest is not valid JSON');
                }
                const artifactPath = join(dir, backupId.slice(0, -'.manifest.json'.length));
                let backupBytes;
                try {
                    backupBytes = await readFile(artifactPath);
                }
                catch {
                    return err('artifact-missing', 'backup artifact is not available');
                }
                const current = await readArtifact(inspected.value.path);
                if (!current.stable)
                    return err('artifact-changed', 'artifact changed while being read');
                // Safety net: save the current broken state before overwriting it.
                await clearSafetySlots(dir);
                const pre = await stableCopy(inspected.value.path, dir, { sessionId, projectKey, cwd: null, maxSeq: current.events.length ? Math.max(0, ...current.events.map(event => event.seq ?? 0)) : 0, trigger: 'pre-restore', validation: { kind: 'pre-restore' }, kind: 'pre-restore', trusted: false });
                await atomicWrite(inspected.value.path, backupBytes);
                const restored = await readArtifact(inspected.value.path);
                const afterReport = validateEvents(restored.events, sessionId, restored);
                const auditPath = await writeAudit({ sessionId, backupId, restore: true, before: current.fingerprint, after: restored.fingerprint, preRestore: pre.id, result: afterReport.severity });
                // A successful restore resolves the rollback decision: clear every safety slot
                // (including the pre-restore we just wrote) so the session starts clean and the
                // UI only offers a fresh repair — never another restore into the broken state.
                await clearSafetySlots(dir);
                return ok({ restored: afterReport.severity === 'healthy' || afterReport.severity === 'warning', sessionId, preRestore: pre, auditPath, fingerprint: restored.fingerprint, report: afterReport });
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
    // The third options argument is historical: on DSH <= 0.1.1 it narrowed the trust
    // fence to loopback-only (trustedHosts = []); omitting it would widen, not narrow.
    // DSH 0.1.2 removed the parameter (loopback trust is handled by the Connection
    // service via its trustedHosts config), so it is ignored there. Keep passing it so
    // older engines stay on the stricter fence instead of falling back to deployment hosts.
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