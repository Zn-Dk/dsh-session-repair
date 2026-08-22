/** Pure protocol helpers for dsh-session-repair. */
export type Severity = 'healthy' | 'warning' | 'repairable' | 'blocked';
export type CheckSeverity = Severity | 'info';
export interface DiagnosticCheck {
    code: string;
    severity: CheckSeverity;
    message: string;
    seqs: number[];
    details: Record<string, unknown>;
}
export type Result<T = unknown> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
};
export declare const CHANNEL = "/dsh-session-repair";
export declare const DIAGNOSTIC: Readonly<{
    ARTIFACT_MISSING: "artifact-missing";
    BACKEND_UNSUPPORTED: "backend-unsupported";
    ZSTD_INVALID: "zstd-invalid";
    JSON_INVALID: "json-invalid";
    SESSION_ID_MISMATCH: "session-id-mismatch";
    SEQ_DUPLICATE: "seq-duplicate";
    SEQ_GAP: "seq-gap";
    SOURCE_REF_MISSING: "source-ref-missing";
    TOOL_CALL_ID_EMPTY: "tool-call-id-empty";
    TOOL_CALL_ID_MISMATCH: "tool-call-id-mismatch";
    TOOL_CALL_UNPAIRED: "tool-call-unpaired";
    TOOL_CALL_ID_REUSED: "tool-call-id-reused";
    PROJECTION_MISMATCH: "projection-mismatch";
    WORKSPACE_REFERENCE_MISMATCH: "workspace-reference-mismatch";
    LEGACY_BACKUP: "legacy-backup";
}>;
export declare function ok<T>(value: T): Result<T>;
export declare function err(code: string, message: string, details?: Record<string, unknown>): Result<never>;
export declare function badRequest(message: string): Result<never>;
export declare function validId(value: unknown): value is string;
export declare function toError(error: unknown, fallbackCode?: string): Result<never>;
export declare function severityFor(checks: DiagnosticCheck[]): Severity;
//# sourceMappingURL=protocol.d.ts.map