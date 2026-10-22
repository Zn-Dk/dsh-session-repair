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
export const API_CHANNEL = '/api';
/** The plugin's own namespace on that channel. */
export const CHANNEL_PATH = '/dsh-session-repair';
/** Upstream endpoints, in the order upstream declares them. */
export const RPC_ENDPOINTS = [
    'inspect',
    'listBackups',
    'clearBackups',
    'createCheckpoint',
    'compareBackup',
    'prepareRepair',
    'repair',
    'restoreBackup',
    'exportReport',
];
/** Wrap a handler result in the server-response envelope the browser expects. */
function serverResponse(rpcId, result) {
    return Response.json({ type: 'server-response', rpcId, result });
}
/** Build the exact route serving one upstream endpoint. */
export function routeFor(endpoint, handler) {
    return {
        path: `${API_CHANNEL}${CHANNEL_PATH}/${endpoint}`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
            let envelope;
            try {
                envelope = await request.json();
            }
            catch {
                return serverResponse('invalid-request', {
                    ok: false,
                    error: { code: 'gateway/bad-request', message: 'body is not JSON' },
                });
            }
            const rpcId = typeof envelope?.rpcId === 'string' ? envelope.rpcId : 'invalid-request';
            try {
                return serverResponse(rpcId, await handler(endpoint, envelope?.payload ?? {}));
            }
            catch (error) {
                return serverResponse(rpcId, {
                    ok: false,
                    error: {
                        code: 'gateway/internal',
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            }
        },
    };
}
//# sourceMappingURL=rpc-routes.js.map