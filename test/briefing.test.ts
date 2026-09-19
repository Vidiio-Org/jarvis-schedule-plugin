import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiServer } from '../src/api.js';
import {
  AttachmentStore,
  MAX_ATTACHMENT_BYTES,
  MAX_SCHEDULE_ATTACHMENTS,
  PayloadTooLargeError,
  sanitizeFileName
} from '../src/attachments.js';
import { parseScheduleInput, ValidationError } from '../src/validation.js';
import { harness, makeTmp, scheduleBody, TOKEN, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => {
  await h?.cleanup();
});

const b64 = (text: string | Buffer): string => Buffer.from(text).toString('base64');
const OPTIONS = {
  squadId: 'squad-1',
  maestro: 'claude-code',
  e2e: true,
  stack: { backend: ['NestJS'], frontend: ['React', 'Vite'], mobile: [], infra: ['Docker'], other: [] },
  modelPool: ['claude-sonnet-5', 'claude-opus-5', 'gpt-5.6-terra'],
  agentModels: { developer: 'claude-haiku-4-5', reviewer: 'gpt-5.6-luna' }
};

describe('schedule option validation', () => {
  const base = scheduleBody() as Record<string, unknown>;

  it('defaults every new option', () => {
    expect(parseScheduleInput(base, 'UTC')).toMatchObject({
      maestro: null,
      e2e: false,
      stack: { backend: [], frontend: [], mobile: [], infra: [], other: [] },
      modelPool: [],
      agentModels: {}
    });
  });

  it('normalises stack, model pool and agent models', () => {
    const p = parseScheduleInput(
      { ...base, maestro: ' codex ', e2e: true, stack: { backend: [' NestJS ', 'NestJS', ''], other: ['x'] }, modelPool: ['a', 'a', ' b '], agentModels: { dev: ' m ' } },
      'UTC'
    );
    expect(p).toMatchObject({ maestro: 'codex', e2e: true, stack: { backend: ['NestJS'], other: ['x'], frontend: [] }, modelPool: ['a', 'b'], agentModels: { dev: 'm' } });
  });

  it.each([
    ['maestro', { maestro: 'Not A Maestro!' }],
    ['maestro', { maestro: 5 }],
    ['e2e', { e2e: 'yes' }],
    ['stack', { stack: [] }],
    ['stack.backend', { stack: { backend: 'NestJS' } }],
    ['stack.backend', { stack: { backend: [1] } }],
    ['modelPool', { modelPool: 'a' }],
    ['modelPool', { modelPool: [''] }],
    ['agentModels', { agentModels: [] }],
    ['agentModels', { agentModels: { dev: 3 } }]
  ])('rejects a bad %s', (field, over) => {
    expect(() => parseScheduleInput({ ...base, ...over }, 'UTC')).toThrow(ValidationError);
    expect(() => parseScheduleInput({ ...base, ...over }, 'UTC')).toThrow(new RegExp(field));
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\x\\secret.txt', 'secret.txt'],
    ['/abs/path/report.pdf', 'report.pdf'],
    ['..', 'file'],
    ['.env', 'env'],
    ['a\u0000b\nc.txt', 'abc.txt'],
    ['   ', 'file'],
    ['normal name.png', 'normal name.png']
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('bounds the length but keeps a short extension', () => {
    const out = sanitizeFileName(`${'a'.repeat(500)}.pdf`);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('AttachmentStore', () => {
  it('writes under a server-generated name, never the client-supplied one', () => {
    const tmp = makeTmp();
    try {
      const store = new AttachmentStore(tmp.dir);
      const att = store.save('sched-1', { name: '../../evil.txt', mime: 'text/plain', data: b64('hello') }, []);
      expect(att.name).toBe('evil.txt');
      expect(att.file).toMatch(/^[0-9a-f-]{36}$/);
      expect(readdirSync(join(tmp.dir, 'attachments', 'sched-1'))).toEqual([att.file]);
      expect(existsSync(join(tmp.dir, 'evil.txt'))).toBe(false);
      expect(store.read('sched-1', att)?.toString()).toBe('hello');
      store.remove('sched-1', att);
      expect(store.read('sched-1', att)).toBeNull();
    } finally {
      tmp.cleanup();
    }
  });

  it('enforces base64, size, mime, count and total limits', () => {
    const tmp = makeTmp();
    try {
      const store = new AttachmentStore(tmp.dir);
      const ok = { name: 'a.txt', mime: 'text/plain', data: b64('x') };
      expect(() => store.save('s', { ...ok, data: '***' }, [])).toThrow(ValidationError);
      expect(() => store.save('s', { ...ok, data: 'abc' }, [])).toThrow(/base64/);
      expect(() => store.save('s', { ...ok, data: 'data:text/plain;base64,eA==' }, [])).toThrow(ValidationError);
      expect(() => store.save('s', { ...ok, name: '' }, [])).toThrow(/name/);
      expect(() => store.save('s', { ...ok, mime: 'not a mime' }, [])).toThrow(/mime/);
      expect(store.save('s', { ...ok, mime: undefined }, []).mime).toBe('application/octet-stream');
      expect(() => store.save('s', { ...ok, data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1).toString('base64') }, [])).toThrow(PayloadTooLargeError);
      const many = Array.from({ length: MAX_SCHEDULE_ATTACHMENTS }, (_, i) => ({ id: `${i}`, name: 'n', mime: 'a/b', size: 1, file: `${i}` }));
      expect(() => store.save('s', ok, many)).toThrow(PayloadTooLargeError);
      const heavy = [{ id: '1', name: 'n', mime: 'a/b', size: 190 * 1024 * 1024, file: '1' }];
      expect(() => store.save('s', { ...ok, data: Buffer.alloc(11 * 1024 * 1024, 1).toString('base64') }, heavy)).toThrow(/total/);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('dispatch with the full briefing', () => {
  async function scheduleWithFiles(over: Record<string, unknown> = OPTIONS) {
    const s = await h.service.createSchedule(scheduleBody(over));
    await h.service.addAttachment(s.id, { name: 'spec.md', mime: 'text/markdown', data: b64('# Spec\nDo the thing') });
    return h.service.addAttachment(s.id, { name: 'logo.png', mime: 'image/png', data: b64(Buffer.from([137, 80, 78, 71, 0, 1, 2, 3])) });
  }

  it('sends exactly the configured fields with fresh attachment ids, and records them on the run', async () => {
    h = await harness();
    const s = await scheduleWithFiles();
    expect(s.attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size }))).toEqual([
      { name: 'spec.md', mime: 'text/markdown', size: 19 },
      { name: 'logo.png', mime: 'image/png', size: 8 }
    ]);
    expect(JSON.stringify(s)).not.toContain('"file"');

    const { run } = await h.service.runNow(s.id);
    expect(h.bridge.uploadRequests).toHaveLength(2);
    const sent = h.bridge.createRequests[0]!.body;
    expect(sent).toMatchObject({
      workspaceId: 'ws-1',
      mode: 'squad',
      squadId: 'squad-1',
      maestro: 'claude-code',
      e2e: true,
      stack: OPTIONS.stack,
      modelPool: OPTIONS.modelPool,
      agentModels: OPTIONS.agentModels
    });
    const uploaded = h.bridge.attachments;
    expect(sent.attachmentIds).toEqual(uploaded.map((a) => a.id));
    // bytes round-trip verbatim
    expect(Buffer.from(uploaded[0]!.data, 'base64').toString()).toBe('# Spec\nDo the thing');
    expect(uploaded[1]!.mime).toBe('image/png');
    // the bridge resolved them onto the mission
    expect(h.bridge.missions[0].attachments.map((a: { name: string }) => a.name)).toEqual(['spec.md', 'logo.png']);
    expect(h.bridge.missions[0].agentModels).toEqual(OPTIONS.agentModels);

    expect(run.options).toEqual({
      squadId: 'squad-1',
      maestro: 'claude-code',
      e2e: true,
      stack: OPTIONS.stack,
      modelPool: OPTIONS.modelPool,
      agentModels: OPTIONS.agentModels,
      attachments: [
        { name: 'spec.md', size: 19 },
        { name: 'logo.png', size: 8 }
      ],
      warnings: []
    });
    expect(h.service.getRun(run.id).options).toEqual(run.options);
  });

  it('re-uploads on every dispatch (the bridge pantry evicts) and passes only the fresh ids', async () => {
    h = await harness(undefined, {}, { attachmentRegistryMax: 2 });
    const s = await scheduleWithFiles({ ...OPTIONS });
    await h.service.runNow(s.id);
    const firstIds = h.bridge.createRequests[0]!.body.attachmentIds as string[];
    await h.service.runNow(s.id);
    const secondIds = h.bridge.createRequests[1]!.body.attachmentIds as string[];
    expect(h.bridge.uploadRequests).toHaveLength(4);
    expect(secondIds).toHaveLength(2);
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
    // pantry capacity is 2: only the fresh ids survive, and the second mission still resolved them
    expect(h.bridge.attachments.map((a) => a.id)).toEqual(secondIds);
    expect(h.bridge.missions[1].attachments).toHaveLength(2);
  });

  it('sends none of the new fields for a schedule that does not use them', async () => {
    h = await harness();
    const s = await h.service.createSchedule(scheduleBody());
    await h.service.runNow(s.id);
    const body = h.bridge.createRequests[0]!.body;
    for (const k of ['maestro', 'e2e', 'stack', 'attachmentIds', 'modelPool', 'agentModels']) expect(body).not.toHaveProperty(k);
    expect(h.bridge.uploadRequests).toHaveLength(0);
  });

  it('old bridge: models are never sent and the run records why', async () => {
    h = await harness(undefined, {}, { legacy: true });
    const s = await scheduleWithFiles();
    const { run } = await h.service.runNow(s.id);
    const body = h.bridge.createRequests[0]!.body;
    expect(body).not.toHaveProperty('modelPool');
    expect(body).not.toHaveProperty('agentModels');
    expect(body).toMatchObject({ squadId: 'squad-1', maestro: 'claude-code', e2e: true });
    expect(body.attachmentIds).toHaveLength(2);
    expect(run.status).toBe('running');
    expect(run.options).toMatchObject({ modelPool: [], agentModels: {} });
    expect(run.options!.warnings[0]).toMatch(/model selection/i);
    expect(h.logs.join('\n')).toMatch(/no catalog\.models/);
  });

  it('upload failure -> dispatch_failed with a clear error and no mission', async () => {
    h = await harness();
    const s = await scheduleWithFiles();
    h.bridge.state.failUpload = 1;
    const { run } = await h.service.runNow(s.id);
    expect(run.status).toBe('dispatch_failed');
    expect(run.error).toMatch(/TOO_LARGE: Could not upload attachment "spec\.md"/);
    expect(h.bridge.createRequests).toHaveLength(0);
    expect(h.bridge.missions).toHaveLength(0);
  });

  it('a file missing from disk -> dispatch_failed naming the file', async () => {
    h = await harness();
    const s = await scheduleWithFiles();
    const dir = join(h.dataDir, 'attachments', s.id);
    for (const f of readdirSync(dir)) rmSync(join(dir, f));
    const { run } = await h.service.runNow(s.id);
    expect(run.status).toBe('dispatch_failed');
    expect(run.error).toMatch(/ATTACHMENT_MISSING.*"spec\.md"/);
    expect(h.bridge.createRequests).toHaveLength(0);
  });

  it('a bridge that rejects the model selection -> dispatch_failed with its message', async () => {
    h = await harness();
    const s = await h.service.createSchedule(scheduleBody({ squadId: 'squad-1', agentModels: { developer: 'gpt-5.6-luna' } }));
    const squad = h.bridge.state.squads[0]; // the agent disappears from the squad after the schedule was saved
    squad.agents = squad.agents.filter((a: { agentId: string }) => a.agentId !== 'developer');
    const { run } = await h.service.runNow(s.id);
    expect(run.status).toBe('dispatch_failed');
    expect(run.error).toMatch(/Unknown agent "developer"/);
  });

  it('a scheduled dispatch carries the options too', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody({ ...OPTIONS, time: '12:00' }));
    h.clock.now = Date.UTC(2026, 8, 19, 12, 0, 2);
    await h.service.tick();
    expect(h.bridge.createRequests[0]!.body).toMatchObject({ maestro: 'claude-code', e2e: true, squadId: 'squad-1' });
  });
});

describe('storage', () => {
  it('editing a schedule keeps its attachments; deleting it removes the files', async () => {
    h = await harness();
    const s = await h.service.createSchedule(scheduleBody());
    const withFile = await h.service.addAttachment(s.id, { name: 'a.txt', mime: 'text/plain', data: b64('a') });
    const edited = await h.service.updateSchedule(s.id, scheduleBody({ name: 'Renamed', e2e: true }));
    expect(edited.attachments).toEqual(withFile.attachments);
    expect(edited.e2e).toBe(true);
    const dir = join(h.dataDir, 'attachments', s.id);
    expect(readdirSync(dir)).toHaveLength(1);

    const after = await h.service.removeAttachment(s.id, withFile.attachments[0]!.id);
    expect(after.attachments).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(0);
    await expect(h.service.removeAttachment(s.id, 'nope')).rejects.toThrow(/does not exist/);

    await h.service.addAttachment(s.id, { name: 'b.txt', mime: 'text/plain', data: b64('b') });
    h.service.deleteSchedule(s.id);
    expect(existsSync(dir)).toBe(false);
  });

  it('loads a schedule stored before these options existed, with defaults', async () => {
    h = await harness();
    writeFileSync(
      join(h.dataDir, 'schedules.json'),
      JSON.stringify({
        version: 1,
        schedules: [
          { id: 'old-1', name: 'Legacy', briefing: 'b', workspaceId: 'ws-1', time: '09:00', days: [1], timezone: 'UTC', squadId: null, enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', armedAt: 0 }
        ]
      })
    );
    const service = h.newService();
    const [s] = await service.listSchedules();
    expect(s).toMatchObject({ id: 'old-1', maestro: null, e2e: false, modelPool: [], agentModels: {}, attachments: [], stack: { backend: [] } });
    const { run } = await service.runNow('old-1');
    expect(run.status).toBe('running');
    expect(h.bridge.createRequests[0]!.body).not.toHaveProperty('attachmentIds');
    // and an old run file without `options` still reads
    const runFile = join(h.dataDir, 'runs', `${run.id}.json`);
    const stored = JSON.parse(readFileSync(runFile, 'utf8'));
    delete stored.options;
    writeFileSync(runFile, JSON.stringify(stored));
    expect(h.newService().getRun(run.id).options).toBeNull();
  });
});

describe('attachment REST endpoints', () => {
  let api: ApiServer;
  let base: string;
  const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = auth) => {
    const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as { ok: boolean; data?: any; code?: string; message?: string } };
  };
  const start = async (): Promise<void> => {
    h = await harness();
    const ui = makeTmp('jsp-ui-');
    writeFileSync(join(ui.dir, 'index.html'), '<!doctype html>');
    api = new ApiServer({ service: h.service, tokens: [TOKEN], port: 0, uiDir: ui.dir, log: () => undefined });
    base = `http://127.0.0.1:${await api.start()}`;
  };
  afterEach(async () => {
    await api?.stop();
  });

  it('POST adds a file (201 + schedule with attachments), DELETE removes it', async () => {
    await start();
    const s = (await call('POST', '/api/schedules', scheduleBody({ ...OPTIONS }))).json.data;
    expect(s).toMatchObject({ maestro: 'claude-code', e2e: true, modelPool: OPTIONS.modelPool, attachments: [] });

    const up = await call('POST', `/api/schedules/${s.id}/attachments`, { name: 'notes.txt', mime: 'text/plain', data: b64('hi there') });
    expect(up.status).toBe(201);
    expect(up.json.data.attachments).toEqual([{ id: expect.any(String), name: 'notes.txt', mime: 'text/plain', size: 8 }]);
    expect((await call('GET', '/api/schedules')).json.data[0].attachments).toHaveLength(1);

    const del = await call('DELETE', `/api/schedules/${s.id}/attachments/${up.json.data.attachments[0].id}`);
    expect(del.status).toBe(200);
    expect(del.json.data.attachments).toEqual([]);
    expect((await call('DELETE', `/api/schedules/${s.id}/attachments/nope`)).status).toBe(404);
  });

  it('validates the upload and the schedule id, and needs the token', async () => {
    await start();
    const s = (await call('POST', '/api/schedules', scheduleBody())).json.data;
    const url = `/api/schedules/${s.id}/attachments`;
    expect((await call('POST', url, { name: 'a', mime: 'text/plain', data: '!!!!' })).json.code).toBe('VALIDATION_ERROR');
    expect((await call('POST', url, { mime: 'text/plain', data: b64('x') })).status).toBe(400);
    expect((await call('POST', url, [])).status).toBe(400);
    expect((await call('POST', '/api/schedules/nope/attachments', { name: 'a', mime: 'text/plain', data: b64('x') })).status).toBe(404);
    expect((await call('POST', url, { name: 'a', mime: 'text/plain', data: b64('x') }, {})).status).toBe(401);
    expect((await call('GET', url)).status).toBe(405);
  });

  it('accepts a file well above the 1 MiB JSON cap, and answers 413 above the file limit', async () => {
    await start();
    const s = (await call('POST', '/api/schedules', scheduleBody())).json.data;
    const url = `/api/schedules/${s.id}/attachments`;
    const big = await call('POST', url, { name: 'big.bin', mime: 'application/octet-stream', data: b64(Buffer.alloc(3 * 1024 * 1024, 7)) });
    expect(big.status).toBe(201);
    expect(big.json.data.attachments[0].size).toBe(3 * 1024 * 1024);
    // one byte over the per-file cap, but a valid body size -> PAYLOAD_TOO_LARGE from the store
    const over = await call('POST', url, { name: 'over.bin', mime: 'application/octet-stream', data: b64(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1)) });
    expect(over.status).toBe(413);
    expect(over.json.code).toBe('PAYLOAD_TOO_LARGE');
  }, 30_000);
});
