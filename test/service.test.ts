import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AUTONOMY_REINFORCEMENT } from '../src/autonomy.js';
import { harness, scheduleBody, waitFor, type Harness } from './helpers.js';

const NOON = Date.UTC(2026, 8, 19, 12, 0, 0);
let h: Harness;
afterEach(async () => {
  await h?.cleanup();
});

describe('dispatch against the fake bridge', () => {
  it('dispatches a due slot with the briefing verbatim + autonomy reinforcement, then tracks it to finished', async () => {
    h = await harness();
    const sched = await h.service.createSchedule(scheduleBody({ briefing: 'Line one.\n  Line two — with ünïcode & <tags>' }));
    expect(sched.nextRunAt).toBe(new Date(NOON).toISOString());

    h.clock.now = NOON + 2_000;
    await h.service.tick();

    expect(h.bridge.createRequests).toHaveLength(1);
    const body = h.bridge.createRequests[0]!.body;
    expect(body.brief.startsWith('Line one.\n  Line two — with ünïcode & <tags>')).toBe(true);
    expect(body.brief).toContain(AUTONOMY_REINFORCEMENT);
    expect(body.brief).toMatch(/ask_user/);
    expect(body.brief).toMatch(/mission_finish/);
    expect(body).toMatchObject({ workspaceId: 'ws-1', mode: 'free' });
    expect(body.name).toBe('Daily report · 2026-09-19 12:00');
    expect(body).not.toHaveProperty('model');
    expect(body).not.toHaveProperty('squadId');

    const [run] = h.service.listRuns();
    expect(run).toMatchObject({ status: 'running', trigger: 'schedule', scheduleName: 'Daily report', missionId: h.bridge.missions[0].id });
    expect(run!.scheduledFor).toBe(new Date(NOON).toISOString());
    expect(run!.dispatchedAt).toBe(new Date(NOON + 2_000).toISOString());

    h.bridge.finishMission(h.bridge.missions[0].id, {
      summary: 'All done.\nSecond line.',
      usd: 1.25,
      tasks: [{ title: 'Collect', status: 'done', result: 'ok' }, { title: 'Publish', status: 'failed', result: null }],
      cards: [{ title: 'Card A', docs: 'docs A' }]
    });
    await h.service.pollRuns();

    const done = h.service.getRun(run!.id);
    expect(done.status).toBe('finished');
    expect(done.summary).toBe('All done.\nSecond line.');
    expect(done.finishedAt).not.toBeNull();
    expect(done.result?.costUsd).toBe(1.25);
    expect(done.result?.tasks).toEqual([
      { title: 'Collect', status: 'done', result: 'ok' },
      { title: 'Publish', status: 'failed', result: null }
    ]);
    const raw = done.result?.raw as { mission: Record<string, unknown>; boardCards: Array<Record<string, unknown>> };
    expect(raw.mission.status).toBe('done');
    expect(raw.mission).not.toHaveProperty('brief');
    expect(raw.boardCards[0]).toMatchObject({ title: 'Card A', column: 'Concluído', docs: 'docs A' });
  });

  it('passes squadId and mode=squad when the schedule has a squad', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody({ squadId: 'squad-1' }));
    h.clock.now = NOON + 1000;
    await h.service.tick();
    expect(h.bridge.createRequests[0]!.body).toMatchObject({ squadId: 'squad-1', mode: 'squad' });
  });

  it('marks a failed mission as failed with the summary as the error', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    h.clock.now = NOON + 1000;
    await h.service.tick();
    h.bridge.finishMission(h.bridge.missions[0].id, { status: 'failed', summary: 'Out of budget' });
    await h.service.pollRuns();
    const [run] = h.service.listRuns();
    expect(run).toMatchObject({ status: 'failed', summary: 'Out of budget' });
    expect(run!.error).toContain('Out of budget');
  });

  it('records dispatch_failed when the Bridge rejects the mission (no retry)', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    h.bridge.state.workspaces.splice(0, h.bridge.state.workspaces.length); // the workspace vanishes after the schedule was saved
    h.clock.now = NOON + 1000;
    await h.service.tick();
    const [run] = h.service.listRuns();
    expect(run).toMatchObject({ status: 'dispatch_failed', missionId: null, dispatchedAt: null });
    expect(run!.error).toContain('NOT_FOUND');
    h.clock.now = NOON + 120_000;
    await h.service.tick();
    expect(h.bridge.createRequests).toHaveLength(1);
  });

  it('follows the mission by SSE (no polling) once started', async () => {
    h = await harness();
    const sched = await h.service.createSchedule(scheduleBody());
    h.service.start(3_600_000, 3_600_000);
    const outcome = await h.service.runNow(sched.id);
    expect(outcome.run.status).toBe('running');
    await new Promise((r) => setTimeout(r, 100));
    h.bridge.finishMission(h.bridge.missions[0].id, { summary: 'via sse' });
    await waitFor(() => h.service.getRun(outcome.run.id).status === 'finished');
    expect(h.service.getRun(outcome.run.id).summary).toBe('via sse');
  });

  it('manual run dispatches now with trigger manual and no scheduledFor', async () => {
    h = await harness();
    const sched = await h.service.createSchedule(scheduleBody({ time: '23:59' }));
    const { run, bridgeUnavailable } = await h.service.runNow(sched.id);
    expect(bridgeUnavailable).toBe(false);
    expect(run).toMatchObject({ trigger: 'manual', scheduledFor: null, status: 'running' });
    expect((await h.service.listSchedules())[0]!.lastRunAt).toBe(run.dispatchedAt);
  });

  it('master switch off: nothing fires, nothing is recorded as missed, manual still works', async () => {
    h = await harness(undefined, { enabled: false });
    const sched = await h.service.createSchedule(scheduleBody());
    h.clock.now = NOON + 1000;
    await h.service.tick();
    expect(h.bridge.createRequests).toHaveLength(0);
    expect(h.service.listRuns()).toHaveLength(0);
    expect((await h.service.listSchedules())[0]!.nextRunAt).toBeNull();
    expect((await h.service.runNow(sched.id)).run.status).toBe('running');
  });

  it('a schedule created just after its time today does not fire the past slot', async () => {
    h = await harness(NOON + 60_000);
    await h.service.createSchedule(scheduleBody());
    h.clock.now = NOON + 90_000;
    await h.service.tick();
    expect(h.service.listRuns()).toHaveLength(0);
  });
});

