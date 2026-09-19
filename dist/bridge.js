/**
 * Minimal client for the ADE SaaS Bridge (apps/desktop/src/main/services/
 * SaasBridge.ts + saasBridgeStudioRoutes.ts). Dependency-free: global fetch only.
 * Every REST reply is enveloped {ok:true,data}/{ok:false,code,message}; the SSE
 * stream (`GET /api/events`) names its channel in the `event:` line and sends
 * `mission:update` with the Mission object FLAT.
 */
const NETWORK_RETRYABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']);
export class BridgeError extends Error {
    status;
    code;
    neverSent;
    unavailable;
    constructor(status, code, message, 
    /** True only when the request provably never reached the Bridge (safe to retry a POST). */
    neverSent = false, 
    /** True when the Bridge itself was unreachable/unresponsive (vs. it answering with an error). */
    unavailable = false) {
        super(message);
        this.status = status;
        this.code = code;
        this.neverSent = neverSent;
        this.unavailable = unavailable;
        this.name = 'BridgeError';
    }
}
/** Attachments carry up to 50 MB of base64 — far more than the 10 s of a JSON call. */
const UPLOAD_TIMEOUT_MS = 120_000;
export class BridgeClient {
    baseUrl;
    token;
    timeoutMs;
    fetchImpl;
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
        this.token = opts.token;
        this.timeoutMs = opts.timeoutMs ?? 10_000;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }
    redact(text) {
        return this.token ? text.split(this.token).join('***') : text;
    }
    async request(method, path, body, timeoutMs = this.timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            let res;
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
            }
            catch (err) {
                if (controller.signal.aborted) {
                    throw new BridgeError(0, 'TIMEOUT', `ADE Bridge did not answer within ${timeoutMs}ms (${method} ${path})`, false, true);
                }
                const cause = err.cause;
                const neverSent = cause?.code !== undefined && NETWORK_RETRYABLE_CODES.has(cause.code);
                throw new BridgeError(0, 'NETWORK_ERROR', this.redact(`Could not reach the ADE Bridge: ${cause?.code ?? (err instanceof Error ? err.message : String(err))}`), neverSent, true);
            }
            let text;
            try {
                text = await res.text();
            }
            catch {
                if (controller.signal.aborted) {
                    throw new BridgeError(0, 'TIMEOUT', `ADE Bridge timed out while sending the response (${method} ${path})`, false, true);
                }
                throw new BridgeError(res.status, 'NETWORK_ERROR', 'ADE Bridge connection dropped mid-response', false, true);
            }
            const parsed = parseEnvelope(text);
            if (parsed && parsed.ok === true)
                return parsed.data;
            if (parsed && parsed.ok === false) {
                throw new BridgeError(res.status, typeof parsed.code === 'string' ? parsed.code : 'UNKNOWN', this.redact(typeof parsed.message === 'string' ? parsed.message : `ADE Bridge returned HTTP ${res.status}`));
            }
            throw new BridgeError(res.status, 'BAD_RESPONSE', `ADE Bridge returned an unrecognised response (HTTP ${res.status}) for ${method} ${path}`);
        }
        finally {
            clearTimeout(timer);
        }
    }
    health() {
        return this.request('GET', '/api/health');
    }
    async catalog() {
        const raw = await this.request('GET', '/api/catalog');
        const list = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'object' && x !== null) : [];
        const str = (v) => (typeof v === 'string' ? v : '');
        return {
            workspaces: list(raw.workspaces).map((w) => ({ id: str(w.id), name: str(w.name), path: str(w.path) })),
            squads: list(raw.squads).map((s) => ({
                id: str(s.id),
                name: str(s.name),
                description: str(s.description),
                agents: list(s.agents).map((a) => ({ agentId: str(a.agentId), name: str(a.name), adapter: str(a.adapter), model: str(a.model) })),
                modelPool: Array.isArray(s.modelPool) ? s.modelPool.filter((x) => typeof x === 'string') : [],
                agentModels: stringRecord(s.agentModels)
            })),
            maestros: list(raw.maestros).map((m) => ({ id: str(m.id), label: str(m.label) || str(m.id), available: m.available === true })),
            ...(Array.isArray(raw.models)
                ? { models: list(raw.models).map((m) => ({ id: str(m.id), label: str(m.label) || str(m.id), adapter: str(m.adapter), ...(typeof m.tier === 'string' ? { tier: m.tier } : {}), ...(typeof m.cost === 'string' ? { cost: m.cost } : {}), ...(typeof m.bestFor === 'string' ? { bestFor: m.bestFor } : {}) })) }
                : {})
        };
    }
    /** `POST /api/attachments` — stages bytes in the Bridge's (evicting) pantry and returns a fresh opaque id. */
    async uploadAttachment(input) {
        const raw = await this.request('POST', '/api/attachments', input, UPLOAD_TIMEOUT_MS);
        return raw.attachment;
    }
    listMissions() {
        return this.request('GET', '/api/missions');
    }
    getMission(id) {
        return this.request('GET', `/api/missions/${encodeURIComponent(id)}`);
    }
    /** `POST /api/missions` — creates AND starts the mission. */
    async createMission(input) {
        const raw = await this.request('POST', '/api/missions', input);
        return raw.mission;
    }
    /**
     * Subscribes to `GET /api/events` with automatic reconnect (exponential
     * backoff). Returns a function that stops it.
     */
    subscribe(onEvent, onState, minRetryMs = 1000, maxRetryMs = 30_000) {
        let closed = false;
        let attempt = 0;
        let controller = null;
        let retry = null;
        const schedule = () => {
            if (closed)
                return;
            const delay = Math.min(maxRetryMs, minRetryMs * 2 ** attempt);
            attempt += 1;
            retry = setTimeout(() => void connect(), delay);
            retry.unref?.();
        };
        const connect = async () => {
            if (closed)
                return;
            controller = new AbortController();
            try {
                const res = await this.fetchImpl(`${this.baseUrl}/api/events`, {
                    headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' },
                    signal: controller.signal
                });
                if (!res.ok || !res.body)
                    throw new Error(`SSE connection failed with HTTP ${res.status}`);
                attempt = 0;
                onState?.(true);
                const reader = res.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done)
                        break;
                    buffer += decoder.decode(value, { stream: true });
                    if (buffer.length > 8 * 1024 * 1024)
                        throw new Error('SSE buffer overflow');
                    let idx = buffer.indexOf('\n\n');
                    while (idx !== -1) {
                        const frame = parseSseFrame(buffer.slice(0, idx));
                        buffer = buffer.slice(idx + 2);
                        if (frame)
                            onEvent(frame);
                        idx = buffer.indexOf('\n\n');
                    }
                }
                if (!closed)
                    onState?.(false, 'SSE stream ended');
            }
            catch (err) {
                if (closed)
                    return;
                onState?.(false, this.redact(err instanceof Error ? err.message : String(err)));
            }
            schedule();
        };
        void connect();
        return () => {
            closed = true;
            if (retry)
                clearTimeout(retry);
            controller?.abort();
        };
    }
}
function stringRecord(v) {
    const out = {};
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        for (const [k, val] of Object.entries(v))
            if (typeof val === 'string')
                out[k] = val;
    }
    return out;
}
function parseEnvelope(text) {
    try {
        const v = text ? JSON.parse(text) : null;
        return typeof v === 'object' && v !== null ? v : null;
    }
    catch {
        return null;
    }
}
/** Parses one SSE frame ("event: x\ndata: {json}"); null for comments/heartbeats/bad JSON. */
export function parseSseFrame(frame) {
    let event = 'message';
    const data = [];
    for (const raw of frame.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (line === '' || line.startsWith(':'))
            continue;
        if (line.startsWith('event:'))
            event = line.slice(6).trim();
        else if (line.startsWith('data:'))
            data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length === 0)
        return null;
    try {
        return { event, data: JSON.parse(data.join('\n')) };
    }
    catch {
        return null;
    }
}
