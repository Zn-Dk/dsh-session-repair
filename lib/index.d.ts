import { type Result } from './protocol.js';
export declare const name = "dsh-session-repair";
export declare const inject: never[];
type Ctx = {
    get: (service: string) => unknown;
    inject: (services: string[], fn: (web: {
        connection?: unknown;
    }) => void) => void;
    effect: (dispose: () => unknown, label: string) => void;
    logger?: {
        warn?: (msg: string) => void;
    };
};
export declare function createHandler(ctx: Ctx): (endpoint: string, payload?: Record<string, unknown>) => Promise<Result<unknown>>;
export declare function apply(ctx: Ctx): () => Promise<void>;
export {};
//# sourceMappingURL=index.d.ts.map