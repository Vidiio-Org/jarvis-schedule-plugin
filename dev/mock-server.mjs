// Dev-only mock of the plugin REST API, for working on ui/ without a sidecar or a Bridge.
// Not part of the shipped package (see "files" in package.json); the real sidecar serves ui/.
//
// Usage: node dev/mock-server.mjs   (PORT=4871 TOKEN=dev-token by default)
// Extra dev hooks (no auth):
//   POST /__mock/bridge  {"connected": false}   simulate the ADE Bridge being down
//   POST /__mock/reset                          restore the fixtures

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const PORT = Number(process.env.PORT ?? 4871);
const TOKEN = process.env.TOKEN ?? 'dev-token';
const DEFAULT_TZ = 'America/Sao_Paulo';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const WORKSPACES = [
  { id: 'ws-staff', name: 'staff-agent', path: '/home/vidiio/projects/vidiio/staff-agent' },
  { id: 'ws-saas', name: 'jarvis-saas', path: '/home/vidiio/projects/vidiio/jarvis-saas' },
  { id: 'ws-docs', name: 'docs-internos', path: '/home/vidiio/projects/vidiio/docs-internos' },
];
const SQUADS = [
  { id: 'squad-qa', name: 'Squad de QA' },
  { id: 'squad-release', name: 'Squad de Release' },
];

// ---- timezone helpers (DST-safe enough for a mock) -------------------------------------

function tzParts(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(ts);
  return Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
}

function zonedToUtc(y, mo, d, hh, mm, tz) {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const p = tzParts(guess, tz);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(guess / 1000) * 1000;
  return guess - offset;
}

function nextRunAt(s) {
  if (!s.enabled || !s.days.length) return null;
  const [hh, mm] = s.time.split(':').map(Number);
  const now = Date.now();
  const today = tzParts(now, s.timezone);
  for (let i = 0; i < 9; i++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    if (!s.days.includes(day.getUTCDay())) continue;
    const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, s.timezone);
    if (at > now) return new Date(at).toISOString();
  }
  return null;
}

// ---- in-memory state ---------------------------------------------------------------------

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const H = 3600_000;
const DAY = 24 * H;

let schedules = [];
let runs = [];
let bridgeConnected = true;
const timers = new Set();

