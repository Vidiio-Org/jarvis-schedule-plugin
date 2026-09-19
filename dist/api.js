import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { BridgeError } from './bridge.js';
import { NotFoundError } from './service.js';
import { ValidationError } from './validation.js';
const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff'
};
const SECURITY_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
class HttpError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
function digest(s) {
    return createHash('sha256').update(s).digest();
}
/** Local dashboard server: static ui/ + the token-protected /api/*. Binds 127.0.0.1 only. */
export class ApiServer {
    opts;
    server = null;
    tokenDigest;
    actualPort = 0;
    constructor(opts) {
        this.opts = opts;
        this.tokenDigest = digest(opts.token);
    }
    get port() {
        return this.actualPort;
    }
    start() {
        return new Promise((resolve, reject) => {
            const server = createServer((req, res) => {
                void this.handle(req, res).catch((err) => {
                    this.opts.log('error', `Unhandled API error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
                    if (!res.headersSent)
                        this.sendJson(res, 500, { ok: false, code: 'INTERNAL', message: 'Internal error' });
                    else
                        res.end();
                });
            });
            server.on('error', reject);
            server.listen(this.opts.port, '127.0.0.1', () => {
                server.off('error', reject);
                this.actualPort = server.address().port;
                this.server = server;
                resolve(this.actualPort);
            });
        });
    }
    stop() {
        return new Promise((resolve) => {
            const server = this.server;
            if (!server)
                return resolve();
            this.server = null;
            server.close(() => resolve());
            server.closeAllConnections();
        });
    }
    /* ── plumbing ── */
    sendJson(res, status, body) {
        const payload = JSON.stringify(body);
        res.writeHead(status, {
            ...SECURITY_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(payload)
        });
        res.end(payload);
    }
    hostAllowed(host) {
        if (!host)
            return false;
        const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host.toLowerCase());
        if (!m)
            return false;
        if (!ALLOWED_HOSTNAMES.has(m[1] ?? ''))
            return false;
        return m[2] === undefined || Number(m[2]) === this.actualPort;
    }
    authorized(req) {
        const header = req.headers.authorization ?? '';
        if (!header.startsWith('Bearer '))
            return false;
        return timingSafeEqual(digest(header.slice(7).trim()), this.tokenDigest);
    }
    readBody(req) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let size = 0;
            req.on('data', (chunk) => {
                size += chunk.length;
                if (size > MAX_BODY_BYTES) {
                    reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${MAX_BODY_BYTES} bytes.`));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (raw.trim() === '')
                    return resolve({});
                try {
                    resolve(JSON.parse(raw));
                }
                catch {
                    reject(new ValidationError('body: is not valid JSON'));
                }
            });
            req.on('error', () => reject(new ValidationError('body: request aborted')));
        });
    }
    async handle(req, res) {
        // Anti DNS-rebinding: a page on evil.example resolving to 127.0.0.1 still sends its own Host.
        if (!this.hostAllowed(req.headers.host)) {
            return this.sendJson(res, 403, { ok: false, code: 'FORBIDDEN_HOST', message: 'Host header not allowed.' });
        }
        let url;
        try {
            url = new URL(req.url ?? '/', 'http://localhost');
        }
        catch {
            return this.sendJson(res, 400, { ok: false, code: 'VALIDATION_ERROR', message: 'Bad request URL.' });
        }
        const method = req.method ?? 'GET';
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
            if (!this.authorized(req)) {
                return this.sendJson(res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'Missing or invalid dashboard token.' });
            }
            try {
                const [status, data] = await this.route(method, url, req);
                return this.sendJson(res, status, { ok: true, data });
            }
            catch (err) {
                return this.sendError(res, err);
            }
        }
        return this.serveStatic(method, url.pathname, res);
    }
    sendError(res, err) {
        if (err instanceof HttpError)
            return this.sendJson(res, err.status, { ok: false, code: err.code, message: err.message });
        if (err instanceof ValidationError)
            return this.sendJson(res, 400, { ok: false, code: 'VALIDATION_ERROR', message: err.message });
        if (err instanceof NotFoundError)
            return this.sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: err.message });
        if (err instanceof BridgeError) {
            return this.sendJson(res, 502, { ok: false, code: 'BRIDGE_UNAVAILABLE', message: `ADE Bridge unavailable: ${err.message}` });
        }
        this.opts.log('error', `API error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        return this.sendJson(res, 500, { ok: false, code: 'INTERNAL', message: 'Internal error' });
    }
    /* ── /api routes ── */
    async route(method, url, req) {
        const svc = this.opts.service;
        const path = url.pathname.replace(/\/+$/, '');
        const only = (allowed) => {
            if (method !== allowed)
                throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Use ${allowed} for ${path}.`);
        };
        if (path === '/api/health') {
            only('GET');
            return [
                200,
                {
                    version: svc.version,
                    bridgeConnected: await svc.bridgeConnected(),
                    now: new Date().toISOString(),
                    timezone: svc.config.defaultTimezone
                }
            ];
        }
        if (path === '/api/workspaces') {
            only('GET');
            return [200, await svc.workspaces()];
        }
        if (path === '/api/catalog') {
            only('GET');
            return [200, { squads: await svc.squads() }];
        }
        if (path === '/api/schedules') {
            if (method === 'GET')
                return [200, await svc.listSchedules()];
            if (method === 'POST')
                return [201, await svc.createSchedule(await this.readBody(req))];
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST for /api/schedules.');
        }
        const runNow = /^\/api\/schedules\/([^/]+)\/run$/.exec(path);
        if (runNow) {
            only('POST');
            const outcome = await svc.runNow(decodeURIComponent(runNow[1]));
            if (outcome.bridgeUnavailable) {
                throw new HttpError(502, 'BRIDGE_UNAVAILABLE', `ADE Bridge unavailable: ${outcome.run.error ?? 'could not reach the Bridge'}`);
            }
            return [200, outcome.run];
        }
        const one = /^\/api\/schedules\/([^/]+)$/.exec(path);
        if (one) {
            const id = decodeURIComponent(one[1]);
            if (method === 'PUT')
                return [200, await svc.updateSchedule(id, await this.readBody(req))];
            if (method === 'DELETE') {
                svc.deleteSchedule(id);
                return [200, null];
            }
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use PUT or DELETE for /api/schedules/:id.');
        }
        if (path === '/api/runs') {
            only('GET');
            const limitRaw = url.searchParams.get('limit');
            const scheduleId = url.searchParams.get('scheduleId') || undefined;
            return [200, svc.listRuns({ scheduleId, limit: limitRaw === null || limitRaw === '' ? undefined : Number(limitRaw) })];
        }
        const runOne = /^\/api\/runs\/([^/]+)$/.exec(path);
        if (runOne) {
            only('GET');
            return [200, svc.getRun(decodeURIComponent(runOne[1]))];
        }
        throw new HttpError(404, 'NOT_FOUND', `No route for ${method} ${path}.`);
    }
    /* ── static files ── */
    async serveStatic(method, rawPath, res) {
        if (method !== 'GET' && method !== 'HEAD') {
            return this.sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported here.' });
        }
        let decoded;
        try {
            decoded = decodeURIComponent(rawPath);
        }
        catch {
            return this.sendJson(res, 400, { ok: false, code: 'VALIDATION_ERROR', message: 'Bad path encoding.' });
        }
        const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
        const segments = rel.split('/');
        const bad = decoded.includes('\0') ||
            decoded.includes('\\') ||
            segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.')) ||
            segments[0] === 'dev'; // ui/dev/ holds dev-only tooling (mock server) and is never served
        if (bad)
            return this.notFound(res, decoded === '/');
        try {
            const root = await realpath(this.opts.uiDir);
            const file = await realpath(join(root, ...segments));
            if (!file.startsWith(root + sep))
                return this.notFound(res, false);
            const info = await stat(file);
            if (!info.isFile())
                return this.notFound(res, false);
            const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
            const body = await readFile(file);
            res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': body.length });
            res.end(method === 'HEAD' ? undefined : body);
        }
        catch {
            return this.notFound(res, decoded === '/');
        }
    }
    notFound(res, isRoot) {
        if (isRoot) {
            const html = '<!doctype html><meta charset="utf-8"><title>Jarvis Schedule</title><p>The dashboard UI is not installed (ui/index.html is missing). The API is available under /api.</p>';
            res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
            res.end(html);
            return;
        }
        this.sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Not found.' });
    }
}
