import type { BridgeCatalog } from './bridge.js';
import { canonicalTimezone, TIME_PATTERN } from './time.js';
import { STACK_LAYERS, type ProjectStack, type ScheduleInput } from './types.js';

export class ValidationError extends Error {}

const MAX_NAME = 200;
const MAX_BRIEFING = 100_000;
const MAX_ID = 200;
const MAX_MODELS = 64;
const MAX_STACK_ITEMS = 50;
const MAX_STACK_ITEM_LEN = 100;
const MAESTRO_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;

export function emptyStack(): ProjectStack {
  return { backend: [], frontend: [], mobile: [], infra: [], other: [] };
}

export function hasDeclaredStack(stack: ProjectStack): boolean {
  return STACK_LAYERS.some((layer) => stack[layer].length > 0);
}

function parseIdList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail(field, 'must be an array of model ids');
  if (value.length > MAX_MODELS) fail(field, `must have at most ${MAX_MODELS} entries`);
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_ID) fail(field, 'must only contain non-empty strings');
    if (!out.includes(v.trim())) out.push(v.trim());
  }
  return out;
}

function parseStack(value: unknown): ProjectStack {
  if (!isRecord(value)) fail('stack', 'must be an object {backend, frontend, mobile, infra, other}');
  const stack = emptyStack();
  for (const layer of STACK_LAYERS) {
    const raw = value[layer];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) fail(`stack.${layer}`, 'must be an array of strings');
    if (raw.length > MAX_STACK_ITEMS) fail(`stack.${layer}`, `must have at most ${MAX_STACK_ITEMS} entries`);
    for (const item of raw) {
      if (typeof item !== 'string') fail(`stack.${layer}`, 'must only contain strings');
      const t = item.trim();
      if (t === '') continue;
      if (t.length > MAX_STACK_ITEM_LEN) fail(`stack.${layer}`, `entries must be at most ${MAX_STACK_ITEM_LEN} characters`);
      if (!stack[layer].includes(t)) stack[layer].push(t);
    }
  }
  return stack;
}

/**
 * Fills the fields added after the first release with their defaults, so a
 * schedule stored by an older plugin version loads unchanged.
 */
