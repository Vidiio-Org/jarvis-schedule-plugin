import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiServer } from '../src/api.js';
import { canonicalTimezone } from '../src/time.js';
import { harness, makeTmp, scheduleBody, TOKEN, type Harness } from './helpers.js';

let h: Harness;
let api: ApiServer;
let base: string;
let ui: { dir: string; cleanup: () => void };

async function boot(bridgeOptions = {}): Promise<void> {
  h = await harness(undefined, {}, bridgeOptions);
  ui = makeTmp('jsp-ui-');
  api = new ApiServer({ service: h.service, tokens: [TOKEN], port: 0, uiDir: ui.dir, log: () => undefined });
  base = `http://127.0.0.1:${await api.start()}`;
}

afterEach(async () => {
  await api?.stop();
  await h?.cleanup();
  ui?.cleanup();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await res.json()) as { ok: boolean; data?: any; code?: string; message?: string };
  return { status: res.status, json };
}

const MAESTROS = [
  { id: 'claude-code', label: 'Claude Code', available: true },
  { id: 'codex', label: 'Codex', available: false }
];

describe('schedule input against the Bridge catalog (Bridge reachable)', () => {
  beforeEach(async () => {
    await boot({ maestros: MAESTROS });
  });

  it('accepts a valid schedule with no warnings', async () => {
    const r = await call('POST', '/api/schedules', scheduleBody({ squadId: 'squad-1', maestro: 'claude-code', modelPool: ['claude-sonnet-5'], agentModels: { developer: 'claude-haiku-4-5' } }));
    expect(r.status).toBe(201);
    expect(r.json.data.warnings).toEqual([]);
  });

  it.each([
    ['workspaceId', { workspaceId: 'ws-does-not-exist' }],
    ['squadId', { squadId: 'squad-does-not-exist' }],
    ['maestro', { maestro: 'no-such-maestro' }],
    ['modelPool', { modelPool: ['claude-sonnet-5', 'no-such-model'] }],
    ['agentModels', { squadId: 'squad-1', agentModels: { 'no-such-agent': 'claude-sonnet-5' } }],
    ['agentModels', { squadId: 'squad-1', agentModels: { developer: 'no-such-model' } }],
    ['agentModels', { agentModels: { developer: 'claude-sonnet-5' } }] // no squad → no agent to assign to
  ])('POST rejects an invalid %s with 400 VALIDATION_ERROR naming the field', async (field, over) => {
    const r = await call('POST', '/api/schedules', scheduleBody(over));
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(r.json.message).toMatch(new RegExp(`^${field}:`));
    expect((await call('GET', '/api/schedules')).json.data).toHaveLength(0); // nothing was stored
  });

  it('PUT rejects them too and leaves the stored schedule untouched', async () => {
    const created = (await call('POST', '/api/schedules', scheduleBody())).json.data;
    for (const [field, over] of [
      ['workspaceId', { workspaceId: 'ghost' }],
      ['squadId', { squadId: 'ghost' }],
      ['maestro', { maestro: 'ghost' }],
      ['modelPool', { modelPool: ['ghost'] }],
      ['agentModels', { squadId: 'squad-1', agentModels: { ghost: 'claude-sonnet-5' } }]
    ] as const) {
      const r = await call('PUT', `/api/schedules/${created.id}`, scheduleBody(over));
      expect(r.status, field).toBe(400);
      expect(r.json.message).toMatch(new RegExp(`^${field}:`));
    }
    const [stored] = (await call('GET', '/api/schedules')).json.data;
    expect(stored).toMatchObject({ workspaceId: 'ws-1', squadId: null, maestro: null, modelPool: [] });
  });

  it('a maestro that exists but is not available is accepted with a warning', async () => {
    const r = await call('POST', '/api/schedules', scheduleBody({ maestro: 'codex' }));
    expect(r.status).toBe(201);
    expect(r.json.data.warnings).toHaveLength(1);
    expect(r.json.data.warnings[0]).toMatch(/codex.*not available/);
    expect((await call('PUT', `/api/schedules/${r.json.data.id}`, scheduleBody({ maestro: 'codex' }))).json.data.warnings).toHaveLength(1);
  });

  it('does not compare the agent adapter with the model adapter: any catalog model fits any agent', async () => {
    // developer is a claude agent, reviewer a codex agent; the model implies the CLI.
    const over = { squadId: 'squad-1', agentModels: { developer: 'gpt-5.6-luna', reviewer: 'gemini-3-flash', architect: 'claude-haiku-4-5' } };
    const r = await call('POST', '/api/schedules', scheduleBody(over));
    expect(r.status).toBe(201);
    expect(r.json.data.warnings).toEqual([]);
    await call('POST', `/api/schedules/${r.json.data.id}/run`);
    expect(h.bridge.createRequests[0]!.body.agentModels).toEqual(over.agentModels);
  });

  it('GET /api/schedules carries no warnings (they are a save-time answer only)', async () => {
    await call('POST', '/api/schedules', scheduleBody({ maestro: 'codex' }));
    expect((await call('GET', '/api/schedules')).json.data[0]).not.toHaveProperty('warnings');
  });
});

