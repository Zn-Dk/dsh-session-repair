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
export declare function repairJsonlFrames(originalBytes: Buffer, events: SessionEvent[], changedSeqs: number[]): Buffer;
export declare function atomicWrite(path: string, bytes: Buffer): Promise<void>;
export {};
//# sourceMappingURL=repair.d.ts.map