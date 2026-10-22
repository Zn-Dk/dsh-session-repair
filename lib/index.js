import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { badRequest, err, ok, toError, validId } from './protocol.js';
import { RPC_ENDPOINTS, routeFor } from './rpc-routes.js';
import { readArtifact } from './raw-storage.js';
import { validateEvents } from './doctor-core.js';
import { applyEmptyToolChains, applyFormatRepairs, atomicWrite, findEmptyToolChains, findFormatRepairs, repairJsonlFrames } from './repair.js';
import { backupDirectory, clearSafetySlots, stableCopy } from './backup-store.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
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
 * The generation filenames a session directory may contain, newest first.
 *
 * DSH names the artifact per immutable Session format generation: version
 * zero kept the bare `session.jsonl.zstd`, every later generation carries a
 * lowercase numeric component (`session.v4.jsonl.zstd` on DSH 0.2.x). The
 * engine's own rule lives in `dsh-session-persistence-jsonl`
 * (`generationLogFilename`), but the generation a session uses depends on
 * when it was written, so the directory is read instead of guessed.
 */
const GENERATION_FILENAMES = [
    'session.v4.jsonl.zstd',
    'session.v3.jsonl.zstd',
    'session.v2.jsonl.zstd',
    'session.v1.jsonl.zstd',
    'session.jsonl.zstd',
];
/**
 * List the artifact files present in one session directory, newest generation
 * first, so the newest committed generation wins.
 */
