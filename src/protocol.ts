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
})

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
