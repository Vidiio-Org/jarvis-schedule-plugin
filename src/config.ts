import { isValidTimezone } from './time.js';
import type { Config } from './types.js';

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4820';
export const DEFAULT_DASHBOARD_PORT = 4870;
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_DASHBOARD_TOKEN_LENGTH = 12;

export class ConfigError extends Error {}

export type RawSettings = Record<string, string | undefined>;

export interface SettingsResult {
  settings: RawSettings;
  warning: string | null;
}

/**
 * `ADE_PLUGIN_SETTINGS` (JSON, read at process start) overlaid with the
 * `hello` event's live settings — same merge as the sibling plugins. Never throws.
 */
export function loadSettings(
  helloSettings?: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): SettingsResult {
  let base: RawSettings = {};
  let warning: string | null = null;
  const raw = env.ADE_PLUGIN_SETTINGS;
  if (raw !== undefined && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        base = parsed as RawSettings;
      } else {
        warning = 'ADE_PLUGIN_SETTINGS is not a JSON object; starting with empty settings';
      }
    } catch {
      warning = 'ADE_PLUGIN_SETTINGS is not valid JSON; starting with empty settings';
    }
  }
  return { settings: { ...base, ...(helloSettings ?? {}) }, warning };
}

function trimmed(v: string | undefined): string {
  return (v ?? '').trim();
}

export interface ResolvedConfig {
  config: Config;
  warnings: string[];
}

/** Validates settings. Throws `ConfigError` for anything that must stop the plugin from starting. */
export function resolveConfig(settings: RawSettings): ResolvedConfig {
  const warnings: string[] = [];

  const bridgeUrl = (trimmed(settings.bridgeUrl) || DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
  try {
    const u = new URL(bridgeUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
  } catch {
    throw new ConfigError(`"bridgeUrl" is not a valid http(s) URL: "${bridgeUrl}".`);
  }

  const bridgeToken = trimmed(settings.bridgeToken);
  if (bridgeToken === '') throw new ConfigError('Missing required setting "bridgeToken".');

  // Optional: inside ADE the host authenticates the embedded view; the token is only for opening the dashboard in a browser.
  const dashboardTokenRaw = trimmed(settings.dashboardToken);
  if (dashboardTokenRaw !== '' && dashboardTokenRaw.length < MIN_DASHBOARD_TOKEN_LENGTH) {
    throw new ConfigError(
      `"dashboardToken" must be at least ${MIN_DASHBOARD_TOKEN_LENGTH} characters — it guards a dashboard that can start real missions.`
    );
  }
  const dashboardToken = dashboardTokenRaw === '' ? null : dashboardTokenRaw;

  let dashboardPort = DEFAULT_DASHBOARD_PORT;
  if (trimmed(settings.dashboardPort) !== '') {
    const n = Number(trimmed(settings.dashboardPort));
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      throw new ConfigError(`"dashboardPort" must be an integer between 0 and 65535 (got "${settings.dashboardPort}").`);
    }
    dashboardPort = n;
  }

  let defaultTimezone = trimmed(settings.defaultTimezone) || DEFAULT_TIMEZONE;
  if (!isValidTimezone(defaultTimezone)) {
    warnings.push(`"defaultTimezone" "${defaultTimezone}" is not a valid IANA timezone; using ${DEFAULT_TIMEZONE}.`);
    defaultTimezone = DEFAULT_TIMEZONE;
  }

  let historyRetentionDays = DEFAULT_RETENTION_DAYS;
  if (trimmed(settings.historyRetentionDays) !== '') {
    const n = Number(trimmed(settings.historyRetentionDays));
    if (Number.isFinite(n) && n >= 1) {
      historyRetentionDays = Math.min(3650, Math.floor(n));
    } else {
      warnings.push(`"historyRetentionDays" "${settings.historyRetentionDays}" is invalid; using ${DEFAULT_RETENTION_DAYS}.`);
    }
  }

  const enabledRaw = trimmed(settings.enabled).toLowerCase();
  const enabled = !(enabledRaw === 'false' || enabledRaw === '0' || enabledRaw === 'no' || enabledRaw === 'off');

  return {
    config: { bridgeUrl, bridgeToken, dashboardPort, dashboardToken, defaultTimezone, historyRetentionDays, enabled },
    warnings
  };
}
