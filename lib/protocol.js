/** Pure protocol helpers for dsh-session-repair. */
export const CHANNEL = '/dsh-session-repair';
export const DIAGNOSTIC = Object.freeze({
    ARTIFACT_MISSING: 'artifact-missing', BACKEND_UNSUPPORTED: 'backend-unsupported',
    ZSTD_INVALID: 'zstd-invalid', JSON_INVALID: 'json-invalid', SESSION_ID_MISMATCH: 'session-id-mismatch',
    SEQ_DUPLICATE: 'seq-duplicate', SEQ_GAP: 'seq-gap', SOURCE_REF_MISSING: 'source-ref-missing',
    TOOL_CALL_ID_EMPTY: 'tool-call-id-empty', TOOL_CALL_ID_MISMATCH: 'tool-call-id-mismatch',
    TOOL_CALL_UNPAIRED: 'tool-call-unpaired', TOOL_CALL_ID_REUSED: 'tool-call-id-reused',
    PROJECTION_MISMATCH: 'projection-mismatch', WORKSPACE_REFERENCE_MISMATCH: 'workspace-reference-mismatch',
    LEGACY_BACKUP: 'legacy-backup',
    // Format-admission diagnostics (DSH >= 0.1.5-rc.1). These mirror the
    // audited rules the installed engine applies when it loads a Session, so a
    // stored artifact this plugin calls healthy is one the engine accepts.
    FORMAT_VERSION_UNSUPPORTED: 'format-version-unsupported',
    SOURCE_KIND_UNCLASSIFIED: 'source-kind-unclassified',
    SOURCE_FIELD_UNEXPECTED: 'source-field-unexpected',
    USAGE_NULL_TOKEN: 'usage-null-token',
    // The engine's fail-closed event vocabulary gate: a stored event whose
    // `type` is outside the installed vocabulary AND that is not marked
    // `ignorable: true` makes the whole log uninterpretable.
    EVENT_TYPE_UNKNOWN: 'event-type-unknown',
});
/**
 * The installed engine's session format version. A stored header naming any
 * other version is either an older generation (migratable) or a corrupt value.
 */
export const SESSION_FORMAT_VERSION = 4;
/**
 * The installed engine's event vocabulary (`KNOWN_SESSION_EVENT_TYPES`).
 *
 * A stored event whose type is outside this set is refused by the engine's
 * read path UNLESS its envelope carries `ignorable: true`:
 *
 *   if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true)
 *       throw unsupported(`session "..." contains event type "..." unknown to this harness and not marked ignorable; refusing to interpret the log`)
 *
 * Third-party plugins that append their own event types therefore brick every
 * session they touch. This set lets the doctor detect that condition and plan
 * the mechanical fix (mark the event ignorable).
 */
export const KNOWN_SESSION_EVENT_TYPES = new Set([
    'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided',
    'approval/policy', 'assistant/attempt', 'assistant/message', 'command/done', 'command/run',
    'compaction/end', 'compaction/prune', 'compaction/start', 'compaction/summary',
    'deliverables/presented', 'developer/message', 'feedback/message-delete',
    'feedback/message-put', 'feedback/record', 'goal/change', 'hook/invoked', 'hook/result',
    'image/offload', 'job/registered', 'job/settled', 'llm/retry', 'llm/retry-started',
    'model/selection', 'permission/preset', 'plan/mode', 'request/context', 'request/header',
    'sandbox/mode', 'schedule/change', 'session-log-deepseek/delivery-accepted',
    'session/end-seed', 'session/title', 'session/title-llm-request', 'step/end', 'step/start',
    'subagent/catalog', 'subagent/descriptor', 'subagent/model-selection-policy',
    'system/message', 'team/member', 'team/message/delivered', 'team/message/queued',
    'team/task', 'todo/write', 'tool-workflow/agent-end', 'tool-workflow/agent-start',
    'tool-workflow/run-end', 'tool-workflow/run-start', 'tool/call', 'tool/ptc-dispatch',
    'tool/ptc-dispatch-start', 'tool/result', 'turn/end', 'turn/start', 'user/message',
    'web/deepseek-search-llm-request', 'working-directory/change', 'workspace/changes',
]);
/**
 * `message.source.kind` vocabulary enforced by the engine's V3→V4 migration
 * (`assertSource`). It applies to HISTORICAL v3 artifacts only.
 *
 * A current (v4) artifact is NOT checked against this closed set: the v4
 * reader's rule (`source()` in `dsh-session-format-v3-to-v4`) admits ANY
 * producer-owned kind — it only requires a non-empty string kind and
 * refuses the retired `plugin` wrapper. The v4 producer vocabulary is
 * therefore open-ended (first-party plugins such as `time-context`,
 * `runtime-context`, `user-approval`, `tool-registry` and `tool-jobs` are
 * lawful), and this plugin must not report them as defects.
 */
export const SOURCE_KINDS = new Set([
    'user', 'plugin', 'model', 'tool', 'agent-instructions', 'session-reference',
    'team-message', 'goal', 'skill-invocation', 'skill-catalog', 'coordinator',
    'subagent-report', 'subagent-settled', 'webhook', 'agent-message',
]);
/**
 * The source kind the v4 reader refuses outright: the retired plugin wrapper
 * is rewritten to a producer-owned kind during migration and must not appear
 * in a current artifact.
 */
export const RETIRED_SOURCE_KIND = 'plugin';
/**
 * Event types whose payloads carry an owned `message` with a `source` that the
 * engine's admission walk validates (`assertV4MessageSources`, and
 * `assertSource` for the spliced/title request carriers).
 */
export const MESSAGE_BEARING_TYPES = new Set([
    'user/message', 'developer/message', 'assistant/message', 'tool/result', 'system/message',
]);
/**
 * The one source kind whose fields are a closed set — in the V3 vocabulary
 * only. Every other kind is admitted with whatever fields its writer added,
 * so this plugin must not guess a wider vocabulary (doing so reported lawful
 * `form`/`provider` keys as defects).
 */
export const AGENT_MESSAGE_SOURCE_KEYS = ['kind', 'form', 'senderSessionId'];
export function ok(value) { return { ok: true, value }; }
export function err(code, message, details = {}) { return { ok: false, error: { code, message, details } }; }
export function badRequest(message) { return err('bad-request', message); }
export function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[/\\\u0000-\u001f]/.test(value); }
export function toError(error, fallbackCode = 'internal') {
    return error && typeof error.code === 'string' && typeof error.message === 'string'
        ? err(error.code, error.message)
        : err(fallbackCode, error instanceof Error ? error.message : String(error));
}
export function severityFor(checks) {
    if (checks.some(c => c.severity === 'blocked'))
        return 'blocked';
    if (checks.some(c => c.severity === 'repairable'))
        return 'repairable';
    if (checks.some(c => c.severity === 'warning'))
        return 'warning';
    // 'info' checks (e.g. seq-gap) are observational and never raise severity.
    return 'healthy';
}
//# sourceMappingURL=protocol.js.map