describe('dedupe across restarts (hello is replayed)', () => {
  it('a restart never re-dispatches a slot that was already dispatched', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    h.clock.now = NOON + 2_000;
    await h.service.tick();
    expect(h.bridge.createRequests).toHaveLength(1);

    for (let i = 0; i < 3; i++) {
      const restarted = h.newService();
      restarted.recoverInterruptedRuns();
      h.clock.now += 20_000;
      await restarted.tick();
    }
    expect(h.bridge.createRequests).toHaveLength(1);
    expect(h.service.listRuns()).toHaveLength(1);
  });

  it('after a restart the run is still tracked to the end', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    h.clock.now = NOON + 2_000;
    await h.service.tick();
    const restarted = h.newService();
    h.bridge.finishMission(h.bridge.missions[0].id, { summary: 'survived restart' });
    await restarted.pollRuns();
    expect(restarted.listRuns()[0]).toMatchObject({ status: 'finished', summary: 'survived restart' });
  });

  it('a crash mid-dispatch is NEVER retried after restart (the mission may already exist)', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    h.bridge.state.hangUpOnCreate = true; // request reaches the bridge, reply never comes back
    h.clock.now = NOON + 2_000;
    await h.service.tick();
    expect(h.bridge.createRequests).toHaveLength(1);
    expect(h.service.listRuns()[0]!.status).toBe('dispatch_failed');

    // Simulate the process dying while the request was in flight: run left inflight on disk.
    const file = join(h.dataDir, 'runs', readdirSync(join(h.dataDir, 'runs'))[0]!);
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...stored, status: 'dispatching', inflight: true, error: null }));

    h.bridge.state.hangUpOnCreate = false;
    const restarted = h.newService();
    restarted.recoverInterruptedRuns();
    h.clock.now += 30_000;
    await restarted.tick();
    expect(h.bridge.createRequests).toHaveLength(1);
    expect(restarted.listRuns()[0]).toMatchObject({ status: 'dispatch_failed' });
    expect(restarted.listRuns()[0]!.error).toMatch(/not retried/);
  });

  it('an ambiguous failure (dropped connection) is final, not retried', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    h.bridge.state.hangUpOnCreate = true;
    h.clock.now = NOON + 2_000;
    await h.service.tick();
    h.bridge.state.hangUpOnCreate = false;
    h.clock.now = NOON + 120_000;
    await h.service.tick();
    expect(h.bridge.createRequests).toHaveLength(1);
    expect(h.service.listRuns()[0]!.status).toBe('dispatch_failed');
  });
});

