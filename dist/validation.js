import { isValidTimezone, TIME_PATTERN } from './time.js';
import { STACK_LAYERS } from './types.js';
export class ValidationError extends Error {
}
const MAX_NAME = 200;
const MAX_BRIEFING = 100_000;
const MAX_ID = 200;
const MAX_MODELS = 64;
const MAX_STACK_ITEMS = 50;
const MAX_STACK_ITEM_LEN = 100;
const MAESTRO_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
export function emptyStack() {
    return { backend: [], frontend: [], mobile: [], infra: [], other: [] };
}
export function hasDeclaredStack(stack) {
    return STACK_LAYERS.some((layer) => stack[layer].length > 0);
}
function parseIdList(value, field) {
    if (!Array.isArray(value))
        fail(field, 'must be an array of model ids');
    if (value.length > MAX_MODELS)
        fail(field, `must have at most ${MAX_MODELS} entries`);
    const out = [];
    for (const v of value) {
        if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_ID)
            fail(field, 'must only contain non-empty strings');
        if (!out.includes(v.trim()))
            out.push(v.trim());
    }
    return out;
}
function parseStack(value) {
    if (!isRecord(value))
        fail('stack', 'must be an object {backend, frontend, mobile, infra, other}');
    const stack = emptyStack();
    for (const layer of STACK_LAYERS) {
        const raw = value[layer];
        if (raw === undefined)
            continue;
        if (!Array.isArray(raw))
            fail(`stack.${layer}`, 'must be an array of strings');
        if (raw.length > MAX_STACK_ITEMS)
            fail(`stack.${layer}`, `must have at most ${MAX_STACK_ITEMS} entries`);
        for (const item of raw) {
            if (typeof item !== 'string')
                fail(`stack.${layer}`, 'must only contain strings');
            const t = item.trim();
            if (t === '')
                continue;
            if (t.length > MAX_STACK_ITEM_LEN)
                fail(`stack.${layer}`, `entries must be at most ${MAX_STACK_ITEM_LEN} characters`);
            if (!stack[layer].includes(t))
                stack[layer].push(t);
        }
    }
    return stack;
}
/**
 * Fills the fields added after the first release with their defaults, so a
 * schedule stored by an older plugin version loads unchanged.
 */
export function withOptionDefaults(s) {
    return {
        ...s,
        maestro: typeof s.maestro === 'string' ? s.maestro : null,
        e2e: s.e2e === true,
        stack: { ...emptyStack(), ...(s.stack ?? {}) },
        modelPool: Array.isArray(s.modelPool) ? s.modelPool : [],
        agentModels: s.agentModels && typeof s.agentModels === 'object' ? s.agentModels : {}
    };
}
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
    let maestro = null;
    if (body.maestro !== undefined && body.maestro !== null && body.maestro !== '') {
        if (typeof body.maestro !== 'string' || !MAESTRO_PATTERN.test(body.maestro.trim())) {
            fail('maestro', 'must be a maestro id such as "claude-code", or null');
        }
        maestro = body.maestro.trim();
    }
    let e2e = false;
    if (body.e2e !== undefined) {
        if (typeof body.e2e !== 'boolean')
            fail('e2e', 'must be a boolean');
        e2e = body.e2e;
    }
    const stack = body.stack === undefined || body.stack === null ? emptyStack() : parseStack(body.stack);
    const modelPool = body.modelPool === undefined ? [] : parseIdList(body.modelPool, 'modelPool');
    const agentModels = {};
    if (body.agentModels !== undefined && body.agentModels !== null) {
        if (!isRecord(body.agentModels))
            fail('agentModels', 'must be an object mapping agent ids to model ids');
        const entries = Object.entries(body.agentModels);
        if (entries.length > MAX_MODELS)
            fail('agentModels', `must have at most ${MAX_MODELS} entries`);
        for (const [agentId, model] of entries) {
            if (agentId === '__proto__' || agentId.length === 0 || agentId.length > MAX_ID)
                fail('agentModels', 'has an invalid agent id');
            if (typeof model !== 'string' || model.trim() === '' || model.length > MAX_ID) {
                fail('agentModels', `the model of agent "${agentId.slice(0, 40)}" must be a non-empty string`);
            }
            agentModels[agentId] = model.trim();
        }
    }
    return {
        name,
        briefing: body.briefing,
        workspaceId,
        time: body.time,
        days,
        timezone,
        squadId,
        enabled,
        maestro,
        e2e,
        stack,
        modelPool,
        agentModels
    };
}
