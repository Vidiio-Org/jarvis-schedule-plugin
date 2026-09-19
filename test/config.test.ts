import { describe, expect, it } from 'vitest';

import { ConfigError, loadSettings, resolveConfig } from '../src/config.js';
import { parseScheduleInput, ValidationError } from '../src/validation.js';

const good = { bridgeToken: 'bt', dashboardToken: 'a-long-enough-token' };

describe('resolveConfig', () => {
  it('applies defaults', () => {
    const { config } = resolveConfig(good);
    expect(config).toMatchObject({
      bridgeUrl: 'http://127.0.0.1:4820',
      dashboardPort: 4870,
      defaultTimezone: 'America/Sao_Paulo',
      historyRetentionDays: 90,
      enabled: true
    });
  });

  it('host.bridge overrides the settings entirely (even an invalid bridgeUrl) and needs no bridgeToken', () => {
    const { config } = resolveConfig({ bridgeUrl: 'ftp://ignored', bridgeToken: 'settings-token' }, { url: 'http://127.0.0.1:5123/', token: 'host-token' });
    expect(config).toMatchObject({ bridgeUrl: 'http://127.0.0.1:5123', bridgeToken: 'host-token', bridgeSource: 'host' });
    expect(resolveConfig({}, { url: 'http://127.0.0.1:5123', token: 'host-token' }).config.bridgeSource).toBe('host');
  });

  it('without host.bridge the settings are the fallback (source "settings")', () => {
    expect(resolveConfig(good).config).toMatchObject({ bridgeToken: 'bt', bridgeSource: 'settings' });
    expect(resolveConfig(good, null).config.bridgeSource).toBe('settings');
    expect(() => resolveConfig({})).toThrow(/bridgeToken.*ADE_BRIDGE=1/);
  });

  it('requires bridgeToken; dashboardToken is optional (the host authenticates the embedded view)', () => {
    expect(() => resolveConfig({ dashboardToken: 'a-long-enough-token' })).toThrow(ConfigError);
    expect(resolveConfig({ bridgeToken: 'bt' }).config.dashboardToken).toBeNull();
  });

  it('rejects a short dashboard token', () => {
    expect(() => resolveConfig({ ...good, dashboardToken: 'short' })).toThrow(/at least 12/);
  });

  it('parses strings from the host', () => {
    const { config } = resolveConfig({
      ...good,
      bridgeUrl: 'http://10.0.0.5:4999/',
      dashboardPort: '5000',
      historyRetentionDays: '30',
      enabled: 'false',
      defaultTimezone: 'Europe/Lisbon'
    });
    expect(config).toMatchObject({ bridgeUrl: 'http://10.0.0.5:4999', dashboardPort: 5000, historyRetentionDays: 30, enabled: false, defaultTimezone: 'Europe/Lisbon' });
  });

  it('rejects a bad port and bad url; warns on bad timezone/retention', () => {
    expect(() => resolveConfig({ ...good, dashboardPort: 'abc' })).toThrow(ConfigError);
    expect(() => resolveConfig({ ...good, bridgeUrl: 'ftp://x' })).toThrow(ConfigError);
    const r = resolveConfig({ ...good, defaultTimezone: 'Nope/Zone', historyRetentionDays: '-3' });
    expect(r.config.defaultTimezone).toBe('America/Sao_Paulo');
    expect(r.config.historyRetentionDays).toBe(90);
    expect(r.warnings).toHaveLength(2);
  });
});

describe('loadSettings', () => {
  it('overlays hello settings on ADE_PLUGIN_SETTINGS', () => {
    const { settings, warning } = loadSettings({ b: '2' }, { ADE_PLUGIN_SETTINGS: '{"a":"1","b":"x"}' });
    expect(settings).toEqual({ a: '1', b: '2' });
    expect(warning).toBeNull();
  });

  it('never throws on garbage', () => {
    expect(loadSettings(undefined, { ADE_PLUGIN_SETTINGS: '{nope' }).warning).toMatch(/not valid JSON/);
    expect(loadSettings(undefined, { ADE_PLUGIN_SETTINGS: '[]' }).warning).toMatch(/not a JSON object/);
  });
});

describe('parseScheduleInput', () => {
  const ok = { name: ' Daily ', briefing: 'do it', workspaceId: 'ws', time: '08:30' };

  it('normalises and applies defaults', () => {
    expect(parseScheduleInput(ok, 'America/Sao_Paulo')).toEqual({
      name: 'Daily',
      briefing: 'do it',
      workspaceId: 'ws',
      time: '08:30',
      days: [0, 1, 2, 3, 4, 5, 6],
      timezone: 'America/Sao_Paulo',
      squadId: null,
      enabled: true,
      maestro: null,
      e2e: false,
      stack: { backend: [], frontend: [], mobile: [], infra: [], other: [] },
      modelPool: [],
      agentModels: {}
    });
  });

  it('sorts and dedupes days', () => {
    expect(parseScheduleInput({ ...ok, days: [5, 1, 1, 3] }, 'UTC').days).toEqual([1, 3, 5]);
  });

  it.each([
    [{ ...ok, name: '' }, /name/],
    [{ ...ok, briefing: '  ' }, /briefing/],
    [{ ...ok, workspaceId: 3 }, /workspaceId/],
    [{ ...ok, time: '8:30' }, /time/],
    [{ ...ok, time: '24:00' }, /time/],
    [{ ...ok, days: [] }, /days/],
    [{ ...ok, days: [7] }, /days/],
    [{ ...ok, days: ['1'] }, /days/],
    [{ ...ok, timezone: 'Nope/Zone' }, /timezone/],
    [{ ...ok, squadId: 5 }, /squadId/],
    [{ ...ok, enabled: 'yes' }, /enabled/],
    ['nope', /body/]
  ])('rejects %j', (input, message) => {
    expect(() => parseScheduleInput(input, 'UTC')).toThrow(ValidationError);
    expect(() => parseScheduleInput(input, 'UTC')).toThrow(message);
  });
});
