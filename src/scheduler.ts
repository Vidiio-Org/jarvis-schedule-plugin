import { DAY_MS, MINUTE_MS, slotsBetween, type Slot } from './time.js';
import type { StoredSchedule } from './types.js';

/** Slots up to this late are still dispatched; older ones are recorded as "missed". */
export const GRACE_MS = 15 * MINUTE_MS;
/** Never look further back than this for un-handled slots (bounds work after a long downtime). */
export const MAX_LOOKBACK_MS = 7 * DAY_MS;

export interface PlannedSlot {
  schedule: StoredSchedule;
  slot: Slot;
  action: 'dispatch' | 'missed';
}

export interface PlanOptions {
  now: number;
  /** Slot keys that already have a run record (dispatched, failed or missed). */
  handledKeys: ReadonlySet<string>;
  graceMs?: number;
  /** Bounded by history retention so pruned slots are never re-created. */
  lookbackMs?: number;
}

/**
 * Pure planning step of the scheduler: which slots are due right now, and
 * whether each is still dispatchable (within the grace window) or missed.
 * Slots already handled are skipped, so calling this repeatedly — or after
 * a restart with persisted state — never yields the same slot twice.
 */
export function planSlots(schedules: readonly StoredSchedule[], opts: PlanOptions): PlannedSlot[] {
  const grace = opts.graceMs ?? GRACE_MS;
  const lookback = Math.min(opts.lookbackMs ?? MAX_LOOKBACK_MS, MAX_LOOKBACK_MS);
  const planned: PlannedSlot[] = [];
  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    const from = Math.max(schedule.armedAt, opts.now - lookback);
    for (const slot of slotsBetween(schedule, from, opts.now)) {
      if (opts.handledKeys.has(slot.key)) continue;
      planned.push({ schedule, slot, action: opts.now - slot.at <= grace ? 'dispatch' : 'missed' });
    }
  }
  return planned.sort((a, b) => a.slot.at - b.slot.at);
}
