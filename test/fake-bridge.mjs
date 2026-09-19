/**
 * Reusable fake ADE SaaS Bridge honouring the real wire format
 * (apps/desktop/src/main/services/SaasBridge.ts + saasBridgeStudioRoutes.ts):
 *   - bearer token (header or ?token=), replies enveloped {ok:true,data}/{ok:false,code,message}
 *   - GET  /api/health, /api/snapshot, /api/catalog, /api/missions, /api/missions/:id
 *   - POST /api/missions  (creates AND starts; requires `brief`; validates workspaceId/squadId/mode)
 *   - GET  /api/events    (SSE: `event: hello`, `event: mission:update` with the Mission FLAT, `: ping`)
 *   - POST /api/attachments (staging pantry: {name, mime, data: base64} -> {attachment:{id,name,mime,size}}; evicts
 *     the oldest id past `attachmentRegistryMax`, like the real MissionAttachmentRegistry)
 *   - POST /api/missions also validates maestro, e2e, stack, attachmentIds and (modern mode) modelPool/agentModels
 *   - GET  /api/catalog serves squads with agents, maestros and — unless `legacy` — `models`
 *
 * `legacy: true` (CLI: --legacy) emulates an OLD bridge: no `models` in the catalog, and modelPool/agentModels in a
 * mission body are silently ignored (the request is still recorded so tests can assert none was sent).
 *
 * Library use:
 *   const bridge = await startFakeBridge({ token: 'secret' });
 *   bridge.finishMission(id, { summary: '...', tasks: [{ title, status: 'done', result }] });
 *   await bridge.stop();
 * CLI use (for manual / E2E runs):
 *   node test/fake-bridge.mjs --port 4820 --token secret [--auto-finish-ms 3000] [--legacy]
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startFakeBridge(options = {}) {
  const token = options.token ?? 'fake-bridge-token';
  const workspaces = options.workspaces ?? [
    { id: 'ws-1', name: 'Demo workspace', path: '/tmp/demo-workspace' },
    { id: 'ws-2', name: 'Second workspace', path: '/tmp/second-workspace' }
  ];
  const squads = options.squads ?? [
    {
      id: 'squad-1',
      name: 'Demo squad',
      description: 'Architect, developer and reviewer',
      agents: [
        { agentId: 'architect', name: 'Architect', adapter: 'claude', model: 'claude-opus-5' },
        { agentId: 'developer', name: 'Developer', adapter: 'claude', model: 'claude-sonnet-5' },
        { agentId: 'reviewer', name: 'Reviewer (QA)', adapter: 'codex', model: 'gpt-5.6-terra' }
      ],
      modelPool: [],
      agentModels: {}
    }
  ];
  const legacy = options.legacy === true;
  const models = options.models ?? [
    { id: 'claude-opus-5', label: 'Opus 5', adapter: 'claude', tier: 'frontier', cost: 'high' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', adapter: 'claude', tier: 'standard', cost: 'medium' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', adapter: 'claude', tier: 'fast', cost: 'low' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', adapter: 'codex', tier: 'frontier', cost: 'high' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', adapter: 'codex', tier: 'standard', cost: 'medium' },
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash', adapter: 'gemini', tier: 'fast', cost: 'low' }
  ];
  const maestros = options.maestros ?? [
    { id: 'claude-code', label: 'Claude Code', available: true },
    { id: 'codex', label: 'Codex', available: true },
    { id: 'gemini', label: 'Gemini', available: false },
    { id: 'mock', label: 'Mock (scripted, no CLI required)', available: true }
  ];
  const attachmentRegistryMax = options.attachmentRegistryMax ?? 500;
  const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

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
    sseClients: new Set(),
    legacy,
    /** Attachment staging pantry: id -> {id, name, mime, size, data (base64)}; insertion order = age. */
    attachments: new Map(),
    /** When > 0, the next N POST /api/attachments calls answer with `failUploadWith`. */
    failUpload: 0,
    failUploadWith: { status: 413, code: 'TOO_LARGE', message: 'The attachment exceeds the limit.' }
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
          squads: squads.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description ?? '',
            agents: s.agents ?? [],
            ...(legacy ? {} : { modelPool: s.modelPool ?? [], agentModels: s.agentModels ?? {} })
          })),
          maestros,
          ...(legacy ? {} : { models })
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
      if (method === 'POST' && url.pathname === '/api/attachments') {
        let body;
        try {
          body = await readBody(req);
        } catch {
          return err(res, 400, 'BAD_JSON', 'Request body is not valid JSON.');
        }
        record.body = { ...body, data: typeof body.data === 'string' ? `<${body.data.length} base64 chars>` : body.data, rawData: body.data };
        if (state.failUpload > 0) {
          state.failUpload -= 1;
          const f = state.failUploadWith;
          return err(res, f.status, f.code, f.message);
        }
        if (typeof body.name !== 'string' || body.name.trim() === '') return err(res, 400, 'BAD_REQUEST', '"name" is required and must not be empty.');
        if (typeof body.mime !== 'string' || body.mime.trim() === '') return err(res, 400, 'BAD_REQUEST', '"mime" is required and must not be empty.');
        if (typeof body.data !== 'string' || body.data === '') return err(res, 400, 'BAD_REQUEST', '"data" is required (base64, no data: prefix).');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) return err(res, 400, 'BAD_REQUEST', '"data" is not valid base64.');
        const size = Buffer.byteLength(body.data, 'base64');
        if (size > MAX_ATTACHMENT_BYTES) return err(res, 413, 'TOO_LARGE', `"${body.name}" exceeds the 50 MB attachment limit.`);
        const id = randomUUID();
        state.attachments.set(id, { id, name: body.name, mime: body.mime, size, data: body.data });
        if (state.attachments.size > attachmentRegistryMax) state.attachments.delete(state.attachments.keys().next().value);
        return ok(res, { attachment: { id, name: body.name, mime: body.mime, size } });
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
        if (body.maestro !== undefined && !maestros.some((m) => m.id === body.maestro)) {
          return err(res, 400, 'BAD_REQUEST', `"maestro" must be one of ${maestros.map((m) => m.id).join(', ')}.`);
        }
        if (body.e2e !== undefined && typeof body.e2e !== 'boolean') return err(res, 400, 'BAD_REQUEST', '"e2e" must be a boolean.');
        if (body.stack !== undefined) {
          const layers = ['backend', 'frontend', 'mobile', 'infra', 'other'];
          const okStack =
            body.stack && typeof body.stack === 'object' &&
            Object.entries(body.stack).every(([k, v]) => layers.includes(k) && Array.isArray(v) && v.every((x) => typeof x === 'string'));
          if (!okStack) return err(res, 400, 'BAD_REQUEST', '"stack" must be {backend?, frontend?, mobile?, infra?, other?: string[]}.');
        }
        let attachments = [];
        if (body.attachmentIds !== undefined) {
          if (!Array.isArray(body.attachmentIds) || body.attachmentIds.some((v) => typeof v !== 'string' || v === '')) {
            return err(res, 400, 'BAD_REQUEST', '"attachmentIds" must be an array of non-empty strings.');
          }
          for (const attId of body.attachmentIds) {
            const a = state.attachments.get(attId);
            if (!a) return err(res, 404, 'NOT_FOUND', `Attachment "${attId}" does not exist — it was never uploaded, or it aged out of the upload pantry.`);
            attachments.push({ id: a.id, name: a.name, mime: a.mime, size: a.size });
          }
        }
        let modelPool = [];
        let agentModels = {};
        if (!legacy) {
          if (body.modelPool !== undefined) {
            if (!Array.isArray(body.modelPool) || body.modelPool.some((v) => typeof v !== 'string' || v === '')) {
              return err(res, 400, 'BAD_REQUEST', '"modelPool" must be an array of non-empty strings.');
            }
            const unknown = body.modelPool.find((m) => !models.some((x) => x.id === m));
            if (unknown) return err(res, 400, 'BAD_REQUEST', `Unknown model "${unknown}" in "modelPool".`);
            modelPool = [...new Set(body.modelPool)];
          }
          if (body.agentModels !== undefined) {
            if (typeof body.agentModels !== 'object' || body.agentModels === null || Array.isArray(body.agentModels)) {
              return err(res, 400, 'BAD_REQUEST', '"agentModels" must be an object mapping agent ids to model ids.');
            }
            const roster = squadId ? squads.find((s) => s.id === squadId)?.agents ?? [] : squads.flatMap((s) => s.agents ?? []);
            for (const [agentId, modelId] of Object.entries(body.agentModels)) {
              const agent = roster.find((a) => a.agentId === agentId);
              if (!agent) return err(res, 400, 'BAD_REQUEST', `Unknown agent "${agentId}" in "agentModels".`);
              const model = models.find((m) => m.id === modelId);
              if (!model) return err(res, 400, 'BAD_REQUEST', `Unknown model "${modelId}" in "agentModels".`);
              if (model.adapter !== agent.adapter) {
                return err(res, 400, 'BAD_REQUEST', `Model "${modelId}" (${model.adapter}) does not match agent "${agentId}" (${agent.adapter}).`);
              }
            }
            agentModels = body.agentModels;
          }
        }
        const mission = {
          id: randomUUID(),
          workspaceId,
          name: typeof body.name === 'string' ? body.name : `Mission ${state.missions.length + 1}`,
          mode: body.mode ?? (squadId ? 'squad' : 'free'),
          squadId,
          maestro: body.maestro ?? 'mock',
          brief: body.brief,
          attachments,
          e2e: body.e2e === true,
          stack: body.stack ?? null,
          modelPool,
          agentModels,
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
    /** POST /api/attachments requests only (`body.rawData` holds the base64 payload). */
    get uploadRequests() {
      return state.requests.filter((r) => r.method === 'POST' && r.path === '/api/attachments');
    },
    /** Files currently held by the attachment pantry. */
    get attachments() {
      return [...state.attachments.values()];
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
    autoFinishMs: Number(arg('auto-finish-ms', '0')),
    legacy: process.argv.includes('--legacy')
  });
  console.log(`fake ADE bridge listening on ${bridge.url} (token=${bridge.token})`);
  const shutdown = () => bridge.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
