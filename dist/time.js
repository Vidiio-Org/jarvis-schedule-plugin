/**
 * Pure, DST-safe wall-clock <-> instant arithmetic on top of Intl. No
 * dependency on the host timezone, no Date-local methods.
 *
 * DST rules (documented because they are a product decision):
 *  - a wall time that does not exist (spring-forward gap) fires at the instant
 *    the gap ends shifted by the gap length, i.e. 02:30 -> 03:30 local;
 *  - a wall time that happens twice (fall-back) fires at its FIRST occurrence.
 * Slot identity is the local date + HH:MM, so either way a slot is one slot.
 */
export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
const formatters = new Map();
function formatter(timeZone) {
    let f = formatters.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        formatters.set(timeZone, f);
    }
    return f;
}
export function isValidTimezone(timeZone) {
    if (typeof timeZone !== 'string' || timeZone.trim() === '')
        return false;
    try {
        formatter(timeZone);
        return true;
    }
    catch {
        return false;
    }
}
/** Wall-clock fields of the instant `ms` as seen in `timeZone`. */
export function zonedParts(ms, timeZone) {
    const out = {};
    for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
        if (part.type !== 'literal')
            out[part.type] = Number(part.value);
    }
    return {
        year: out.year ?? 0,
        month: out.month ?? 0,
        day: out.day ?? 0,
        hour: (out.hour ?? 0) % 24,
        minute: out.minute ?? 0,
        second: out.second ?? 0
    };
}
/** Offset (local - UTC) in ms of `timeZone` at the instant `ms`. */
export function offsetMs(ms, timeZone) {
    const p = zonedParts(ms, timeZone);
    const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return wallAsUtc - Math.floor(ms / 1000) * 1000;
}
/** The instant at which the wall clock in `timeZone` reads y-m-d h:mi (see DST rules above). */
export function zonedWallToUtc(year, month, day, hour, minute, timeZone) {
    const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
    // A DST transition is never within a day of another, so the offsets a day
    // either side bracket every offset that can apply to this wall time.
    const before = guess - offsetMs(guess - DAY_MS, timeZone);
    const after = guess - offsetMs(guess + DAY_MS, timeZone);
    const matches = (utc) => {
        const p = zonedParts(utc, timeZone);
        return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
    };
    const valid = [before, after].filter(matches);
    if (valid.length > 0)
        return Math.min(...valid);
    return before; // gap: pre-transition offset lands after the gap
}
export function pad2(n) {
    return String(n).padStart(2, '0');
}
export function dateString(p) {
    return `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`;
}
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Every slot of `spec` with `fromExclusive < at <= toInclusive`, ascending. */
export function slotsBetween(spec, fromExclusive, toInclusive) {
    const match = TIME_PATTERN.exec(spec.time);
    if (!match || toInclusive <= fromExclusive)
        return [];
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const start = zonedParts(fromExclusive, spec.timezone);
    const end = zonedParts(toInclusive, spec.timezone);
    const firstDay = Date.UTC(start.year, start.month - 1, start.day) - DAY_MS;
    const lastDay = Date.UTC(end.year, end.month - 1, end.day) + DAY_MS;
    const slots = [];
    for (let t = firstDay; t <= lastDay; t += DAY_MS) {
        const d = new Date(t);
        if (!spec.days.includes(d.getUTCDay()))
            continue;
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const day = d.getUTCDate();
        const at = zonedWallToUtc(y, m, day, hour, minute, spec.timezone);
        if (at <= fromExclusive || at > toInclusive)
            continue;
        const date = dateString({ year: y, month: m, day });
        slots.push({ key: `${spec.id}|${date}|${spec.time}`, date, at });
    }
    return slots.sort((a, b) => a.at - b.at);
}
/** The first slot strictly after `now`, or null when `days` is empty. */
export function nextSlotAfter(spec, now) {
    if (spec.days.length === 0)
        return null;
    return slotsBetween(spec, now, now + 9 * DAY_MS)[0] ?? null;
}
