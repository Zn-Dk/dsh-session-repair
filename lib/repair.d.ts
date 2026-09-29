export interface RepairPlan {
    repairId: string;
    seqs: number[];
    callSeq: number;
    resultSeq: number;
    assistantSeq: number;
    name: string;
    sessionId?: string;
}
interface SessionEvent {
    type?: string;
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
                callId?: string;
            };
        };
        [key: string]: unknown;
    };
    sourceEventSeqs?: number[];
}
export declare function fingerprint(bytes: Buffer): {
    bytes: number;
    sha256: string;
};
export declare function findEmptyToolChains(events: SessionEvent[]): RepairPlan[];
export declare function applyEmptyToolChain(events: SessionEvent[], plan: RepairPlan): {
    events: SessionEvent[];
    callId: string;
};
export declare function applyEmptyToolChains(events: SessionEvent[], plans: RepairPlan[]): {
    events: SessionEvent[];
    callIds: Map<string, string>;
};
/**
 * One V3 format-admission repair, scoped to an exact event type.
 *
 * The event-type restriction is not incidental: an earlier revision of this
 * plugin rewrote a field on every event type and corrupted 285 sessions whose
 * unrelated events happened to carry the same key name. A plan therefore names
 * one `eventType` and only that type's events are touched.
 */
export interface FormatRepairPlan {
    repairId: string;
    /** The exact `event.type` this plan may modify. */
    eventType: string;
    /** What is being fixed, for audit output. */
    kind: 'format-version' | 'source-kind' | 'source-field' | 'usage-null';
    /** Event seqs this plan changes. */
    seqs: number[];
    /** For source-field/usage repairs: the offending key. */
    field?: string;
    /** For source-kind repairs: the replacement kind. */
    replacement?: string;
    /** The observed offending value, for audit output only. */
    observed?: unknown;
}
/**
 * Detect repairable V3 format defects as exact per-event plans.
 *
 * Only two transformations are mechanical enough to perform without inventing
 * data:
 * - a header naming a non-current version is restamped to the installed one;
 * - a `null` usage token count is dropped, because the engine requires a
 *   non-negative safe integer and `null` carries no count.
 * Unclassified `source.kind` and unadmitted `source` fields are detected by the
 * doctor but NOT planned here: choosing a lawful kind or deciding which field
 * to sacrifice is a judgement about plugin intent, so it is left to a human or
 * to the plugin that wrote the field.
 * @param events - decoded Session events, header first.
 * @returns ordered plans for the mechanical fixes only.
 */
export declare function findFormatRepairs(events: SessionEvent[]): FormatRepairPlan[];
/**
 * Apply one format plan. Only events matching the plan's exact `eventType` are
 * touched, and only the named field is changed.
 * @param events - decoded Session events.
 * @param plan - the plan returned by {@link findFormatRepairs}.
 * @returns the rewritten events and the seqs that actually changed.
 */
export declare function applyFormatRepair(events: SessionEvent[], plan: FormatRepairPlan): {
    events: SessionEvent[];
    changedSeqs: number[];
};
export declare function repairJsonlFrames(originalBytes: Buffer, events: SessionEvent[], changedSeqs: number[]): Buffer;
export declare function atomicWrite(path: string, bytes: Buffer): Promise<void>;
export {};
//# sourceMappingURL=repair.d.ts.map