function seed() {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  bridgeConnected = true;

  schedules = [
    {
      id: 'sch-daily-qa',
      name: 'Varredura diária de QA',
      briefing:
        'Rode a suíte de testes do staff-agent, investigue qualquer falha e abra um card de bug para cada regressão.\n\nRegras:\n- Não altere código de produção.\n- Anexe o log dos testes ao card.',
      workspaceId: 'ws-staff',
      time: '08:30',
      days: [1, 2, 3, 4, 5],
      timezone: DEFAULT_TZ,
      squadId: 'squad-qa',
      enabled: true,
      createdAt: iso(20 * DAY),
      updatedAt: iso(3 * DAY),
    },
    {
      id: 'sch-weekly-report',
      name: 'Relatório semanal de deploys',
      briefing: 'Levante os deploys da semana no jarvis-saas e escreva um resumo executivo em português.',
      workspaceId: 'ws-saas',
      time: '18:00',
      days: [5],
      timezone: DEFAULT_TZ,
      squadId: null,
      enabled: true,
      createdAt: iso(40 * DAY),
      updatedAt: iso(10 * DAY),
    },
    {
      id: 'sch-docs-sync',
      name: 'Sincronizar documentação',
      briefing: 'Compare a documentação interna com o código e liste divergências.',
      workspaceId: 'ws-docs',
      time: '06:00',
      days: [0, 1, 2, 3, 4, 5, 6],
      timezone: 'UTC',
      squadId: null,
      enabled: false,
      createdAt: iso(60 * DAY),
      updatedAt: iso(30 * DAY),
    },
  ];

  runs = [
    {
      id: 'run-001',
      scheduleId: 'sch-daily-qa',
      scheduleName: 'Varredura diária de QA',
      trigger: 'schedule',
      scheduledFor: iso(3 * H),
      dispatchedAt: iso(3 * H - 4000),
      status: 'finished',
      missionId: 'mis-8f21',
      missionName: 'Varredura diária de QA — 19/09',
      finishedAt: iso(3 * H - 22 * 60_000),
      error: null,
      summary:
        'Suíte de testes executada: 412 testes, 409 passaram, 3 falharam.\n\nFalhas investigadas:\n1. scheduler.dst.test — fuso America/Sao_Paulo (regressão)\n2. api.auth.test — timeout intermitente\n3. history.prune.test — ordem não determinística\n\nAbri 1 card de bug (scheduler DST) e marquei os outros 2 como flaky.\nNenhum código de produção foi alterado.',
      result: {
        tasks: [
          { title: 'Rodar suíte de testes', status: 'done', result: '412 testes: 409 ok, 3 falhas.' },
          {
            title: 'Investigar falhas',
            status: 'done',
            result:
              'scheduler.dst.test falha por regressão real.\nOs outros dois são flaky.\nTeste de escape: <b>negrito?</b> <img src=x onerror=alert(1)>',
          },
          { title: 'Abrir card de bug', status: 'done', result: 'Card criado: "Scheduler ignora DST".' },
        ],
        costUsd: 1.2345,
        raw: { missionId: 'mis-8f21', status: 'finished', tokens: { input: 182340, output: 20411 }, agents: 3 },
      },
    },
    {
      id: 'run-002',
      scheduleId: 'sch-weekly-report',
      scheduleName: 'Relatório semanal de deploys',
      trigger: 'schedule',
      scheduledFor: iso(2 * DAY),
      dispatchedAt: iso(2 * DAY - 3000),
      status: 'failed',
      missionId: 'mis-77c0',
      missionName: 'Relatório semanal de deploys — 17/09',
      finishedAt: iso(2 * DAY - 9 * 60_000),
      error: 'A missão terminou com erro: o maestro perdeu acesso ao repositório (permission denied).',
      summary: null,
      result: {
        tasks: [{ title: 'Levantar deploys', status: 'failed', result: 'permission denied' }],
        costUsd: null,
        raw: null,
      },
    },
    {
      id: 'run-003',
      scheduleId: 'sch-daily-qa',
      scheduleName: 'Varredura diária de QA',
      trigger: 'schedule',
      scheduledFor: iso(1 * DAY + 3 * H),
      dispatchedAt: null,
      status: 'missed',
      missionId: null,
      missionName: null,
      finishedAt: null,
      error: 'Horário perdido: o ADE estava fechado (janela de tolerância de 15 min excedida).',
      summary: null,
      result: null,
    },
    {
      id: 'run-004',
      scheduleId: 'sch-docs-sync',
      scheduleName: 'Sincronizar documentação',
      trigger: 'manual',
      scheduledFor: null,
      dispatchedAt: null,
      status: 'dispatch_failed',
      missionId: null,
      missionName: null,
      finishedAt: null,
      error: 'BRIDGE_UNAVAILABLE: connect ECONNREFUSED 127.0.0.1:4820',
      summary: null,
      result: null,
    },
    {
      id: 'run-005',
      scheduleId: 'sch-weekly-report',
      scheduleName: 'Relatório semanal de deploys',
      trigger: 'manual',
      scheduledFor: null,
      dispatchedAt: iso(2 * 60_000),
      status: 'running',
      missionId: 'mis-a1b9',
      missionName: 'Relatório semanal de deploys — teste',
      finishedAt: null,
      error: null,
      summary: null,
      result: null,
    },
    {
      id: 'run-006',
      scheduleId: 'sch-daily-qa',
      scheduleName: 'Varredura diária de QA',
      trigger: 'schedule',
      scheduledFor: iso(2 * DAY + 3 * H),
      dispatchedAt: iso(2 * DAY + 3 * H - 5000),
      status: 'finished',
      missionId: 'mis-5d3e',
      missionName: 'Varredura diária de QA — 17/09',
      finishedAt: iso(2 * DAY + 3 * H - 30 * 60_000),
      error: null,
      summary: 'Todos os 412 testes passaram. Nada a reportar.',
      result: { tasks: [], costUsd: 0.98, raw: null },
    },
  ];
}
seed();

