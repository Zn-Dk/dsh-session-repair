import { type DiagnosticCheck, type Severity } from './protocol.js';
export interface ValidateOptions {
    live?: boolean;
}
export interface ValidationReport {
    severity: Severity;
    checks: DiagnosticCheck[];
    maxSeq: number;
    eventCount: number;
    artifact: unknown;
}
interface SessionEvent {
    type?: string;
    id?: string;
    seq?: number;
    data?: {
        turn?: number;
        step?: number;
        callId?: string;
        name?: string;
        message?: {
            content?: Array<{
                type?: string;
                id?: string;
                name?: string;
                toolCallId?: string;
            }>;
            source?: {
                kind?: string;
                callId?: string;
            };
        };
        [key: string]: unknown;
    };
}
export declare function validateEvents(events: SessionEvent[], requestedSessionId: string, artifact?: {
    stable?: boolean;
    fingerprint?: unknown;
}, options?: ValidateOptions): ValidationReport;
export {};
//# sourceMappingURL=doctor-core.d.ts.map