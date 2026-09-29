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
    FORMAT_VERSION_UNSUPPORTED: "format-version-unsupported";
    SOURCE_KIND_UNCLASSIFIED: "source-kind-unclassified";
    SOURCE_FIELD_UNEXPECTED: "source-field-unexpected";
    USAGE_NULL_TOKEN: "usage-null-token";
}>;
/**
 * The installed engine's session format version. A stored header naming any
 * other version is either an older generation (migratable) or a corrupt value.
 */
export declare const SESSION_FORMAT_VERSION = 3;
/** Audited `message.source.kind` vocabulary (engine `SOURCE_KINDS`). */
export declare const SOURCE_KINDS: ReadonlySet<string>;
/**
 * Event types whose payloads carry an owned `message` with a `source` that the
 * engine's admission walk validates (engine `assertEvent`, and
 * `assertSource` for the spliced/title request carriers).
 */
export declare const MESSAGE_BEARING_TYPES: ReadonlySet<string>;
/**
 * The one source kind whose fields are a closed set. The engine validates
 * `source` field names only on this branch; every other kind is admitted with
 * whatever fields its writer added, so this plugin must not guess a wider
 * vocabulary (doing so reported lawful `form`/`provider` keys as defects).
 */
export declare const AGENT_MESSAGE_SOURCE_KEYS: readonly string[];
export declare function ok<T>(value: T): Result<T>;
export declare function err(code: string, message: string, details?: Record<string, unknown>): Result<never>;
export declare function badRequest(message: string): Result<never>;
export declare function validId(value: unknown): value is string;
export declare function toError(error: unknown, fallbackCode?: string): Result<never>;
export declare function severityFor(checks: DiagnosticCheck[]): Severity;
//# sourceMappingURL=protocol.d.ts.map