const withNext = (s) => ({
  ...s,
  workspaceName: WORKSPACES.find((w) => w.id === s.workspaceId)?.name ?? null,
  nextRunAt: nextRunAt(s),
  lastRunAt:
    runs
      .filter((r) => r.scheduleId === s.id && r.dispatchedAt)
      .map((r) => r.dispatchedAt)
      .sort()
      .at(-1) ?? null,
});

// ---- validation --------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (message) => new HttpError(400, 'VALIDATION_ERROR', message);

function validateInput(b) {
  if (!b || typeof b !== 'object') throw bad('Corpo inválido.');
  if (typeof b.name !== 'string' || !b.name.trim()) throw bad('name é obrigatório.');
  if (typeof b.briefing !== 'string' || !b.briefing.trim()) throw bad('briefing é obrigatório.');
  if (typeof b.workspaceId !== 'string' || !WORKSPACES.some((w) => w.id === b.workspaceId))
    throw bad('workspaceId não existe no ADE.');
  if (typeof b.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) throw bad('time deve estar no formato HH:MM.');
  if (!Array.isArray(b.days) || !b.days.length || !b.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
    throw bad('days deve ter ao menos um dia (0=Dom … 6=Sáb).');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: b.timezone });
  } catch {
    throw bad('timezone não é um fuso IANA válido.');
  }
  if (b.squadId != null && !SQUADS.some((s) => s.id === b.squadId)) throw bad('squadId não existe no catálogo.');
  if (typeof b.enabled !== 'boolean') throw bad('enabled deve ser booleano.');
  return {
    name: b.name.trim(),
    briefing: b.briefing,
    workspaceId: b.workspaceId,
    time: b.time,
    days: [...new Set(b.days)].sort(),
    timezone: b.timezone,
    squadId: b.squadId ?? null,
    enabled: b.enabled,
  };
}

// ---- manual run simulation ---------------------------------------------------------------

function later(ms, fn) {
  const t = setTimeout(() => {
    timers.delete(t);
    fn();
  }, ms);
  timers.add(t);
}

function dispatchManual(s) {
  if (!bridgeConnected) throw new HttpError(502, 'BRIDGE_UNAVAILABLE', 'O Bridge do ADE não está acessível.');
  const run = {
    id: `run-${randomUUID().slice(0, 8)}`,
    scheduleId: s.id,
    scheduleName: s.name,
    trigger: 'manual',
    scheduledFor: null,
    dispatchedAt: new Date().toISOString(),
    status: 'dispatching',
    missionId: null,
    missionName: null,
    finishedAt: null,
    error: null,
    summary: null,
    result: null,
  };
  runs.unshift(run);
  later(1200, () => {
    run.status = 'running';
    run.missionId = `mis-${randomUUID().slice(0, 4)}`;
    run.missionName = `${s.name} — manual`;
  });
  later(7000, () => {
    run.status = 'finished';
    run.finishedAt = new Date().toISOString();
    run.summary = `Missão manual concluída.\nBriefing executado no workspace ${s.workspaceId}.`;
    run.result = { tasks: [{ title: 'Executar briefing', status: 'done', result: 'ok' }], costUsd: 0.31, raw: null };
  });
  return run;
}

// ---- routing -----------------------------------------------------------------------------

