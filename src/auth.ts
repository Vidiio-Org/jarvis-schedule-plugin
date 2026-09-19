import { randomBytes } from 'node:crypto';

/** Shape the ADE host uses for the per-launch view token: 32 random bytes, hex. */
const VIEW_TOKEN_RE = /^[0-9a-f]{64}$/i;

export interface HostBridge {
  url: string;
  token: string;
}

export interface HostHello {
  /** Token the host injects as `Authorization: Bearer` when it proxies the embedded view. Null on older hosts. */
  viewToken: string | null;
  /** Set when the host announced `host.views` but sent a token that is not 64 hex chars (the token itself is never echoed). */
  invalid: boolean;
  /** Bridge credentials the host started on demand (`"bridge": true` in the manifest). Null on older hosts. */
  bridge: HostBridge | null;
  /** Set when `host.bridge` was present but unusable (not an http(s) URL / empty token). Never echoed. */
  bridgeInvalid: boolean;
}

function parseHostBridge(value: unknown): Pick<HostHello, 'bridge' | 'bridgeInvalid'> {
  if (value === undefined || value === null) return { bridge: null, bridgeInvalid: false };
  if (typeof value !== 'object' || Array.isArray(value)) return { bridge: null, bridgeInvalid: true };
  const { url, token } = value as { url?: unknown; token?: unknown };
  if (typeof url !== 'string' || typeof token !== 'string' || token.trim() === '') return { bridge: null, bridgeInvalid: true };
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { bridge: null, bridgeInvalid: true };
  } catch {
    return { bridge: null, bridgeInvalid: true };
  }
  return { bridge: { url: url.trim().replace(/\/+$/, ''), token: token.trim() }, bridgeInvalid: false };
}

/** Reads `hello.host` (new ADE only). Never throws; anything unexpected yields no token / no bridge. */
export function parseHostHello(host: unknown): HostHello {
  if (typeof host !== 'object' || host === null || Array.isArray(host)) {
    return { viewToken: null, invalid: false, bridge: null, bridgeInvalid: false };
  }
  const { views, viewToken, bridge } = host as { views?: unknown; viewToken?: unknown; bridge?: unknown };
  const b = parseHostBridge(bridge);
  if (views !== true) return { viewToken: null, invalid: false, ...b };
  if (typeof viewToken === 'string' && VIEW_TOKEN_RE.test(viewToken)) return { viewToken, invalid: false, ...b };
  return { viewToken: null, invalid: true, ...b };
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
