import { randomBytes } from 'node:crypto';

/** Shape the ADE host uses for the per-launch view token: 32 random bytes, hex. */
const VIEW_TOKEN_RE = /^[0-9a-f]{64}$/i;

export interface HostHello {
  /** Token the host injects as `Authorization: Bearer` when it proxies the embedded view. Null on older hosts. */
  viewToken: string | null;
  /** Set when the host announced `host.views` but sent a token that is not 64 hex chars (the token itself is never echoed). */
  invalid: boolean;
}

/** Reads `hello.host` (new ADE only). Never throws; anything unexpected yields `viewToken: null`. */
export function parseHostHello(host: unknown): HostHello {
  if (typeof host !== 'object' || host === null || Array.isArray(host)) return { viewToken: null, invalid: false };
  const { views, viewToken } = host as { views?: unknown; viewToken?: unknown };
  if (views !== true) return { viewToken: null, invalid: false };
  if (typeof viewToken === 'string' && VIEW_TOKEN_RE.test(viewToken)) return { viewToken, invalid: false };
  return { viewToken: null, invalid: true };
}

export interface ApiTokens {
  /** Every secret the API accepts as a bearer token (dashboardToken and/or the host viewToken). */
  tokens: string[];
  /** A random per-launch token, only when neither dashboardToken nor viewToken exists (older host, none configured). */
  fallbackToken: string | null;
}

export function resolveApiTokens(
  input: { dashboardToken: string | null; viewToken: string | null },
  generate: () => string = () => randomBytes(24).toString('hex')
): ApiTokens {
  const tokens: string[] = [];
  if (input.dashboardToken) tokens.push(input.dashboardToken);
  if (input.viewToken) tokens.push(input.viewToken);
  if (tokens.length > 0) return { tokens, fallbackToken: null };
  const fallbackToken = generate();
  return { tokens: [fallbackToken], fallbackToken };
}
