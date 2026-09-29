/** Pure protocol helpers for dsh-session-repair. */

export type Severity = 'healthy' | 'warning' | 'repairable' | 'blocked'
export type CheckSeverity = Severity | 'info'

export interface DiagnosticCheck {
  code: string
  severity: CheckSeverity
  message: string
  seqs: number[]
  details: Record<string, unknown>
}

export type Result<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

export const CHANNEL = '/dsh-session-repair'
export const DIAGNOSTIC = Object.freeze({
  ARTIFACT_MISSING: 'artifact-missing', BACKEND_UNSUPPORTED: 'backend-unsupported',
  ZSTD_INVALID: 'zstd-invalid', JSON_INVALID: 'json-invalid', SESSION_ID_MISMATCH: 'session-id-mismatch',
  SEQ_DUPLICATE: 'seq-duplicate', SEQ_GAP: 'seq-gap', SOURCE_REF_MISSING: 'source-ref-missing',
  TOOL_CALL_ID_EMPTY: 'tool-call-id-empty', TOOL_CALL_ID_MISMATCH: 'tool-call-id-mismatch',
  TOOL_CALL_UNPAIRED: 'tool-call-unpaired', TOOL_CALL_ID_REUSED: 'tool-call-id-reused',
  PROJECTION_MISMATCH: 'projection-mismatch', WORKSPACE_REFERENCE_MISMATCH: 'workspace-reference-mismatch',
  LEGACY_BACKUP: 'legacy-backup',
  // V3 format-admission diagnostics (DSH >= 0.1.5-rc.1). These mirror the
  // audited rules the installed engine applies when it loads a Session, so a
  // stored artifact this plugin calls healthy is one the engine accepts.
  FORMAT_VERSION_UNSUPPORTED: 'format-version-unsupported',
  SOURCE_KIND_UNCLASSIFIED: 'source-kind-unclassified',
  SOURCE_FIELD_UNEXPECTED: 'source-field-unexpected',
  USAGE_NULL_TOKEN: 'usage-null-token',
})

/**
 * The installed engine's session format version. A stored header naming any
 * other version is either an older generation (migratable) or a corrupt value.
 */
export const SESSION_FORMAT_VERSION = 3

/** Audited `message.source.kind` vocabulary (engine `SOURCE_KINDS`). */
export const SOURCE_KINDS: ReadonlySet<string> = new Set([
  'user', 'plugin', 'model', 'tool', 'agent-instructions', 'session-reference',
  'team-message', 'goal', 'skill-invocation', 'skill-catalog', 'coordinator',
  'subagent-report', 'subagent-settled', 'webhook', 'agent-message',
])

/**
 * Event types whose payloads carry an owned `message` with a `source` that the
 * engine's admission walk validates (engine `assertEvent`, and
 * `assertSource` for the spliced/title request carriers).
 */
export const MESSAGE_BEARING_TYPES: ReadonlySet<string> = new Set([
  'user/message', 'assistant/message', 'tool/result', 'system/message',
])

/**
 * The one source kind whose fields are a closed set. The engine validates
 * `source` field names only on this branch; every other kind is admitted with
 * whatever fields its writer added, so this plugin must not guess a wider
 * vocabulary (doing so reported lawful `form`/`provider` keys as defects).
 */
export const AGENT_MESSAGE_SOURCE_KEYS: readonly string[] = ['kind', 'form', 'senderSessionId']

export function ok<T>(value: T): Result<T> { return { ok: true, value } }
export function err(code: string, message: string, details: Record<string, unknown> = {}): Result<never> { return { ok: false, error: { code, message, details } } }
export function badRequest(message: string) { return err('bad-request', message) }
export function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[/\\\u0000-\u001f]/.test(value) }
export function toError(error: unknown, fallbackCode = 'internal'): Result<never> {
  return error && typeof (error as { code?: unknown }).code === 'string' && typeof (error as { message?: unknown }).message === 'string'
    ? err((error as { code: string }).code, (error as { message: string }).message)
    : err(fallbackCode, error instanceof Error ? error.message : String(error))
}
export function severityFor(checks: DiagnosticCheck[]): Severity {
  if (checks.some(c => c.severity === 'blocked')) return 'blocked'
  if (checks.some(c => c.severity === 'repairable')) return 'repairable'
  if (checks.some(c => c.severity === 'warning')) return 'warning'
  // 'info' checks (e.g. seq-gap) are observational and never raise severity.
  return 'healthy'
}