function route(method, url, body) {
  const path = url.pathname;
  let m;

  if (method === 'GET' && path === '/api/health')
    return { status: 200, data: { version: '0.1.0-mock', bridgeConnected, now: new Date().toISOString(), timezone: DEFAULT_TZ } };
  if (method === 'GET' && path === '/api/workspaces') {
    if (!bridgeConnected) throw new HttpError(502, 'BRIDGE_UNAVAILABLE', 'O Bridge do ADE não está acessível.');
    return { status: 200, data: WORKSPACES };
  }
  if (method === 'GET' && path === '/api/catalog') return { status: 200, data: { squads: bridgeConnected ? SQUADS : [] } };

  if (path === '/api/schedules') {
    if (method === 'GET') return { status: 200, data: schedules.map(withNext) };
    if (method === 'POST') {
      const now = new Date().toISOString();
      const s = { id: `sch-${randomUUID().slice(0, 8)}`, ...validateInput(body), createdAt: now, updatedAt: now };
      schedules.push(s);
      return { status: 201, data: withNext(s) };
    }
  }
  if ((m = path.match(/^\/api\/schedules\/([^/]+)\/run$/)) && method === 'POST') {
    const s = schedules.find((x) => x.id === m[1]);
    if (!s) throw new HttpError(404, 'NOT_FOUND', 'Agendamento não encontrado.');
    return { status: 200, data: dispatchManual(s) };
  }
  if ((m = path.match(/^\/api\/schedules\/([^/]+)$/))) {
    const s = schedules.find((x) => x.id === m[1]);
    if (!s) throw new HttpError(404, 'NOT_FOUND', 'Agendamento não encontrado.');
    if (method === 'PUT') {
      Object.assign(s, validateInput(body), { updatedAt: new Date().toISOString() });
      return { status: 200, data: withNext(s) };
    }
    if (method === 'DELETE') {
      schedules = schedules.filter((x) => x !== s);
      return { status: 200, data: null };
    }
  }

  if (method === 'GET' && path === '/api/runs') {
    const sid = url.searchParams.get('scheduleId');
    const limit = Number(url.searchParams.get('limit')) || 100;
    const key = (r) => r.dispatchedAt ?? r.scheduledFor ?? '';
    const list = runs
      .filter((r) => !sid || r.scheduleId === sid)
      .sort((a, b) => key(b).localeCompare(key(a)))
      .slice(0, limit);
    return { status: 200, data: list };
  }
  if ((m = path.match(/^\/api\/runs\/([^/]+)$/)) && method === 'GET') {
    const r = runs.find((x) => x.id === m[1]);
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'Disparo não encontrado.');
    return { status: 200, data: r };
  }
  throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
}

// ---- http plumbing -----------------------------------------------------------------------

function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw bad('JSON inválido.');
  }
}

async function serveStatic(res, pathname) {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = resolve(join(UI_ROOT, rel));
  // no path traversal outside ui/
  if (!file.startsWith(UI_ROOT + sep)) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/__mock/bridge' && req.method === 'POST') {
      bridgeConnected = Boolean((await readBody(req))?.connected);
      return send(res, 200, { ok: true, data: { bridgeConnected } });
    }
    if (url.pathname === '/__mock/reset' && req.method === 'POST') {
      seed();
      return send(res, 200, { ok: true, data: null });
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.authorization !== `Bearer ${TOKEN}`)
        return send(res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'Token inválido.' });
      const out = route(req.method, url, ['POST', 'PUT'].includes(req.method) ? await readBody(req) : undefined);
      return send(res, out.status, { ok: true, data: out.data });
    }
    if (req.method === 'GET') return await serveStatic(res, url.pathname);
    res.writeHead(405).end();
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { ok: false, code: err.code, message: err.message });
    console.error(err);
    send(res, 500, { ok: false, code: 'INTERNAL', message: 'Erro interno.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock dashboard on http://127.0.0.1:${PORT}  (token: ${TOKEN})`);
});