describe('missed slots and bridge outages', () => {
  it('records slots older than the grace window as missed and never dispatches them', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    h.clock.now = NOON + 30 * 60_000; // 30 min late: plugin was down
    await h.service.tick();
    expect(h.bridge.createRequests).toHaveLength(0);
    const [run] = h.service.listRuns();
    expect(run).toMatchObject({ status: 'missed', trigger: 'schedule', missionId: null, dispatchedAt: null });
    await h.service.tick();
    expect(h.service.listRuns()).toHaveLength(1);
  });

  it('retries while the Bridge is refusing connections, within the grace window, exactly once in the end', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    const realUrl = h.bridge.url;
    const svc = h.newService();
    // Point a service at a dead port to get ECONNREFUSED, same data dir.
    const dead = await (async () => {
      const { createServer } = await import('node:net');
      const s = createServer();
      await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
      const port = (s.address() as { port: number }).port;
      await new Promise<void>((r) => s.close(() => r()));
      return port;
    })();
    const { BridgeClient } = await import('../src/bridge.js');
    const { ScheduleService } = await import('../src/service.js');
    const { Store } = await import('../src/store.js');
    const flaky = new ScheduleService({
      config: { ...svc.config, bridgeUrl: `http://127.0.0.1:${dead}` },
      store: new Store(h.dataDir),
      bridge: new BridgeClient({ baseUrl: `http://127.0.0.1:${dead}`, token: 't', timeoutMs: 1000 }),
      log: () => undefined,
      version: 't',
      now: () => h.clock.now,
      retryDelayMs: 30_000
    });
    h.clock.now = NOON + 1_000;
    await flaky.tick();
    expect(flaky.listRuns()[0]).toMatchObject({ status: 'dispatching' });
    expect(flaky.listRuns()[0]!.error).toMatch(/NETWORK_ERROR/);
    expect(h.bridge.createRequests).toHaveLength(0);

    // Bridge comes back (real one), retry delay elapsed -> dispatched once.
    const recovered = h.newService();
    expect(realUrl).toBe(h.bridge.url);
    h.clock.now = NOON + 40_000;
    await recovered.tick();
    await recovered.tick();
    expect(h.bridge.createRequests).toHaveLength(1);
    expect(recovered.listRuns()[0]).toMatchObject({ status: 'running' });
    expect(recovered.listRuns()).toHaveLength(1);
  });

  it('gives up retrying once the grace window is over', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    const { BridgeClient } = await import('../src/bridge.js');
    const { ScheduleService } = await import('../src/service.js');
    const { Store } = await import('../src/store.js');
    const dead = new ScheduleService({
      config: h.service.config,
      store: new Store(h.dataDir),
      bridge: new BridgeClient({ baseUrl: 'http://127.0.0.1:1', token: 't', timeoutMs: 500 }),
      log: () => undefined,
      version: 't',
      now: () => h.clock.now,
      retryDelayMs: 60_000
    });
    h.clock.now = NOON + 14 * 60_000 + 30_000;
    await dead.tick();
    expect(dead.listRuns()[0]).toMatchObject({ status: 'dispatch_failed' });
  });

  it('fails a running run whose mission the Bridge stops knowing about', async () => {
    h = await harness();
    const sched = await h.service.createSchedule(scheduleBody());
    await h.service.runNow(sched.id);
    h.bridge.missions.length = 0;
    await h.service.pollRuns();
    await h.service.pollRuns();
    expect(h.service.listRuns()[0]!.status).toBe('running');
    await h.service.pollRuns();
    expect(h.service.listRuns()[0]).toMatchObject({ status: 'failed' });
  });
});

