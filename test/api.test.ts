import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiServer } from '../src/api.js';
import { harness, makeTmp, scheduleBody, TOKEN, type Harness } from './helpers.js';

let h: Harness;
let api: ApiServer;
let base: string;
let ui: { dir: string; cleanup: () => void };
let secret: { dir: string; cleanup: () => void };

beforeEach(async () => {
  h = await harness();
  ui = makeTmp('jsp-ui-');
  secret = makeTmp('jsp-secret-');
  writeFileSync(join(ui.dir, 'index.html'), '<!doctype html><title>x</title>');
  writeFileSync(join(ui.dir, 'app.js'), 'export {}');
  writeFileSync(join(ui.dir, 'styles.css'), 'body{}');
  writeFileSync(join(ui.dir, '.hidden'), 'nope');
  mkdirSync(join(ui.dir, 'dev'));
  writeFileSync(join(ui.dir, 'dev', 'mock-server.mjs'), 'console.log("mock")');
  writeFileSync(join(secret.dir, 'secret.txt'), 'TOP SECRET');
  symlinkSync(join(secret.dir, 'secret.txt'), join(ui.dir, 'leak.txt'));
  api = new ApiServer({ service: h.service, token: TOKEN, port: 0, uiDir: ui.dir, log: () => undefined });
  base = `http://127.0.0.1:${await api.start()}`;
});

afterEach(async () => {
  await api.stop();
  await h.cleanup();
  ui.cleanup();
  secret.cleanup();
});

