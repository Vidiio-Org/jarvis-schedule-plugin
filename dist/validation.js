import { isValidTimezone, TIME_PATTERN } from './time.js';
export class ValidationError extends Error {
}
const MAX_NAME = 200;
const MAX_BRIEFING = 100_000;
const MAX_ID = 200;
function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function fail(field, why) {
    throw new ValidationError(`${field}: ${why}`);
}
/**
 * Validates and normalises a ScheduleInput. `days` defaults to every day,
 * `timezone` to the configured default, `squadId` to null and `enabled` to
 * true when omitted. Unknown fields are ignored. Throws `ValidationError`
 * whose message names the offending field.
 */
export function parseScheduleInput(body, defaultTimezone) {
    if (!isRecord(body))
        throw new ValidationError('body: must be a JSON object');
    if (typeof body.name !== 'string' || body.name.trim() === '')
        fail('name', 'is required');
    const name = body.name.trim();
    if (name.length > MAX_NAME)
        fail('name', `must be at most ${MAX_NAME} characters`);
    if (typeof body.briefing !== 'string' || body.briefing.trim() === '')
        fail('briefing', 'is required');
    if (body.briefing.length > MAX_BRIEFING)
        fail('briefing', `must be at most ${MAX_BRIEFING} characters`);
    if (typeof body.workspaceId !== 'string' || body.workspaceId.trim() === '')
        fail('workspaceId', 'is required');
    const workspaceId = body.workspaceId.trim();
    if (workspaceId.length > MAX_ID)
        fail('workspaceId', 'is too long');
    if (typeof body.time !== 'string' || !TIME_PATTERN.test(body.time))
        fail('time', 'must be HH:MM (24h), e.g. "08:30"');
    let days = [0, 1, 2, 3, 4, 5, 6];
    if (body.days !== undefined) {
        if (!Array.isArray(body.days))
            fail('days', 'must be an array of integers 0 (Sunday) to 6 (Saturday)');
        if (body.days.length === 0)
            fail('days', 'must contain at least one day');
        const seen = new Set();
        for (const d of body.days) {
            if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) {
                fail('days', 'must only contain integers 0 (Sunday) to 6 (Saturday)');
            }
            seen.add(d);
        }
        days = [...seen].sort((a, b) => a - b);
    }
    let timezone = defaultTimezone;
    if (body.timezone !== undefined) {
        if (typeof body.timezone !== 'string' || !isValidTimezone(body.timezone.trim())) {
            fail('timezone', 'must be a valid IANA timezone, e.g. "America/Sao_Paulo"');
        }
        timezone = body.timezone.trim();
    }
    let squadId = null;
    if (body.squadId !== undefined && body.squadId !== null) {
        if (typeof body.squadId !== 'string')
            fail('squadId', 'must be a string or null');
        const s = body.squadId.trim();
        if (s.length > MAX_ID)
            fail('squadId', 'is too long');
        squadId = s === '' ? null : s;
    }
    let enabled = true;
    if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean')
            fail('enabled', 'must be a boolean');
        enabled = body.enabled;
    }
    return { name, briefing: body.briefing, workspaceId, time: body.time, days, timezone, squadId, enabled };
}
