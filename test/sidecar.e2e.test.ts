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
  stderr: string[];
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
  const stderr: string[] = [];
  proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
  const exit = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
  return { proc, messages, stderr, exit, send: (m) => proc.stdin.write(`${JSON.stringify(m)}\n`) };
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

const VIEW_TOKEN = 'a1'.repeat(32); // 64 hex, the shape the ADE host sends

describe('sidecar embedded in ADE (hello.host / ready.http)', () => {
  /** hello as the new host sends it: settings without dashboardToken, plus host.viewToken. */
  async function startEmbedded(port: number, opts: { host?: unknown; settings?: Record<string, string> } = {}): Promise<Sidecar> {
    const sc = launch({ ADE_PLUGIN_DATA_DIR: data.dir });
    running.push(sc);
    sc.send({
      v: 1,
      id: '1',
      type: 'hello',
      at: Date.now(),
      settings: { bridgeUrl: bridge.url, bridgeToken: bridge.token, dashboardPort: String(port), defaultTimezone: 'UTC', ...(opts.settings ?? {}) },
      host: 'host' in opts ? opts.host : { views: true, viewToken: VIEW_TOKEN }
    });
    await waitFor(() => sc.messages.some((m) => m.type === 'ready' || m.type === 'error'), 8000);
    return sc;
  }

  const get = (port: number, path: string, token?: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } });

  it('with dashboardPort 0 announces the REAL bound port in ready.http and authenticates the viewToken', async () => {
    const sc = await startEmbedded(0);
    const ready = sc.messages.find((m) => m.type === 'ready')!;
    expect(ready).toMatchObject({ type: 'ready', name: 'Jarvis Schedule' });
    const port = ready.http.port as number;
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThanOrEqual(1024);
    expect(sc.messages.some((m) => m.type === 'error')).toBe(false);

    const ok = await get(port, '/api/health', VIEW_TOKEN);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).data).toMatchObject({ bridgeConnected: true });
    expect((await get(port, '/api/health')).status).toBe(401);
    expect((await get(port, '/api/health', 'b2'.repeat(32))).status).toBe(401);
    expect((await get(port, '/api/health', VIEW_TOKEN.slice(0, 63))).status).toBe(401);
    // static UI stays reachable without a token (the host proxy loads it before any API call)
    expect((await get(port, '/')).status).toBe(200);
  }, 20_000);

  it('announces the configured port when it is fixed', async () => {
    const port = await freePort();
    const sc = await startEmbedded(port);
    expect(sc.messages.find((m) => m.type === 'ready')!.http).toEqual({ port });
  }, 20_000);

  it('accepts EITHER token when both dashboardToken and viewToken exist', async () => {
    const sc = await startEmbedded(0, { settings: { dashboardToken: DASH_TOKEN } });
    const port = sc.messages.find((m) => m.type === 'ready')!.http.port as number;
    expect((await get(port, '/api/health', DASH_TOKEN)).status).toBe(200);
    expect((await get(port, '/api/health', VIEW_TOKEN)).status).toBe(200);
    expect((await get(port, '/api/health', `${DASH_TOKEN}x`)).status).toBe(401);
  }, 20_000);

  it('never logs the viewToken, dashboardToken or bridge token (stdout messages and stderr)', async () => {
    const sc = await startEmbedded(0, { settings: { dashboardToken: DASH_TOKEN } });
    // provoke the other log paths: a malformed hello line carrying secrets, a repeated hello, a bad request
    sc.proc.stdin.write(`{"type":"hello","host":{"views":true,"viewToken":"${VIEW_TOKEN}"},"settings":{"bridgeToken":"${bridge.token}"\n`);
    sc.send({ v: 1, id: '2', type: 'hello', at: Date.now(), settings: {}, host: { views: true, viewToken: VIEW_TOKEN } });
    const port = sc.messages.find((m) => m.type === 'ready')!.http.port as number;
    await get(port, '/api/health', 'wrong');
    await waitFor(() => sc.messages.some((m) => m.type === 'log' && /Ignoring repeated hello/.test(m.message)), 5000);
    sc.send({ v: 1, id: '3', type: 'shutdown', at: Date.now() });
    await sc.exit;

    const everything = JSON.stringify(sc.messages) + sc.stderr.join('');
    expect(everything).not.toContain(VIEW_TOKEN);
    expect(everything).not.toContain(DASH_TOKEN);
    expect(everything).not.toContain(bridge.token);
    expect(sc.messages.some((m) => m.type === 'log' && /unparseable/.test(m.message))).toBe(true);
    expect(sc.messages.some((m) => m.type === 'log' && /Painel:/.test(m.message))).toBe(false);
  }, 20_000);

  it('older host, no dashboardToken: logs "Painel: <url> — token <t>" once, and that per-launch token works', async () => {
    const sc = await startEmbedded(0, { host: undefined });
    const ready = sc.messages.find((m) => m.type === 'ready')!;
    const port = ready.http.port as number;
    const lines = sc.messages.filter((m) => m.type === 'log' && String(m.message).startsWith('Painel:'));
    expect(lines).toHaveLength(1);
    const m = /^Painel: (http:\/\/127\.0\.0\.1:(\d+)\/) — token ([0-9a-f]{48})$/.exec(lines[0]!.message);
    expect(m).not.toBeNull();
    expect(Number(m![2])).toBe(port);
    expect((await get(port, '/api/health', m![3])).status).toBe(200);
    expect((await get(port, '/api/health', 'nope')).status).toBe(401);

    // per-launch: a restart yields a different token
    sc.send({ v: 1, id: '9', type: 'shutdown', at: Date.now() });
    await sc.exit;
    const again = await startEmbedded(0, { host: undefined });
    const second = /token ([0-9a-f]{48})$/.exec(again.messages.find((x) => x.type === 'log' && String(x.message).startsWith('Painel:'))!.message);
    expect(second![1]).not.toBe(m![3]);
  }, 30_000);

  it('a malformed host.viewToken is refused with a warning (no token echoed) and falls back to the dashboardToken', async () => {
    const sc = await startEmbedded(0, { host: { views: true, viewToken: 'not-hex-SECRET' }, settings: { dashboardToken: DASH_TOKEN } });
    const port = sc.messages.find((m) => m.type === 'ready')!.http.port as number;
    expect(sc.messages.some((m) => m.type === 'log' && m.level === 'warn' && /viewToken is malformed/.test(m.message))).toBe(true);
    expect(JSON.stringify(sc.messages)).not.toContain('not-hex-SECRET');
    expect((await get(port, '/api/health', 'not-hex-SECRET')).status).toBe(401);
    expect((await get(port, '/api/health', DASH_TOKEN)).status).toBe(200);
  }, 20_000);

  it('re-emits ready.http on every start (host restart replays hello)', async () => {
    const first = await startEmbedded(0);
    expect(first.messages.find((m) => m.type === 'ready')!.http.port).toBeGreaterThan(0);
    first.send({ v: 1, id: '2', type: 'shutdown', at: Date.now() });
    await first.exit;
    const second = await startEmbedded(0);
    expect(second.messages.find((m) => m.type === 'ready')!.http.port).toBeGreaterThan(0);
  }, 30_000);
});

