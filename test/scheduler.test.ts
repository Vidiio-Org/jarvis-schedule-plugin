import { describe, expect, it } from 'vitest';

import { GRACE_MS, planSlots } from '../src/scheduler.js';
import { MINUTE_MS } from '../src/time.js';
import type { StoredSchedule } from '../src/types.js';

const NOON = Date.UTC(2026, 8, 19, 12, 0, 0);

function sched(over: Partial<StoredSchedule> = {}): StoredSchedule {
  return {
    id: 's1',
    name: 'n',
    briefing: 'b',
    workspaceId: 'ws',
    time: '12:00',
    days: [0, 1, 2, 3, 4, 5, 6],
    timezone: 'UTC',
    squadId: null,
    enabled: true,
    createdAt: '',
    updatedAt: '',
    armedAt: Date.UTC(2026, 8, 1),
    ...over
  };
}

describe('planSlots', () => {
  it('does nothing before the slot', () => {
    expect(planSlots([sched()], { now: NOON - 1000, handledKeys: new Set() }).filter((p) => p.slot.date === '2026-09-19')).toEqual([]);
  });

  it('dispatches once now >= slot', () => {
    const plan = planSlots([sched()], { now: NOON + 5_000, handledKeys: new Set() });
    const today = plan.find((p) => p.slot.date === '2026-09-19');
    expect(today?.action).toBe('dispatch');
  });

  it('dispatches a late tick inside the grace window', () => {
    const plan = planSlots([sched()], { now: NOON + GRACE_MS, handledKeys: new Set() });
    expect(plan.find((p) => p.slot.date === '2026-09-19')?.action).toBe('dispatch');
  });

  it('records slots older than the grace window as missed', () => {
    const plan = planSlots([sched()], { now: NOON + GRACE_MS + MINUTE_MS, handledKeys: new Set() });
    expect(plan.find((p) => p.slot.date === '2026-09-19')?.action).toBe('missed');
  });

  it('skips slots that already have a run (dedupe)', () => {
    const handled = new Set(['s1|2026-09-19|12:00']);
    const plan = planSlots([sched()], { now: NOON + 5_000, handledKeys: handled });
    expect(plan.find((p) => p.slot.date === '2026-09-19')).toBeUndefined();
  });

  it('is idempotent once the plan is applied', () => {
    const handled = new Set<string>();
    const first = planSlots([sched()], { now: NOON + 5_000, handledKeys: handled });
    first.forEach((p) => handled.add(p.slot.key));
    expect(planSlots([sched()], { now: NOON + 6_000, handledKeys: handled })).toEqual([]);
  });

  it('ignores disabled schedules', () => {
    expect(planSlots([sched({ enabled: false })], { now: NOON + 5_000, handledKeys: new Set() })).toEqual([]);
  });

  it('ignores slots before armedAt (new/edited schedules never fire the past)', () => {
    const plan = planSlots([sched({ armedAt: NOON + 1000 })], { now: NOON + 5_000, handledKeys: new Set() });
    expect(plan.find((p) => p.slot.date === '2026-09-19')).toBeUndefined();
  });

  it('after a multi-day outage: old slots missed, the fresh one dispatched', () => {
    const plan = planSlots([sched()], { now: NOON + 3 * 24 * 60 * MINUTE_MS + MINUTE_MS, handledKeys: new Set() });
    const byDate = Object.fromEntries(plan.map((p) => [p.slot.date, p.action]));
    expect(byDate['2026-09-19']).toBe('missed');
    expect(byDate['2026-09-22']).toBe('dispatch');
  });

  it('respects the day-of-week filter', () => {
    // 2026-09-19 is a Saturday (6)
    const plan = planSlots([sched({ days: [1] })], { now: NOON + 5_000, handledKeys: new Set() });
    expect(plan.find((p) => p.slot.date === '2026-09-19')).toBeUndefined();
  });

  it('bounds the lookback', () => {
    const plan = planSlots([sched()], { now: NOON + 5_000, handledKeys: new Set(), lookbackMs: 2 * 24 * 60 * MINUTE_MS });
    expect(plan.length).toBeLessThanOrEqual(3);
  });
});
