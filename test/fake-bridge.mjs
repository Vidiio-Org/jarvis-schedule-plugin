/**
 * Reusable fake ADE SaaS Bridge honouring the real wire format
 * (apps/desktop/src/main/services/SaasBridge.ts + saasBridgeStudioRoutes.ts):
 *   - bearer token (header or ?token=), replies enveloped {ok:true,data}/{ok:false,code,message}
 *   - GET  /api/health, /api/snapshot, /api/catalog, /api/missions, /api/missions/:id
 *   - POST /api/missions  (creates AND starts; requires `brief`; validates workspaceId/squadId/mode)
 *   - GET  /api/events    (SSE: `event: hello`, `event: mission:update` with the Mission FLAT, `: ping`)
 *
 * Library use:
 *   const bridge = await startFakeBridge({ token: 'secret' });
 *   bridge.finishMission(id, { summary: '...', tasks: [{ title, status: 'done', result }] });
 *   await bridge.stop();
 * CLI use (for manual / E2E runs):
 *   node test/fake-bridge.mjs --port 4820 --token secret [--auto-finish-ms 3000]
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startFakeBridge(options = {}) {
  const token = options.token ?? 'fake-bridge-token';
  const workspaces = options.workspaces ?? [
    { id: 'ws-1', name: 'Demo workspace', path: '/tmp/demo-workspace' },
    { id: 'ws-2', name: 'Second workspace', path: '/tmp/second-workspace' }
  ];
  const squads = options.squads ?? [{ id: 'squad-1', name: 'Demo squad', description: 'fake', agents: [] }];

  const state = {
    token,
    workspaces,
    squads,
    missions: [],
    tasks: [],
    boardColumns: [],
    boardCards: [],
    /** Every request received: { method, path, body, authorized }. */
    requests: [],
    /** When > 0, the next N POST /api/missions calls answer with `failCreateWith`. */
    failCreate: 0,
    failCreateWith: { status: 409, code: 'MISSION_START_FAILED', message: 'The mission failed to start.' },
    /** When true, POST /api/missions drops the connection without replying. */
    hangUpOnCreate: false,
    sseClients: new Set()
  };

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const ok = (res, data) => send(res, 200, { ok: true, data });
  const err = (res, status, code, message) => send(res, status, { ok: false, code, message });

  const sse = (event, payload) => {
    for (const client of state.sseClients) client.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const snapshot = () => ({
    activeWorkspaceId: workspaces[0]?.id ?? null,
    workspaces,
    missions: state.missions,
    tasks: state.tasks,
    boardColumns: state.boardColumns,
    boardCards: state.boardCards,
    panes: []
  });

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(new Error('BAD_JSON'));
        }
      });
      req.on('error', reject);
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';
    const header = req.headers.authorization ?? '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
    const record = { method, path: url.pathname, body: undefined, authorized: supplied === token };
    state.requests.push(record);
    if (supplied !== token) {
      return err(res, 401, 'UNAUTHORIZED', 'Missing or invalid token — pass "Authorization: Bearer <token>" or "?token=<token>".');
    }
    try {
      if (method === 'GET' && url.pathname === '/api/health') {
        return ok(res, { version: '0.0.0-fake', app: 'ade', activeWorkspaceId: workspaces[0]?.id ?? null });
      }
      if (method === 'GET' && url.pathname === '/api/snapshot') return ok(res, snapshot());
      if (method === 'GET' && url.pathname === '/api/catalog') {
        return ok(res, {
          activeWorkspaceId: workspaces[0]?.id ?? null,
          workspaces,
          squads: squads.map((s) => ({ id: s.id, name: s.name, description: s.description ?? '', agents: s.agents ?? [] })),
          maestros: [{ id: 'mock', label: 'Mock', available: true }]
        });
      }
      if (method === 'GET' && url.pathname === '/api/missions') {
        return ok(res, { missions: state.missions, tasks: state.tasks });
      }
      const one = /^\/api\/missions\/([^/]+)$/.exec(url.pathname);
      if (method === 'GET' && one) {
        const id = decodeURIComponent(one[1]);
        const mission = state.missions.find((m) => m.id === id);
        if (!mission) return err(res, 404, 'NOT_FOUND', `Mission "${id}" does not exist.`);
        return ok(res, {
          mission,
          tasks: state.tasks.filter((t) => t.missionId === id),
          boardColumns: state.boardColumns.filter((c) => c.missionId === id),
          boardCards: state.boardCards.filter((c) => c.missionId === id)
        });
      }
      if (method === 'POST' && url.pathname === '/api/missions') {
        if (state.hangUpOnCreate) {
          record.body = await readBody(req).catch(() => undefined);
          req.socket.destroy();
          return;
        }
        let body;
        try {
          body = await readBody(req);
        } catch {
          return err(res, 400, 'BAD_JSON', 'Request body is not valid JSON.');
        }
        record.body = body;
        if (state.failCreate > 0) {
          state.failCreate -= 1;
          const f = state.failCreateWith;
          return err(res, f.status, f.code, f.message);
        }
        if (typeof body.brief !== 'string' || body.brief.trim() === '') {
          return err(res, 400, 'BAD_REQUEST', '"brief" is required and must not be empty.');
        }
        if (body.mode !== undefined && !['free', 'squad', 'agentic'].includes(body.mode)) {
          return err(res, 400, 'BAD_REQUEST', '"mode" must be one of free, squad, agentic.');
        }
        const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : workspaces[0]?.id;
        if (!workspaces.some((w) => w.id === workspaceId)) {
          return err(res, 404, 'NOT_FOUND', `Workspace "${workspaceId}" does not exist.`);
        }
        let squadId = null;
        if (typeof body.squadId === 'string') {
          if (!squads.some((s) => s.id === body.squadId)) return err(res, 404, 'NOT_FOUND', `Squad "${body.squadId}" does not exist.`);
          squadId = body.squadId;
        }
        const mission = {
          id: randomUUID(),
          workspaceId,
          name: typeof body.name === 'string' ? body.name : `Mission ${state.missions.length + 1}`,
          mode: body.mode ?? (squadId ? 'squad' : 'free'),
          squadId,
          maestro: body.maestro ?? 'mock',
          brief: body.brief,
          attachments: [],
          worktree: null,
          status: 'running',
          archived: false,
          usd: 0,
          inputTokens: 0,
          outputTokens: 0,
          maxUsd: null,
          startedAt: Date.now(),
          finishedAt: null,
          summary: null
        };
        state.missions.push(mission);
        sse('mission:update', mission);
        if (options.autoFinishMs) {
          setTimeout(() => api.finishMission(mission.id, { summary: 'Auto-finished by the fake bridge.' }), options.autoFinishMs).unref();
        }
        return ok(res, { mission });
      }
      if (method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive'
        });
        res.write(`event: hello\ndata: ${JSON.stringify({ snapshot: snapshot() })}\n\n`);
        state.sseClients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
        ping.unref();
        const drop = () => {
          clearInterval(ping);
          state.sseClients.delete(res);
        };
        req.on('close', drop);
        res.on('close', drop);
        return;
      }
      return err(res, 404, 'NOT_FOUND', `No route for ${method} ${url.pathname}.`);
    } catch (e) {
      return err(res, 500, 'INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  const api = {
    state,
    token,
    port,
    url: `http://127.0.0.1:${port}`,
    get missions() {
      return state.missions;
    },
    get requests() {
      return state.requests;
    },
    /** POST /api/missions requests only. */
    get createRequests() {
      return state.requests.filter((r) => r.method === 'POST' && r.path === '/api/missions');
    },
    /**
     * Ends a mission like the maestro's mission_finish would: sets status
     * (default 'done'), summary, finishedAt, usd, adds tasks, and pushes a
     * FLAT `mission:update` over SSE.
     */
    finishMission(id, { status = 'done', summary = 'Done.', tasks = [], usd = 0.42, cards = [] } = {}) {
      const mission = state.missions.find((m) => m.id === id);
      if (!mission) throw new Error(`fake bridge: unknown mission ${id}`);
      tasks.forEach((t, i) =>
        state.tasks.push({
          id: randomUUID(),
          missionId: id,
          title: t.title,
          assignedPaneId: null,
          status: t.status ?? 'done',
          result: t.result ?? null,
          order: i
        })
      );
      if (cards.length > 0) {
        state.boardColumns.push({ id: `${id}-col`, missionId: id, title: 'Concluído', order: 0 });
        cards.forEach((c, i) =>
          state.boardCards.push({ id: `${id}-card-${i}`, missionId: id, columnId: `${id}-col`, type: 'task', title: c.title, description: c.description ?? '', docs: c.docs ?? '', order: i })
        );
      }
      Object.assign(mission, { status, summary, usd, finishedAt: Date.now() });
      sse('mission:update', mission);
      return mission;
    },
    /** Sends a `mission:update` for the current state of a mission without changing it. */
    publish(id) {
      const mission = state.missions.find((m) => m.id === id);
      if (mission) sse('mission:update', mission);
    },
    /** Drops every open SSE connection (clients should reconnect). */
    dropSseClients() {
      for (const c of state.sseClients) c.destroy();
      state.sseClients.clear();
    },
    async stop() {
      for (const c of state.sseClients) c.destroy();
      state.sseClients.clear();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
  return api;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : fallback;
  };
  const bridge = await startFakeBridge({
    port: Number(arg('port', '4820')),
    token: arg('token', 'fake-bridge-token'),
    autoFinishMs: Number(arg('auto-finish-ms', '0'))
  });
  console.log(`fake ADE bridge listening on ${bridge.url} (token=${bridge.token})`);
  const shutdown = () => bridge.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