describe('schedules & history', () => {
  it('CRUD, armedAt reset on timing change only, runs kept after delete', async () => {
    h = await harness();
    const created = await h.service.createSchedule(scheduleBody());
    const renamed = await h.service.updateSchedule(created.id, scheduleBody({ name: 'Renamed' }));
    expect(renamed.name).toBe('Renamed');
    expect(renamed.createdAt).toBe(created.createdAt);
    await h.service.runNow(created.id);
    h.service.deleteSchedule(created.id);
    expect(await h.service.listSchedules()).toEqual([]);
    expect(h.service.listRuns()).toHaveLength(1);
    expect(() => h.service.deleteSchedule(created.id)).toThrow(/does not exist/);
    await expect(h.service.updateSchedule('nope', scheduleBody())).rejects.toThrow(/does not exist/);
  });

  it('lists runs newest first, filterable by schedule, with a limit', async () => {
    h = await harness();
    const a = await h.service.createSchedule(scheduleBody({ name: 'A' }));
    const b = await h.service.createSchedule(scheduleBody({ name: 'B', time: '23:00' }));
    await h.service.runNow(a.id);
    h.clock.now += 1000;
    await h.service.runNow(b.id);
    h.clock.now += 1000;
    await h.service.runNow(a.id);
    const all = h.service.listRuns();
    expect(all.map((r) => r.scheduleName)).toEqual(['A', 'B', 'A']);
    expect(h.service.listRuns({ scheduleId: b.id })).toHaveLength(1);
    expect(h.service.listRuns({ limit: 2 })).toHaveLength(2);
    expect(() => h.service.listRuns({ limit: 0 })).toThrow(/limit/);
  });

  it('prunes terminal runs older than the retention window', async () => {
    h = await harness(undefined, { historyRetentionDays: 10 });
    const sched = await h.service.createSchedule(scheduleBody());
    const { run } = await h.service.runNow(sched.id);
    h.bridge.finishMission(h.bridge.missions[0].id);
    await h.service.pollRuns();
    h.clock.now += 9 * 86_400_000;
    h.service.prune();
    expect(h.service.listRuns()).toHaveLength(1);
    h.clock.now += 2 * 86_400_000;
    h.service.prune();
    expect(h.service.listRuns()).toHaveLength(0);
    expect(readdirSync(join(h.dataDir, 'runs'))).toHaveLength(0);
    expect(run.id).toBeTruthy();
  });

  it('does not prune runs that are still running', async () => {
    h = await harness(undefined, { historyRetentionDays: 1 });
    const sched = await h.service.createSchedule(scheduleBody());
    await h.service.runNow(sched.id);
    h.clock.now += 5 * 86_400_000;
    h.service.prune();
    expect(h.service.listRuns()).toHaveLength(1);
  });

  it('survives a corrupt schedules.json and unreadable run files', async () => {
    h = await harness();
    await h.service.createSchedule(scheduleBody());
    writeFileSync(join(h.dataDir, 'schedules.json'), '{broken');
    writeFileSync(join(h.dataDir, 'runs', 'junk.json'), 'not json');
    const restarted = h.newService();
    expect(await restarted.listSchedules()).toEqual([]);
    expect(h.logs.some((l) => l.includes('schedules.json was unreadable'))).toBe(true);
    expect(h.logs.some((l) => l.includes('junk.json'))).toBe(true);
  });
});
