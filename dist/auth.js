import { randomBytes } from 'node:crypto';
/** Shape the ADE host uses for the per-launch view token: 32 random bytes, hex. */
const VIEW_TOKEN_RE = /^[0-9a-f]{64}$/i;
/** Reads `hello.host` (new ADE only). Never throws; anything unexpected yields `viewToken: null`. */
export function parseHostHello(host) {
    if (typeof host !== 'object' || host === null || Array.isArray(host))
        return { viewToken: null, invalid: false };
    const { views, viewToken } = host;
    if (views !== true)
        return { viewToken: null, invalid: false };
    if (typeof viewToken === 'string' && VIEW_TOKEN_RE.test(viewToken))
        return { viewToken, invalid: false };
    return { viewToken: null, invalid: true };
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