describe('Bridge down', () => {
  beforeEach(async () => {
    await boot();
    await h.bridge.stop();
  });

  it('accepts unknown ids and answers with warnings that say what was not validated', async () => {
    const body = scheduleBody({ workspaceId: 'ws-unknown', squadId: 'squad-unknown', maestro: 'nobody', modelPool: ['m'], agentModels: { a: 'm' } });
    const created = await call('POST', '/api/schedules', body);
    expect(created.status).toBe(201);
    expect(created.json.data.warnings).toHaveLength(1);
    expect(created.json.data.warnings[0]).toMatch(/could not be reached.*not validated/);
    expect(created.json.data.workspaceName).toBeNull();

    const updated = await call('PUT', `/api/schedules/${created.json.data.id}`, body);
    expect(updated.status).toBe(200);
    expect(updated.json.data.warnings).toHaveLength(1);
  });

  it('still rejects a malformed body (shape errors need no Bridge)', async () => {
    const r = await call('POST', '/api/schedules', scheduleBody({ time: '25:00' }));
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/^time:/);
  });
});

describe('old Bridge (no catalog.models)', () => {
  it('saves model selection with a warning that it will not be sent; other ids are still validated', async () => {
    await boot({ legacy: true });
    const ok = await call('POST', '/api/schedules', scheduleBody({ squadId: 'squad-1', modelPool: ['anything'], agentModels: { developer: 'anything' } }));
    expect(ok.status).toBe(201);
    expect(ok.json.data.warnings).toHaveLength(1);
    expect(ok.json.data.warnings[0]).toMatch(/does not support model selection/);
    const bad = await call('POST', '/api/schedules', scheduleBody({ workspaceId: 'ghost' }));
    expect(bad.status).toBe(400);
  });
});

describe('timezone canonicalisation', () => {
  it('fixes the case through Intl and leaves aliases as typed', () => {
    expect(canonicalTimezone('america/sao_paulo')).toBe('America/Sao_Paulo');
    expect(canonicalTimezone('AMERICA/SAO_PAULO')).toBe('America/Sao_Paulo');
    expect(canonicalTimezone(' europe/lisbon ')).toBe('Europe/Lisbon');
    expect(canonicalTimezone('utc')).toBe('UTC');
    expect(canonicalTimezone('US/Pacific')).toBe('US/Pacific');
    expect(canonicalTimezone('Not/AZone')).toBeNull();
    expect(canonicalTimezone('')).toBeNull();
    expect(canonicalTimezone(3)).toBeNull();
  });

  it('is stored canonical on POST and PUT; an invalid zone is still a 400', async () => {
    await boot();
    const created = await call('POST', '/api/schedules', scheduleBody({ timezone: 'america/sao_paulo' }));
    expect(created.json.data.timezone).toBe('America/Sao_Paulo');
    const updated = await call('PUT', `/api/schedules/${created.json.data.id}`, scheduleBody({ timezone: 'europe/lisbon' }));
    expect(updated.json.data.timezone).toBe('Europe/Lisbon');
    expect((await call('GET', '/api/schedules')).json.data[0].timezone).toBe('Europe/Lisbon');
    const bad = await call('POST', '/api/schedules', scheduleBody({ timezone: 'america/nowhere' }));
    expect(bad.status).toBe(400);
    expect(bad.json.message).toMatch(/^timezone:/);
  });
});
