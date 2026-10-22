/**
 * DSH 0.2.x compatibility helpers for the dsh-session-repair RPC surface.
 *
 * Background: DSH 0.2.1-rc.2 moved plugin RPC onto the shared `/api` channel
 * that the `connection` service mounts. A plugin now registers its endpoints
 * as exact routes through `connection.fetch.register(...)`.
 *
 * The pre-0.2 `connection.rpc.handle(CHANNEL, handler)` form no longer works:
 * it registers a NEW route on the `connection` plugin's own context, which
 * does not provide the `webServer` service, so it throws
 * `cannot get property "webServer" without inject` and the plugin's Host half
 * never activates. The browser then gets HTTP 405 for the channel path.
 *
 * These helpers only replace the registration mechanism, so the endpoint
 * contract (paths, payloads, result envelopes) stays exactly as upstream
 * defines it.
 */
/** The shared RPC channel the `connection` service mounts. */
export declare const API_CHANNEL = "/api";
/** The plugin's own namespace on that channel. */
export declare const CHANNEL_PATH = "/dsh-session-repair";
/** Upstream endpoints, in the order upstream declares them. */
export declare const RPC_ENDPOINTS: readonly ["inspect", "listBackups", "clearBackups", "createCheckpoint", "compareBackup", "prepareRepair", "repair", "restoreBackup", "exportReport"];
/** The upstream handler's result shape. */
type HandlerResult = {
    ok: boolean;
    value?: unknown;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
};
/** Build the exact route serving one upstream endpoint. */
export declare function routeFor(endpoint: string, handler: (endpoint: string, payload: Record<string, unknown>) => Promise<HandlerResult>): {
    path: string;
    methods: string[];
    requestBody: string;
    fetch: (request: Request) => Promise<Response>;
};
export {};
//# sourceMappingURL=rpc-routes.d.ts.map