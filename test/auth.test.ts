import { describe, expect, it } from 'vitest';

import { parseHostHello, resolveApiTokens } from '../src/auth.js';
// @ts-expect-error plain browser ES module, no types
import { apiHeaders, isEmbedded } from '../ui/auth.js';

const HEX64 = 'ab'.repeat(32);

describe('parseHostHello', () => {
  it('reads the viewToken when host.views is true and the token is 64 hex', () => {
    expect(parseHostHello({ views: true, viewToken: HEX64 })).toEqual({ viewToken: HEX64, invalid: false, bridge: null, bridgeInvalid: false });
    expect(parseHostHello({ views: true, viewToken: HEX64.toUpperCase() }).viewToken).toBe(HEX64.toUpperCase());
  });

  it('treats an absent host (older ADE) as no token, not as an error', () => {
    for (const host of [undefined, null, 'x', 42, [], {}, { views: false, viewToken: HEX64 }, { viewToken: HEX64 }]) {
      expect(parseHostHello(host)).toEqual({ viewToken: null, invalid: false, bridge: null, bridgeInvalid: false });
    }
  });

  it('flags a malformed token without returning it', () => {
    for (const viewToken of [undefined, '', 'short', 'zz'.repeat(32), `${HEX64}0`, HEX64.slice(1), 123, null]) {
      expect(parseHostHello({ views: true, viewToken })).toEqual({ viewToken: null, invalid: true, bridge: null, bridgeInvalid: false });
    }
  });
});

describe('parseHostHello — host.bridge', () => {
  it('reads {url, token}, trimming and dropping trailing slashes, with or without host.views', () => {
    expect(parseHostHello({ bridge: { url: ' http://127.0.0.1:5123/ ', token: ' tok ' } }).bridge).toEqual({ url: 'http://127.0.0.1:5123', token: 'tok' });
    const both = parseHostHello({ views: true, viewToken: HEX64, bridge: { url: 'http://127.0.0.1:1', token: 't' } });
    expect(both).toEqual({ viewToken: HEX64, invalid: false, bridge: { url: 'http://127.0.0.1:1', token: 't' }, bridgeInvalid: false });
  });

  it('absent host.bridge (older ADE) is not an error', () => {
    expect(parseHostHello({ views: true, viewToken: HEX64 })).toMatchObject({ bridge: null, bridgeInvalid: false });
    expect(parseHostHello({ bridge: null })).toMatchObject({ bridge: null, bridgeInvalid: false });
  });

  it('flags an unusable bridge without returning it', () => {
    for (const bridge of ['x', 5, [], {}, { url: 'http://x' }, { token: 't' }, { url: 'http://x', token: '  ' }, { url: 'ftp://x', token: 't' }, { url: 'nope', token: 't' }, { url: 1, token: 't' }]) {
      expect(parseHostHello({ bridge })).toMatchObject({ bridge: null, bridgeInvalid: true });
    }
  });
});

describe('resolveApiTokens', () => {
  it('accepts dashboardToken and viewToken together', () => {
    expect(resolveApiTokens({ dashboardToken: 'dash-token-123456', viewToken: HEX64 })).toEqual({ tokens: ['dash-token-123456', HEX64], fallbackToken: null });
  });

  it('uses whichever exists, with no fallback', () => {
    expect(resolveApiTokens({ dashboardToken: 'dash-token-123456', viewToken: null })).toEqual({ tokens: ['dash-token-123456'], fallbackToken: null });
    expect(resolveApiTokens({ dashboardToken: null, viewToken: HEX64 })).toEqual({ tokens: [HEX64], fallbackToken: null });
  });

  it('generates a random per-launch fallback only when neither exists', () => {
    const a = resolveApiTokens({ dashboardToken: null, viewToken: null });
    const b = resolveApiTokens({ dashboardToken: null, viewToken: null });
    expect(a.fallbackToken).toMatch(/^[0-9a-f]{48}$/);
    expect(a.tokens).toEqual([a.fallbackToken]);
    expect(a.fallbackToken).not.toBe(b.fallbackToken);
    expect(resolveApiTokens({ dashboardToken: null, viewToken: null }, () => 'fixed').tokens).toEqual(['fixed']);
  });
});

describe('ui/auth.js (login-free embedded mode)', () => {
  it('detects only the ade-plugin: scheme', () => {
    expect(isEmbedded('ade-plugin:')).toBe(true);
    for (const p of ['http:', 'https:', 'file:', '', 'ade-plugin']) expect(isEmbedded(p)).toBe(false);
  });

  it('embedded: sends NO Authorization header (the host proxy injects it), whatever token is in memory', () => {
    expect(apiHeaders({ protocol: 'ade-plugin:', token: 'leaked', hasBody: false })).toEqual({});
    expect(apiHeaders({ protocol: 'ade-plugin:', token: '', hasBody: true })).toEqual({ 'Content-Type': 'application/json' });
  });

  it('browser: sends the typed dashboard token as a bearer', () => {
    expect(apiHeaders({ protocol: 'http:', token: 't0k', hasBody: false })).toEqual({ Authorization: 'Bearer t0k' });
    expect(apiHeaders({ protocol: 'http:', token: 't0k', hasBody: true })).toEqual({ Authorization: 'Bearer t0k', 'Content-Type': 'application/json' });
  });
});