async function artifactCandidates(dir) {
    let entries;
    try {
        entries = await readdir(dir);
    }
    catch {
        return [];
    }
    const files = entries.filter(entry => entry.endsWith('.jsonl.zstd'));
    const known = GENERATION_FILENAMES.filter(name => files.includes(name));
    const rest = files.filter(name => !known.includes(name));
    return [...known, ...rest].map(name => join(dir, name));
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
    if (ref === undefined)
        return undefined;
    // 1. Backend-provided location, when this DSH still exposes it.
    //
    //    DSH 0.2.x still has `locate`, but it needs the session's `cwd` (it
    //    recomputes the project directory from it) and it answers with the
    //    CURRENT generation's path. Calling it with only an id therefore
    //    resolves to `_no-cwd`, and the answer can name a generation the
    //    session was not actually stored under. It is therefore only a hint:
    //    the authoritative path is read from the session directory below.
    if (p?.locate !== undefined) {
        const direct = p.locate({ id: sessionId, cwd: ref.cwd });
        if (direct?.path !== undefined && (await exists(direct.path)))
            return direct.path;
    }
    // 2. Recompute from the snapshot (the rc.1 path), reading the session
    //    directory so the generation filename is discovered, not guessed.
    const dirs = [
        join(sessionsRoot(), projectKey(ref.cwd ?? ''), encodeSegment(ref.id)),
        join(sessionsRoot(), '_no-cwd', encodeSegment(ref.id)),
    ];
    for (const dir of dirs) {
        for (const candidate of await artifactCandidates(dir)) {
            if (await exists(candidate))
                return candidate;
        }
    }
    // 3. Last resort: scan one level of project dirs for the encoded id.
    try {
        for (const entry of await readdir(sessionsRoot())) {
            for (const candidate of await artifactCandidates(join(sessionsRoot(), entry, encodeSegment(ref.id)))) {
                if (await exists(candidate))
                    return candidate;
            }
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
/**
 * Apply every plan in a batch.
 *
 * Two plan families exist and both are deterministic:
 * - tool-chain plans (`callId`/`assistantSeq`/`resultSeq` fields) are applied
 *   by {@link applyEmptyToolChains};
 * - format plans (`kind: 'mark-ignorable' | 'usage-null' | 'format-version'`)
 *   are applied by {@link applyFormatRepairs}.
 *
 * The two families touch disjoint events, so applying one family and then the
 * other over the same event list is safe and keeps each family's own
 * bookkeeping intact.
 * @param events - decoded Session events.
 * @param plans - the batch's plans.
 * @returns the rewritten events and the seqs that actually changed.
 */
function applyRepairPlans(events, plans) {
    const toolPlans = plans.filter(plan => plan.kind === undefined || plan.kind === null);
    const formatPlans = plans.filter(plan => plan.kind !== undefined && plan.kind !== null);
    const changed = new Set();
    let out = events;
    if (toolPlans.length > 0) {
        const result = applyEmptyToolChains(out, toolPlans);
        out = result.events;
        for (const plan of toolPlans)
            for (const seq of plan.seqs)
                changed.add(seq);
    }
    if (formatPlans.length > 0) {
        const result = applyFormatRepairs(out, formatPlans);
        out = result.events;
        for (const seq of result.changedSeqs)
            changed.add(seq);
    }
    return { events: out, changedSeqs: [...changed] };
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
    // Format plans (unknown event types, null usage tokens, stale header
    // version) are deterministic too, so they belong in the same plan list.
    // The unknown-event-type plan is what lets a session that a third-party
    // plugin bricked be repaired instead of reported as an unfixable
    // "blocked" artifact.
    merged.repairPlans = [...merged.repairPlans, ...findFormatRepairs(artifact.events)];
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
                // A session whose artifact the engine refuses to open is
                // reported as `blocked`, but it can still carry deterministic
                // plans (notably the unknown-event-type plan). Refusing to
                // prepare a repair for any non-`repairable` severity made
                // exactly those unopenable sessions unrepairable, which is
                // the one case the user needs help with most.
                if (inspected.value.repairPlans.length === 0)
                    return err('repair-blocked', 'repair requires at least one deterministic plan');
                if (inspected.value.severity !== 'repairable' && inspected.value.severity !== 'blocked')
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
                const fixed = applyRepairPlans(current.events, batch.plans);
                const changedSeqs = fixed.changedSeqs;
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
    // DSH 0.2.x compatibility.
    //
    // The pre-0.2 registration form — `connection.rpc.handle(CHANNEL, handler, { authority: 'loopback' })` —
    // no longer works on DSH 0.2.1-rc.2: it registers a NEW route on the `connection`
    // plugin's own context, which does not provide the `webServer` service, so it throws
    // `cannot get property "webServer" without inject` and this Host half never activates.
    // The browser then receives HTTP 405 for every endpoint on the channel path.
    //
    // On 0.2.x the `connection` service mounts one shared `/api` channel, and a plugin
    // serves its own endpoints as exact routes on it through `connection.fetch.register`.
    // The endpoint contract (paths, payloads, result envelopes) is unchanged.
    ctx.inject(['connection'], web => {
        if (!web.connection)
            return;
        const connection = web.connection;
        for (const endpoint of RPC_ENDPOINTS) {
            const dispose = connection.fetch.register(routeFor(endpoint, handler));
            if (typeof dispose === 'function') {
                const previous = disposeRpc;
                disposeRpc = () => { if (typeof previous === 'function')
                    previous(); dispose(); };
            }
        }
    });
    const skillPath = join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', 'skills', 'dsh-session-repair', 'SKILL.md');
    let disposeSkill = () => { };
    const skills = ctx.get('skills');
    if (skills?.register) {
        void readFile(skillPath, 'utf8').then(content => { disposeSkill = skills.register({ name: 'dsh-session-repair', description: 'Diagnose and safely repair corrupted DSH session history.', whenToUse: 'history unavailable or session persistence validation fails', invocation: { modelInvocable: true, userInvocable: true }, source: 'bundled', provider: name, resourceBase: { kind: 'directory', path: join(skillPath, '..') }, path: skillPath, content }); }).catch(error => ctx.logger?.warn?.('dsh-session-repair skill unavailable: ' + String(error)));
    }
    const tools = ctx.get('tools');
    if (tools?.register) {
        // DSH 0.2.x compatibility.
        //
        // `tools.register` expects the tool's `parameters` to already BE a raw JSON
        // Schema. The author-facing property map (`{ sessionId: { type: 'string' } }`)
        // is the `defineTool` input form, and registering it directly produced an
        // invalid tool schema on DSH 0.2.x — every LLM request then failed with
        // `Invalid schema for function 'dsh_session_repair'`. `defineTool` is the
        // shipped way to compile that map into the schema `register` validates.
        const disposeTool = tools.register(defineTool({
            name: 'dsh_session_repair',
            description: 'Inspect a DSH session artifact and return a structured diagnostic report.',
            parameters: { sessionId: { type: 'string' } },
            output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
            async execute(args, exec) {
                const id = args?.sessionId ?? exec.agent?.session?.id;
                if (!id)
                    throw new Error('sessionId is required when no current session exists');
                const result = await inspectSession(ctx, id);
                if (!result.ok)
                    throw new Error(result.error.message);
                // The tool's canonical value must be JSON-compatible; the report is
                // a plain diagnostic object, so it is returned as-is.
                return result.value;
            },
        }));
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