import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BridgeClient } from '../src/bridge.js';
import { ScheduleService } from '../src/service.js';
import { Store } from '../src/store.js';
import type { Config } from '../src/types.js';
import { startFakeBridge, type FakeBridge, type FakeBridgeOptions } from './fake-bridge.mjs';

export const TOKEN = 'dashboard-token-123456';

export function makeTmp(prefix = 'jsp-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function baseConfig(bridge: FakeBridge, overrides: Partial<Config> = {}): Config {
  return {
    bridgeUrl: bridge.url,
    bridgeToken: bridge.token,
    dashboardPort: 0,
    dashboardToken: TOKEN,
    defaultTimezone: 'UTC',
    historyRetentionDays: 90,
    enabled: true,
    ...overrides
  };
}

export interface Harness {
  bridge: FakeBridge;
  clock: { now: number };
  dataDir: string;
  logs: string[];
  /** Builds a fresh service over the SAME data dir — i.e. simulates a plugin restart. */
  newService(overrides?: Partial<Config>): ScheduleService;
  service: ScheduleService;
  cleanup: () => Promise<void>;
}

/** A fake bridge + a data dir + a service driven by a controllable clock. */
export async function harness(start = Date.UTC(2026, 8, 19, 10, 0, 0), configOverrides: Partial<Config> = {}, bridgeOptions: FakeBridgeOptions = {}): Promise<Harness> {
  const bridge = await startFakeBridge(bridgeOptions);
  const tmp = makeTmp();
  const clock = { now: start };
  const logs: string[] = [];
  const log = (level: string, message: string): void => void logs.push(`${level}: ${message}`);
  const newService = (overrides: Partial<Config> = {}): ScheduleService =>
    new ScheduleService({
      config: baseConfig(bridge, { ...configOverrides, ...overrides }),
      store: new Store(tmp.dir, log),
      bridge: new BridgeClient({ baseUrl: bridge.url, token: bridge.token, timeoutMs: 3000 }),
      log,
      version: 'test',
      now: () => clock.now,
      retryDelayMs: 30_000
    });
  const service = newService();
  return {
    bridge,
    clock,
    dataDir: tmp.dir,
    logs,
    newService,
    service,
    cleanup: async () => {
      service.stop();
      await bridge.stop();
      tmp.cleanup();
    }
  };
}

export const scheduleBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Daily report',
  briefing: 'Summarise yesterday.',
  workspaceId: 'ws-1',
  time: '12:00',
  days: [0, 1, 2, 3, 4, 5, 6],
  timezone: 'UTC',
  squadId: null,
  enabled: true,
  ...over
});

export async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timed out${last ? `: ${String(last)}` : ''}`);
}
