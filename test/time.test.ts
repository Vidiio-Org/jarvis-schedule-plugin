import { describe, expect, it } from 'vitest';

import { isValidTimezone, nextSlotAfter, slotsBetween, zonedParts, zonedWallToUtc } from '../src/time.js';

const iso = (ms: number): string => new Date(ms).toISOString();

describe('timezone helpers', () => {
  it('validates IANA names', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(42)).toBe(false);
  });

  it('reads wall clock parts in a zone', () => {
    const p = zonedParts(Date.UTC(2026, 8, 19, 2, 30, 0), 'America/Sao_Paulo');
    expect(p).toMatchObject({ year: 2026, month: 9, day: 18, hour: 23, minute: 30 });
  });

  it('never yields hour 24 at local midnight', () => {
    expect(zonedParts(Date.UTC(2026, 8, 19, 3, 0, 0), 'America/Sao_Paulo').hour).toBe(0);
  });
});

describe('zonedWallToUtc (DST-safe)', () => {
  it('converts a plain wall time', () => {
    expect(iso(zonedWallToUtc(2026, 9, 19, 8, 0, 'America/Sao_Paulo'))).toBe('2026-09-19T11:00:00.000Z');
  });

  it('handles the spring-forward gap: 02:30 does not exist -> fires at 03:30 local', () => {
    // America/New_York, 2026-03-08 02:00 -> 03:00
    const at = zonedWallToUtc(2026, 3, 8, 2, 30, 'America/New_York');
    expect(iso(at)).toBe('2026-03-08T07:30:00.000Z');
    expect(zonedParts(at, 'America/New_York')).toMatchObject({ hour: 3, minute: 30 });
  });

  it('handles the fall-back overlap: 01:30 happens twice -> first occurrence', () => {
    // America/New_York, 2026-11-01 02:00 -> 01:00
    expect(iso(zonedWallToUtc(2026, 11, 1, 1, 30, 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z');
  });

  it('keeps the wall time across a DST change', () => {
    const before = zonedWallToUtc(2026, 3, 7, 9, 0, 'America/New_York'); // EST
    const after = zonedWallToUtc(2026, 3, 9, 9, 0, 'America/New_York'); // EDT
    expect(iso(before)).toBe('2026-03-07T14:00:00.000Z');
    expect(iso(after)).toBe('2026-03-09T13:00:00.000Z');
  });

  it('handles a half-hour DST zone (Lord Howe)', () => {
    const at = zonedWallToUtc(2026, 10, 10, 9, 0, 'Australia/Lord_Howe'); // +10:30 standard
    expect(zonedParts(at, 'Australia/Lord_Howe')).toMatchObject({ day: 10, hour: 9, minute: 0 });
  });
});

describe('slotsBetween / nextSlotAfter', () => {
  const spec = { id: 's1', time: '08:00', days: [1, 2, 3, 4, 5], timezone: 'America/Sao_Paulo' };

  it('returns weekday slots in the window, ascending, with stable keys', () => {
    // Mon 2026-09-14 .. Sun 2026-09-20
    const slots = slotsBetween(spec, Date.UTC(2026, 8, 13, 0, 0, 0), Date.UTC(2026, 8, 20, 23, 0, 0));
    expect(slots.map((s) => s.key)).toEqual([
      's1|2026-09-14|08:00',
      's1|2026-09-15|08:00',
      's1|2026-09-16|08:00',
      's1|2026-09-17|08:00',
      's1|2026-09-18|08:00'
    ]);
    expect(iso(slots[0]!.at)).toBe('2026-09-14T11:00:00.000Z');
  });

  it('is exclusive at the start and inclusive at the end', () => {
    const at = Date.UTC(2026, 8, 14, 11, 0, 0);
    expect(slotsBetween(spec, at, at + 1000)).toEqual([]);
    expect(slotsBetween(spec, at - 1, at)).toHaveLength(1);
  });

  it('uses the schedule timezone for the weekday, not UTC', () => {
    // 23:30 São Paulo on Friday is already Saturday in UTC
    const late = { id: 's2', time: '23:30', days: [5], timezone: 'America/Sao_Paulo' };
    const slots = slotsBetween(late, Date.UTC(2026, 8, 18, 0, 0, 0), Date.UTC(2026, 8, 20, 12, 0, 0));
    expect(slots).toHaveLength(1);
    expect(slots[0]!.key).toBe('s2|2026-09-18|23:30');
    expect(iso(slots[0]!.at)).toBe('2026-09-19T02:30:00.000Z');
  });

  it('yields exactly one slot on the fall-back day', () => {
    const s = { id: 's3', time: '01:30', days: [0, 1, 2, 3, 4, 5, 6], timezone: 'America/New_York' };
    const slots = slotsBetween(s, Date.UTC(2026, 10, 1, 0, 0, 0), Date.UTC(2026, 10, 1, 12, 0, 0));
    expect(slots).toHaveLength(1);
  });

  it('nextSlotAfter finds the next weekday and null without days', () => {
    // Friday 2026-09-18 09:00 São Paulo -> next is Monday 2026-09-21
    const next = nextSlotAfter(spec, Date.UTC(2026, 8, 18, 12, 0, 0));
    expect(next?.key).toBe('s1|2026-09-21|08:00');
    expect(nextSlotAfter({ ...spec, days: [] }, Date.now())).toBeNull();
  });
});
