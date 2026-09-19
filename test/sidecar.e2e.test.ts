import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startFakeBridge, type FakeBridge } from './fake-bridge.mjs';
import { makeTmp, waitFor } from './helpers.js';

/**
 * End-to-end: the REAL built sidecar (dist/index.js) speaking the JSONL
 * protocol, against the fake bridge. `npm test` builds first (pretest).
 */
const ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const DASH_TOKEN = 'e2e-dashboard-token-1';

interface Sidecar {
  proc: ChildProcessWithoutNullStreams;
  messages: Array<Record<string, any>>;
  exit: Promise<number | null>;
  send(msg: unknown): void;
}

function launch(env: Record<string, string>): Sidecar {
  const proc = spawn('node', [ENTRY], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const messages: Array<Record<string, any>> = [];
  createInterface({ input: proc.stdout }).on('line', (line) => {
    try {
      messages.push(JSON.parse(line));
    } catch {
      messages.push({ type: 'unparseable', line });
    }
  });
  const exit = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
  return { proc, messages, exit, send: (m) => proc.stdin.write(`${JSON.stringify(m)}\n`) };
}

let bridge: FakeBridge;
let data: { dir: string; cleanup: () => void };
const running: Sidecar[] = [];

beforeEach(async () => {
  bridge = await startFakeBridge();
  data = makeTmp('jsp-e2e-');
});
afterEach(async () => {
  for (const s of running.splice(0)) s.proc.kill('SIGKILL');
  await bridge.stop();
  data.cleanup();
});

async function start(port: number, settings: Record<string, string> = {}): Promise<Sidecar> {
  const sc = launch({ ADE_PLUGIN_DATA_DIR: data.dir });
  running.push(sc);
  sc.send({
    v: 1,
    id: '1',
    type: 'hello',
    at: Date.now(),
    settings: {
      bridgeUrl: bridge.url,
      bridgeToken: bridge.token,
      dashboardPort: String(port),
      dashboardToken: DASH_TOKEN,
      defaultTimezone: 'UTC',
      ...settings
    }
  });
  await waitFor(() => sc.messages.some((m) => m.type === 'ready' || m.type === 'error'), 8000);
  return sc;
}

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

const api = (port: number, path: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { Authorization: `Bearer ${DASH_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } }).then(async (r) => ({
    status: r.status,
    json: (await r.json()) as any
  }));

describe('sidecar (dist/index.js)', () => {
  it('has a built dist', () => {
    expect(existsSync(ENTRY)).toBe(true);
  });

  it('answers hello with ready, serves the API, dispatches, tracks to finished, exits 0 on shutdown', async () => {
    const port = await freePort();
    const sc = await start(port);
    expect(sc.messages.find((m) => m.type === 'ready')).toMatchObject({ type: 'ready', name: 'Jarvis Schedule' });
    expect(sc.messages.some((m) => m.type === 'error')).toBe(false);

    expect((await api(port, '/api/health')).json.data).toMatchObject({ bridgeConnected: true, timezone: 'UTC' });
    const created = await api(port, '/api/schedules', { method: 'POST', body: JSON.stringify({ name: 'E2E', briefing: 'Do the thing', workspaceId: 'ws-1', time: '03:00', days: [0, 1, 2, 3, 4, 5, 6], timezone: 'UTC', squadId: null, enabled: true }) });
    expect(created.status).toBe(201);
    const run = await api(port, `/api/schedules/${created.json.data.id}/run`, { method: 'POST' });
    expect(run.json.data.status).toBe('running');
    expect(bridge.createRequests).toHaveLength(1);
    expect(bridge.createRequests[0]!.body.brief).toContain('Do the thing');

    bridge.finishMission(bridge.missions[0].id, { summary: 'E2E summary', tasks: [{ title: 'T', result: 'R' }] });
    const finished = await waitFor(async () => {
      const r = await api(port, `/api/runs/${run.json.data.id}`);
      return r.json.data.status === 'finished' ? r.json.data : null;
    });
    expect(finished).toMatchObject({ summary: 'E2E summary', result: { costUsd: 0.42, tasks: [{ title: 'T', status: 'done', result: 'R' }] } });

    sc.send({ v: 1, id: '2', type: 'shutdown', at: Date.now() });
    expect(await sc.exit).toBe(0);
  }, 30_000);

  it('a restart (hello replayed) does not re-dispatch the slot it already dispatched', async () => {
    // Seed a schedule whose slot was 1 minute ago (inside the grace window) and armed an hour ago.
    const now = new Date();
    const slot = new Date(now.getTime() - 60_000);
    const hhmm = `${String(slot.getUTCHours()).padStart(2, '0')}:${String(slot.getUTCMinutes()).padStart(2, '0')}`;
    mkdirSync(join(data.dir, 'runs'), { recursive: true });
    writeFileSync(
      join(data.dir, 'schedules.json'),
      JSON.stringify({
        version: 1,
        schedules: [
          { id: 'seeded', name: 'Seeded', briefing: 'Seeded briefing', workspaceId: 'ws-1', time: hhmm, days: [0, 1, 2, 3, 4, 5, 6], timezone: 'UTC', squadId: null, enabled: true, createdAt: now.toISOString(), updatedAt: now.toISOString(), armedAt: now.getTime() - 3_600_000 }
        ]
      })
    );
    const port = await freePort();

    const first = await start(port);
    await waitFor(() => bridge.createRequests.length === 1, 8000);
    first.send({ v: 1, id: '2', type: 'shutdown', at: Date.now() });
    expect(await first.exit).toBe(0);

    for (let i = 0; i < 2; i++) {
      const again = await start(port);
      expect(again.messages.some((m) => m.type === 'error')).toBe(false);
      const runs = await api(port, '/api/runs');
      expect(runs.json.data).toHaveLength(1);
      expect(runs.json.data[0]).toMatchObject({ trigger: 'schedule', status: 'running', scheduleId: 'seeded' });
      await new Promise((r) => setTimeout(r, 300));
      again.send({ v: 1, id: '3', type: 'shutdown', at: Date.now() });
      expect(await again.exit).toBe(0);
    }
    expect(bridge.createRequests).toHaveLength(1);
  }, 40_000);

  it('emits an error (and stays alive, exits 0 on shutdown) when required settings are missing', async () => {
    const sc = launch({ ADE_PLUGIN_DATA_DIR: data.dir });
    running.push(sc);
    sc.send({ v: 1, id: '1', type: 'hello', at: Date.now(), settings: { dashboardToken: DASH_TOKEN } });
    await waitFor(() => sc.messages.some((m) => m.type === 'error'), 5000);
    expect(sc.messages.find((m) => m.type === 'error')!.message).toContain('bridgeToken');
    sc.send({ v: 1, id: '2', type: 'shutdown', at: Date.now() });
    expect(await sc.exit).toBe(0);
  }, 15_000);

  it('never crashes on garbage input and exits 0 when stdin closes', async () => {
    const sc = launch({ ADE_PLUGIN_DATA_DIR: data.dir });
    running.push(sc);
    sc.proc.stdin.write('not json\n{"no":"type"}\n[]\n\n');
    await waitFor(() => sc.messages.filter((m) => m.type === 'log' && m.level === 'warn').length >= 1, 5000);
    sc.proc.stdin.end();
    expect(await sc.exit).toBe(0);
  }, 15_000);
});
