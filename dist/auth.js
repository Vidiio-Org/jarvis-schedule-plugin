import { randomBytes } from 'node:crypto';
/** Shape the ADE host uses for the per-launch view token: 32 random bytes, hex. */
const VIEW_TOKEN_RE = /^[0-9a-f]{64}$/i;
function parseHostBridge(value) {
    if (value === undefined || value === null)
        return { bridge: null, bridgeInvalid: false };
    if (typeof value !== 'object' || Array.isArray(value))
        return { bridge: null, bridgeInvalid: true };
    const { url, token } = value;
    if (typeof url !== 'string' || typeof token !== 'string' || token.trim() === '')
        return { bridge: null, bridgeInvalid: true };
    try {
        const u = new URL(url.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
            return { bridge: null, bridgeInvalid: true };
    }
    catch {
        return { bridge: null, bridgeInvalid: true };
    }
    return { bridge: { url: url.trim().replace(/\/+$/, ''), token: token.trim() }, bridgeInvalid: false };
}
/** Reads `hello.host` (new ADE only). Never throws; anything unexpected yields no token / no bridge. */
export function parseHostHello(host) {
    if (typeof host !== 'object' || host === null || Array.isArray(host)) {
        return { viewToken: null, invalid: false, bridge: null, bridgeInvalid: false };
    }
    const { views, viewToken, bridge } = host;
    const b = parseHostBridge(bridge);
    if (views !== true)
        return { viewToken: null, invalid: false, ...b };
    if (typeof viewToken === 'string' && VIEW_TOKEN_RE.test(viewToken))
        return { viewToken, invalid: false, ...b };
    return { viewToken: null, invalid: true, ...b };
}
export function resolveApiTokens(input, generate = () => randomBytes(24).toString('hex')) {
    const tokens = [];
    if (input.dashboardToken)
        tokens.push(input.dashboardToken);
    if (input.viewToken)
        tokens.push(input.viewToken);
    if (tokens.length > 0)
        return { tokens, fallbackToken: null };
    const fallbackToken = generate();
    return { tokens: [fallbackToken], fallbackToken };
}