export function withOptionDefaults<T extends Partial<ScheduleInput>>(
  s: T
): T & Pick<ScheduleInput, 'maestro' | 'e2e' | 'stack' | 'modelPool' | 'agentModels'> {
  return {
    ...s,
    maestro: typeof s.maestro === 'string' ? s.maestro : null,
    e2e: s.e2e === true,
    stack: { ...emptyStack(), ...(s.stack ?? {}) },
    modelPool: Array.isArray(s.modelPool) ? s.modelPool : [],
    agentModels: s.agentModels && typeof s.agentModels === 'object' ? s.agentModels : {}
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(field: string, why: string): never {
  throw new ValidationError(`${field}: ${why}`);
}

/**
 * Validates and normalises a ScheduleInput. `days` defaults to every day,
 * `timezone` to the configured default, `squadId` to null and `enabled` to
 * true when omitted. Unknown fields are ignored. Throws `ValidationError`
 * whose message names the offending field.
 */
export function parseScheduleInput(body: unknown, defaultTimezone: string): ScheduleInput {
  if (!isRecord(body)) throw new ValidationError('body: must be a JSON object');

  if (typeof body.name !== 'string' || body.name.trim() === '') fail('name', 'is required');
  const name = body.name.trim();
  if (name.length > MAX_NAME) fail('name', `must be at most ${MAX_NAME} characters`);

  if (typeof body.briefing !== 'string' || body.briefing.trim() === '') fail('briefing', 'is required');
  if (body.briefing.length > MAX_BRIEFING) fail('briefing', `must be at most ${MAX_BRIEFING} characters`);

  if (typeof body.workspaceId !== 'string' || body.workspaceId.trim() === '') fail('workspaceId', 'is required');
  const workspaceId = body.workspaceId.trim();
  if (workspaceId.length > MAX_ID) fail('workspaceId', 'is too long');

  if (typeof body.time !== 'string' || !TIME_PATTERN.test(body.time)) fail('time', 'must be HH:MM (24h), e.g. "08:30"');

  let days: number[] = [0, 1, 2, 3, 4, 5, 6];
  if (body.days !== undefined) {
    if (!Array.isArray(body.days)) fail('days', 'must be an array of integers 0 (Sunday) to 6 (Saturday)');
    if (body.days.length === 0) fail('days', 'must contain at least one day');
    const seen = new Set<number>();
    for (const d of body.days) {
      if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) {
        fail('days', 'must only contain integers 0 (Sunday) to 6 (Saturday)');
      }
      seen.add(d);
    }
    days = [...seen].sort((a, b) => a - b);
  }

  let timezone = canonicalTimezone(defaultTimezone) ?? defaultTimezone;
  if (body.timezone !== undefined) {
    const canonical = canonicalTimezone(body.timezone);
    if (canonical === null) fail('timezone', 'must be a valid IANA timezone, e.g. "America/Sao_Paulo"');
    timezone = canonical;
  }

  let squadId: string | null = null;
  if (body.squadId !== undefined && body.squadId !== null) {
    if (typeof body.squadId !== 'string') fail('squadId', 'must be a string or null');
    const s = body.squadId.trim();
    if (s.length > MAX_ID) fail('squadId', 'is too long');
    squadId = s === '' ? null : s;
  }

  let enabled = true;
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') fail('enabled', 'must be a boolean');
    enabled = body.enabled;
  }

  let maestro: string | null = null;
  if (body.maestro !== undefined && body.maestro !== null && body.maestro !== '') {
    if (typeof body.maestro !== 'string' || !MAESTRO_PATTERN.test(body.maestro.trim())) {
      fail('maestro', 'must be a maestro id such as "claude-code", or null');
    }
    maestro = body.maestro.trim();
  }

  let e2e = false;
  if (body.e2e !== undefined) {
    if (typeof body.e2e !== 'boolean') fail('e2e', 'must be a boolean');
    e2e = body.e2e;
  }

  const stack = body.stack === undefined || body.stack === null ? emptyStack() : parseStack(body.stack);
  const modelPool = body.modelPool === undefined ? [] : parseIdList(body.modelPool, 'modelPool');

  const agentModels: Record<string, string> = {};
  if (body.agentModels !== undefined && body.agentModels !== null) {
    if (!isRecord(body.agentModels)) fail('agentModels', 'must be an object mapping agent ids to model ids');
    const entries = Object.entries(body.agentModels);
    if (entries.length > MAX_MODELS) fail('agentModels', `must have at most ${MAX_MODELS} entries`);
    for (const [agentId, model] of entries) {
      if (agentId === '__proto__' || agentId.length === 0 || agentId.length > MAX_ID) fail('agentModels', 'has an invalid agent id');
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

const shown = (id: string): string => JSON.stringify(id.length > 60 ? `${id.slice(0, 60)}…` : id);

/**
 * Checks a parsed ScheduleInput against the Bridge catalog: workspace, squad, maestro, model pool and per-agent
 * models must exist. Throws `ValidationError` naming the field. Returns non-blocking warnings (a maestro that is
 * listed but not available, model selection on a Bridge that cannot take it).
 *
 * A model is allowed on any agent: the model implies the CLI, so the agent's own adapter is deliberately NOT compared.
 */
export function validateAgainstCatalog(input: ScheduleInput, catalog: BridgeCatalog): string[] {
  const warnings: string[] = [];

  if (!catalog.workspaces.some((w) => w.id === input.workspaceId)) {
    fail('workspaceId', `unknown workspace ${shown(input.workspaceId)}; pick one from GET /api/workspaces`);
  }

  const squad = input.squadId === null ? null : catalog.squads.find((s) => s.id === input.squadId);
  if (input.squadId !== null && !squad) fail('squadId', `unknown squad ${shown(input.squadId)}; pick one from GET /api/catalog`);

  if (input.maestro !== null) {
    const maestro = catalog.maestros.find((m) => m.id === input.maestro);
    if (!maestro) fail('maestro', `unknown maestro ${shown(input.maestro)}; pick one from GET /api/catalog`);
    if (!maestro.available) warnings.push(`maestro ${shown(input.maestro)} is not available on this machine right now; the dispatch will fail until it is.`);
  }

  const wantsModels = input.modelPool.length > 0 || Object.keys(input.agentModels).length > 0;
  if (wantsModels && catalog.models === undefined) {
    warnings.push('The ADE Bridge does not support model selection (update Jarvis ADE): modelPool/agentModels are saved but will not be sent.');
    return warnings;
  }
  const models = catalog.models ?? [];
  for (const id of input.modelPool) {
    if (!models.some((m) => m.id === id)) fail('modelPool', `unknown model ${shown(id)}; pick ids from catalog.models`);
  }
  for (const [agentId, modelId] of Object.entries(input.agentModels)) {
    if (!squad) fail('agentModels', 'needs a squad: choose squadId before assigning a model to an agent');
    if (!squad.agents.some((a) => a.agentId === agentId)) fail('agentModels', `agent ${shown(agentId)} is not in squad ${shown(squad.id)}`);
    if (!models.some((m) => m.id === modelId)) fail('agentModels', `unknown model ${shown(modelId)} for agent ${shown(agentId)}; pick ids from catalog.models`);
  }
  return warnings;
}
