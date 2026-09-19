/**
 * Minimal client for the ADE SaaS Bridge (apps/desktop/src/main/services/
 * SaasBridge.ts + saasBridgeStudioRoutes.ts). Dependency-free: global fetch only.
 * Every REST reply is enveloped {ok:true,data}/{ok:false,code,message}; the SSE
 * stream (`GET /api/events`) names its channel in the `event:` line and sends
 * `mission:update` with the Mission object FLAT.
 */

import type { BridgeMission, BridgeTask, ProjectStack } from './types.js';

const NETWORK_RETRYABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']);

export class BridgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** True only when the request provably never reached the Bridge (safe to retry a POST). */
    readonly neverSent: boolean = false,
    /** True when the Bridge itself was unreachable/unresponsive (vs. it answering with an error). */
    readonly unavailable: boolean = false
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export interface BridgeAgent {
  agentId: string;
  name: string;
  adapter: string;
  model: string;
}

export interface BridgeSquad {
  id: string;
  name: string;
  description: string;
  agents: BridgeAgent[];
  /** Squad-level defaults (newer Bridges): allowed models ([] = unrestricted) and per-agent model. */
  modelPool: string[];
  agentModels: Record<string, string>;
}

export interface BridgeMaestro {
  id: string;
  label: string;
  available: boolean;
}

export interface BridgeModel {
  id: string;
  label: string;
  adapter: string;
  tier?: string;
  cost?: string;
  bestFor?: string;
}

export interface BridgeCatalog {
  workspaces: Array<{ id: string; name: string; path: string }>;
  squads: BridgeSquad[];
  maestros: BridgeMaestro[];
  /** Absent on a Bridge that predates model selection (`undefined`, not `[]`). */
  models?: BridgeModel[];
}

export interface CreateMissionInput {
  brief: string;
  workspaceId: string;
  name: string;
  mode: 'free' | 'squad';
  squadId?: string;
  maestro?: string;
  e2e?: boolean;
  stack?: ProjectStack;
  attachmentIds?: string[];
  /** Only sent when the Bridge advertises `catalog.models`. */
  modelPool?: string[];
  agentModels?: Record<string, string>;
}

export interface UploadedAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

/** Attachments carry up to 50 MB of base64 — far more than the 10 s of a JSON call. */
const UPLOAD_TIMEOUT_MS = 120_000;

export interface MissionDetail {
  mission: BridgeMission;
  tasks: BridgeTask[];
  boardColumns: Array<Record<string, unknown>>;
  boardCards: Array<Record<string, unknown>>;
}

export interface BridgeEvent {
  event: string;
  data: unknown;
}

export interface BridgeClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class BridgeClient {
  private baseUrl: string;
  private token: string;
  /** Live SSE subscriptions: restarted when the credentials change. */
  /** Tokens replaced by `setCredentials`: still redacted from errors of requests that were in flight. */
  private retired: string[] = [];
  private readonly restarters = new Set<() => void>();
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BridgeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Swaps the Bridge address/token live (ADE restarted the Bridge or rotated its token). In-flight requests finish
   * with the old credentials; every later request and every SSE stream (reconnected now) uses the new ones.
   */
  setCredentials(creds: { baseUrl: string; token: string }): void {
    const baseUrl = creds.baseUrl.replace(/\/+$/, '');
    if (baseUrl === this.baseUrl && creds.token === this.token) return;
    if (this.token && this.token !== creds.token) this.retired = [...this.retired, this.token].slice(-4);
    this.baseUrl = baseUrl;
    this.token = creds.token;
    for (const restart of this.restarters) restart();
  }