const auth = { Authorization: `Bearer ${TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = auth) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await res.json()) as { ok: boolean; data?: any; code?: string; message?: string };
  return { status: res.status, json, headers: res.headers };
}

/** Raw HTTP so we can send an arbitrary Host header / raw path (fetch forbids both). */
function raw(path: string, headers: Record<string, string>): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const port = Number(new URL(base).port);
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers, setHost: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('auth, host and CORS', () => {
  it('requires the bearer token on every /api route', async () => {
    for (const [m, p] of [['GET', '/api/health'], ['GET', '/api/schedules'], ['POST', '/api/schedules'], ['GET', '/api/runs'], ['GET', '/api/nope']] as const) {
      const r = await call(m, p, m === 'POST' ? {} : undefined, {});
      expect(r.status, `${m} ${p}`).toBe(401);
      expect(r.json).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    }
    expect((await call('GET', '/api/health', undefined, { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await call('GET', '/api/health', undefined, { Authorization: TOKEN })).status).toBe(401);
    expect((await call('GET', `/api/health?token=${TOKEN}`, undefined, {})).status).toBe(401);
  });

  it('rejects non-localhost Host headers (DNS rebinding), API and static alike', async () => {
    for (const path of ['/api/health', '/', '/app.js']) {
      const r = await raw(path, { Host: 'evil.example.com', Authorization: `Bearer ${TOKEN}` });
      expect(r.status, path).toBe(403);
      expect(JSON.parse(r.body)).toMatchObject({ ok: false, code: 'FORBIDDEN_HOST' });
    }
    const port = new URL(base).port;
    expect((await raw('/api/health', { Host: `localhost:${port}`, Authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await raw('/api/health', { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await raw('/api/health', { Host: `127.0.0.1:${Number(port) + 1}`, Authorization: `Bearer ${TOKEN}` })).status).toBe(403);
    // no Host at all: node itself answers 400 for HTTP/1.1 before our handler runs — rejected either way
    expect([400, 403]).toContain((await raw('/api/health', { Authorization: `Bearer ${TOKEN}` })).status);
  });

  it('sends no CORS headers and does not answer preflights permissively', async () => {
    const res = await fetch(`${base}/api/schedules`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
    const ok = await call('GET', '/api/health');
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();
    expect(ok.headers.get('content-type')).toContain('application/json');
  });
});

describe('read endpoints', () => {
  it('GET /api/health', async () => {
    const r = await call('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ version: 'test', bridgeConnected: true, timezone: 'UTC' });
    expect(Number.isNaN(Date.parse(r.json.data.now))).toBe(false);
  });

  it('reports bridgeConnected=false when the Bridge is gone', async () => {
    await h.bridge.stop();
    const r = await call('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.json.data.bridgeConnected).toBe(false);
    h.bridge = await (await import('./fake-bridge.mjs')).startFakeBridge(); // so cleanup has something to stop
  });

  it('GET /api/workspaces and /api/catalog come from the bridge', async () => {
    expect((await call('GET', '/api/workspaces')).json.data).toEqual([
      { id: 'ws-1', name: 'Demo workspace', path: '/tmp/demo-workspace' },
      { id: 'ws-2', name: 'Second workspace', path: '/tmp/second-workspace' }
    ]);
    const catalog = (await call('GET', '/api/catalog')).json.data;
    expect(catalog.available).toBe(true);
    expect(catalog.squads[0]).toMatchObject({ id: 'squad-1', name: 'Demo squad' });
    expect(catalog.squads[0].agents.map((a: { agentId: string }) => a.agentId)).toEqual(['architect', 'developer', 'reviewer']);
    expect(catalog.maestros.map((m: { id: string }) => m.id)).toContain('claude-code');
    expect(catalog.models.map((m: { id: string }) => m.id)).toContain('claude-sonnet-5');
  });

  it('502 BRIDGE_UNAVAILABLE for workspaces, [] squads, when the Bridge is down', async () => {
    await h.bridge.stop();
    const ws = await call('GET', '/api/workspaces');
    expect(ws.status).toBe(502);
    expect(ws.json).toMatchObject({ ok: false, code: 'BRIDGE_UNAVAILABLE' });
    expect((await call('GET', '/api/catalog')).json).toEqual({ ok: true, data: { available: false, squads: [], maestros: [] } });
    h.bridge = await (await import('./fake-bridge.mjs')).startFakeBridge();
  });
});

describe('schedules', () => {
  it('create -> list -> update -> delete with the documented shapes', async () => {
    const created = await call('POST', '/api/schedules', scheduleBody());
    expect(created.status).toBe(201);
    const s = created.json.data;
    expect(s).toMatchObject({ name: 'Daily report', workspaceName: 'Demo workspace', time: '12:00', timezone: 'UTC', squadId: null, enabled: true, lastRunAt: null });
    expect(Object.keys(s).sort()).toEqual(
      ['agentModels', 'attachments', 'briefing', 'createdAt', 'days', 'e2e', 'enabled', 'id', 'lastRunAt', 'maestro', 'modelPool', 'name', 'nextRunAt', 'squadId', 'stack', 'time', 'timezone', 'updatedAt', 'warnings', 'workspaceId', 'workspaceName'].sort()
    );
    expect(s).not.toHaveProperty('armedAt');
    expect(typeof s.nextRunAt).toBe('string');

    expect((await call('GET', '/api/schedules')).json.data).toHaveLength(1);

    const updated = await call('PUT', `/api/schedules/${s.id}`, scheduleBody({ name: 'Renamed', enabled: false }));
    expect(updated.status).toBe(200);
    expect(updated.json.data).toMatchObject({ id: s.id, name: 'Renamed', enabled: false, nextRunAt: null });

    const del = await call('DELETE', `/api/schedules/${s.id}`);
    expect(del.status).toBe(200);
    expect(del.json).toEqual({ ok: true, data: null });
    expect((await call('GET', '/api/schedules')).json.data).toEqual([]);
  });

  it('400 VALIDATION_ERROR names the field', async () => {
    const r = await call('POST', '/api/schedules', scheduleBody({ time: '25:61' }));
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(r.json.message).toContain('time');
    expect((await call('POST', '/api/schedules', scheduleBody({ days: [9] }))).json.message).toContain('days');
    expect((await call('POST', '/api/schedules', scheduleBody({ timezone: 'Foo/Bar' }))).json.message).toContain('timezone');
    const bad = await fetch(`${base}/api/schedules`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{oops' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('413 for oversized bodies', async () => {
    const res = await fetch(`${base}/api/schedules`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ briefing: 'x'.repeat(2 * 1024 * 1024) }) }).catch(() => null);
    // the server may also just reset the connection after refusing the body
    expect(res === null || res.status === 413).toBe(true);
  });

  it('404 NOT_FOUND for unknown schedule / run / route, 405 for wrong method', async () => {
    expect((await call('PUT', '/api/schedules/nope', scheduleBody())).json).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect((await call('DELETE', '/api/schedules/nope')).status).toBe(404);
    expect((await call('POST', '/api/schedules/nope/run')).status).toBe(404);
    expect((await call('GET', '/api/runs/nope')).status).toBe(404);
    expect((await call('GET', '/api/nope')).status).toBe(404);
    expect((await call('DELETE', '/api/health')).status).toBe(405);
  });
});

describe('runs', () => {
  it('POST /api/schedules/:id/run dispatches now and GET /api/runs shows it', async () => {
    const s = (await call('POST', '/api/schedules', scheduleBody({ time: '23:59' }))).json.data;
    const run = await call('POST', `/api/schedules/${s.id}/run`);
    expect(run.status).toBe(200);
    expect(run.json.data).toMatchObject({ scheduleId: s.id, scheduleName: 'Daily report', trigger: 'manual', status: 'running', scheduledFor: null, error: null, summary: null, result: null });
    expect(Object.keys(run.json.data).sort()).toEqual(
      ['dispatchedAt', 'error', 'finishedAt', 'id', 'missionId', 'missionName', 'options', 'result', 'scheduleId', 'scheduleName', 'scheduledFor', 'status', 'summary', 'trigger'].sort()
    );
    expect(h.bridge.createRequests).toHaveLength(1);

    h.bridge.finishMission(h.bridge.missions[0].id, { summary: 'Resumo\ncom linhas', tasks: [{ title: 't1', result: 'r1' }] });
    await h.service.pollRuns();

    const list = await call('GET', `/api/runs?scheduleId=${s.id}&limit=5`);
    expect(list.json.data).toHaveLength(1);
    const one = await call('GET', `/api/runs/${run.json.data.id}`);
    expect(one.json.data).toMatchObject({ status: 'finished', summary: 'Resumo\ncom linhas', result: { costUsd: 0.42, tasks: [{ title: 't1', status: 'done', result: 'r1' }] } });
    expect((await call('GET', '/api/runs?limit=abc')).status).toBe(400);
    expect((await call('GET', '/api/runs?scheduleId=other')).json.data).toEqual([]);
  });

  it('manual run answers 502 BRIDGE_UNAVAILABLE when the Bridge is down, but still records the run', async () => {
    const s = (await call('POST', '/api/schedules', scheduleBody())).json.data;
    await h.bridge.stop();
    const r = await call('POST', `/api/schedules/${s.id}/run`);
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ ok: false, code: 'BRIDGE_UNAVAILABLE' });
    expect((await call('GET', '/api/runs')).json.data[0]).toMatchObject({ status: 'dispatch_failed', trigger: 'manual' });
    h.bridge = await (await import('./fake-bridge.mjs')).startFakeBridge();
  });

  it('manual run with a rejected mission returns the run as dispatch_failed (not 502)', async () => {
    const s = (await call('POST', '/api/schedules', scheduleBody())).json.data;
    h.bridge.state.workspaces.splice(0, h.bridge.state.workspaces.length); // the workspace vanishes after the schedule was saved
    const r = await call('POST', `/api/schedules/${s.id}/run`);
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ status: 'dispatch_failed' });
    expect(r.json.data.error).toContain('NOT_FOUND');
  });
});

describe('static files', () => {
  it('serves index.html at / and assets with correct types, no auth needed', async () => {
    const root = await fetch(`${base}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(root.headers.get('x-content-type-options')).toBe('nosniff');
    expect(root.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect((await fetch(`${base}/app.js`)).headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect((await fetch(`${base}/styles.css`)).headers.get('content-type')).toBe('text/css; charset=utf-8');
  });

  it('blocks path traversal, dotfiles, ui/dev, symlink escapes', async () => {
    const targets = [
      '/../package.json',
      '/%2e%2e/package.json',
      '/..%2fpackage.json',
      '/%2e%2e%2f%2e%2e%2fetc/passwd',
      '/a/../../package.json',
      '/.hidden',
      '/dev/mock-server.mjs',
      '/leak.txt',
      '/%00.html',
      '/..\\package.json',
      '/%zz'
    ];
    for (const t of targets) {
      const r = await raw(t, { Host: new URL(base).host });
      expect([400, 404], `${t} -> ${r.status}`).toContain(r.status);
      expect(r.body).not.toContain('TOP SECRET');
      expect(r.body).not.toContain('"jarvis-schedule"');
    }
  });

  it('non-GET on static paths is 405; missing files are 404', async () => {
    expect((await fetch(`${base}/app.js`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });

  it('a missing ui/index.html gives a friendly 404 at / but the API still works', async () => {
    const empty = makeTmp('jsp-empty-');
    const other = new ApiServer({ service: h.service, token: TOKEN, port: 0, uiDir: empty.dir, log: () => undefined });
    const p = await other.start();
    const r = await fetch(`http://127.0.0.1:${p}/`);
    expect(r.status).toBe(404);
    expect(await r.text()).toContain('not installed');
    expect((await fetch(`http://127.0.0.1:${p}/api/health`, { headers: auth })).status).toBe(200);
    await other.stop();
    empty.cleanup();
  });
});
