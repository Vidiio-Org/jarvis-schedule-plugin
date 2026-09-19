/**
 * Minimal client for the ADE SaaS Bridge (apps/desktop/src/main/services/
 * SaasBridge.ts + saasBridgeStudioRoutes.ts). Dependency-free: global fetch only.
 * Every REST reply is enveloped {ok:true,data}/{ok:false,code,message}; the SSE
 * stream (`GET /api/events`) names its channel in the `event:` line and sends
 * `mission:update` with the Mission object FLAT.
 */

import type { BridgeMission, BridgeTask } from './types.js';

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

export interface BridgeCatalog {
  workspaces: Array<{ id: string; name: string; path: string }>;
  squads: Array<{ id: string; name: string }>;
}

export interface CreateMissionInput {
  brief: string;
  workspaceId: string;
  name: string;
  mode: 'free' | 'squad';
  squadId?: string;
}

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
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BridgeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private redact(text: string): string {
    return this.token ? text.split(this.token).join('***') : text;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
          throw new BridgeError(0, 'TIMEOUT', `ADE Bridge did not answer within ${this.timeoutMs}ms (${method} ${path})`, false, true);
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
    const raw = await this.request<Partial<BridgeCatalog>>('GET', '/api/catalog');
    return {
      workspaces: (raw.workspaces ?? []).map((w) => ({ id: w.id, name: w.name, path: w.path })),
      squads: (raw.squads ?? []).map((s) => ({ id: s.id, name: s.name }))
    };
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

    const schedule = (): void => {
      if (closed) return;
      const delay = Math.min(maxRetryMs, minRetryMs * 2 ** attempt);
      attempt += 1;
      retry = setTimeout(() => void connect(), delay);
      retry.unref?.();
    };

    const connect = async (): Promise<void> => {
      if (closed) return;
      controller = new AbortController();
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/api/events`, {
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' },
          signal: controller.signal
        });
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
        if (!closed) onState?.(false, 'SSE stream ended');
      } catch (err) {
        if (closed) return;
        onState?.(false, this.redact(err instanceof Error ? err.message : String(err)));
      }
      schedule();
    };

    void connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      controller?.abort();
    };
  }
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