  private redact(text: string): string {
    return [this.token, ...this.retired].filter(Boolean).reduce((out, t) => out.split(t).join('***'), text);
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new BridgeError(0, 'TIMEOUT', `ADE Bridge did not answer within ${timeoutMs}ms (${method} ${path})`, false, true);
        }
        const cause = (err as { cause?: { code?: string } }).cause;
        const neverSent = cause?.code !== undefined && NETWORK_RETRYABLE_CODES.has(cause.code);
        throw new BridgeError(
          0,
          'NETWORK_ERROR',
          this.redact(`Could not reach the ADE Bridge: ${cause?.code ?? (err instanceof Error ? err.message : String(err))}`),
          neverSent,
          true
        );
      }
      let text: string;
      try {
        text = await res.text();
      } catch {
        if (controller.signal.aborted) {
          throw new BridgeError(0, 'TIMEOUT', `ADE Bridge timed out while sending the response (${method} ${path})`, false, true);
        }
        throw new BridgeError(res.status, 'NETWORK_ERROR', 'ADE Bridge connection dropped mid-response', false, true);
      }
      const parsed = parseEnvelope(text);
      if (parsed && parsed.ok === true) return parsed.data as T;
      if (parsed && parsed.ok === false) {
        throw new BridgeError(
          res.status,
          typeof parsed.code === 'string' ? parsed.code : 'UNKNOWN',
          this.redact(typeof parsed.message === 'string' ? parsed.message : `ADE Bridge returned HTTP ${res.status}`)
        );
      }
      throw new BridgeError(res.status, 'BAD_RESPONSE', `ADE Bridge returned an unrecognised response (HTTP ${res.status}) for ${method} ${path}`);
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<{ version?: string; app?: string }> {
    return this.request('GET', '/api/health');
  }

  async catalog(): Promise<BridgeCatalog> {
    const raw = await this.request<Record<string, unknown>>('GET', '/api/catalog');
    const list = (v: unknown): Array<Record<string, unknown>> =>
      Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [];
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    return {
      workspaces: list(raw.workspaces).map((w) => ({ id: str(w.id), name: str(w.name), path: str(w.path) })),
      squads: list(raw.squads).map((s) => ({
        id: str(s.id),
        name: str(s.name),
        description: str(s.description),
        agents: list(s.agents).map((a) => ({ agentId: str(a.agentId), name: str(a.name), adapter: str(a.adapter), model: str(a.model) })),
        modelPool: Array.isArray(s.modelPool) ? s.modelPool.filter((x): x is string => typeof x === 'string') : [],
        agentModels: stringRecord(s.agentModels)
      })),
      maestros: list(raw.maestros).map((m) => ({ id: str(m.id), label: str(m.label) || str(m.id), available: m.available === true })),
      ...(Array.isArray(raw.models)
        ? { models: list(raw.models).map((m) => ({ id: str(m.id), label: str(m.label) || str(m.id), adapter: str(m.adapter), ...(typeof m.tier === 'string' ? { tier: m.tier } : {}), ...(typeof m.cost === 'string' ? { cost: m.cost } : {}), ...(typeof m.bestFor === 'string' ? { bestFor: m.bestFor } : {}) })) }
        : {})
    };
  }

  /** `POST /api/attachments` — stages bytes in the Bridge's (evicting) pantry and returns a fresh opaque id. */
  async uploadAttachment(input: { name: string; mime: string; data: string }): Promise<UploadedAttachment> {
    const raw = await this.request<{ attachment: UploadedAttachment }>('POST', '/api/attachments', input, UPLOAD_TIMEOUT_MS);
    return raw.attachment;
  }

  listMissions(): Promise<{ missions: BridgeMission[]; tasks: BridgeTask[] }> {
    return this.request('GET', '/api/missions');
  }

  getMission(id: string): Promise<MissionDetail> {
    return this.request('GET', `/api/missions/${encodeURIComponent(id)}`);
  }

  /** `POST /api/missions` — creates AND starts the mission. */
  async createMission(input: CreateMissionInput): Promise<BridgeMission> {
    const raw = await this.request<{ mission: BridgeMission }>('POST', '/api/missions', input);
    return raw.mission;
  }

  /**
   * Subscribes to `GET /api/events` with automatic reconnect (exponential
   * backoff). Returns a function that stops it.
   */
  subscribe(
    onEvent: (event: BridgeEvent) => void,
    onState?: (connected: boolean, error?: string) => void,
    minRetryMs = 1000,
    maxRetryMs = 30_000
  ): () => void {
    let closed = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let retry: NodeJS.Timeout | null = null;
    /** Bumped on every (re)start so a superseded connection stops quietly instead of scheduling its own retry. */
    let generation = 0;

    const schedule = (): void => {
      if (closed) return;
      const delay = Math.min(maxRetryMs, minRetryMs * 2 ** attempt);
      attempt += 1;
      retry = setTimeout(() => void connect(), delay);
      retry.unref?.();
    };

    const connect = async (): Promise<void> => {
      if (closed) return;
      const mine = ++generation;
      controller = new AbortController();
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/api/events`, {
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' },
          signal: controller.signal
        });
        if (mine !== generation) return;
        if (!res.ok || !res.body) throw new Error(`SSE connection failed with HTTP ${res.status}`);
        attempt = 0;
        onState?.(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 8 * 1024 * 1024) throw new Error('SSE buffer overflow');
          let idx = buffer.indexOf('\n\n');
          while (idx !== -1) {
            const frame = parseSseFrame(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 2);
            if (frame) onEvent(frame);
            idx = buffer.indexOf('\n\n');
          }
        }
        if (closed || mine !== generation) return;
        onState?.(false, 'SSE stream ended');
      } catch (err) {
        if (closed || mine !== generation) return;
        onState?.(false, this.redact(err instanceof Error ? err.message : String(err)));
      }
      schedule();
    };

    const restart = (): void => {
      if (closed) return;
      if (retry) clearTimeout(retry);
      retry = null;
      controller?.abort();
      attempt = 0;
      void connect();
    };
    this.restarters.add(restart);

    void connect();
    return () => {
      closed = true;
      this.restarters.delete(restart);
      if (retry) clearTimeout(retry);
      controller?.abort();
    };
  }
}

function stringRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  }
  return out;
}

interface Envelope {
  ok?: unknown;
  data?: unknown;
  code?: unknown;
  message?: unknown;
}

function parseEnvelope(text: string): Envelope | null {
  try {
    const v: unknown = text ? JSON.parse(text) : null;
    return typeof v === 'object' && v !== null ? (v as Envelope) : null;
  } catch {
    return null;
  }
}

/** Parses one SSE frame ("event: x\ndata: {json}"); null for comments/heartbeats/bad JSON. */
export function parseSseFrame(frame: string): BridgeEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const raw of frame.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line === '' || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}
