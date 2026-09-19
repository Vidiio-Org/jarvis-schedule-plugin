// Jarvis Agendador dashboard — vanilla ES module, no build, no CDN, no framework.
// Every piece of API data reaches the DOM through textContent / text nodes / attributes;
// innerHTML is never used.

const TOKEN_KEY = 'jarvis-schedule.dashboardToken';
const HEALTH_INTERVAL_MS = 15_000;
const RUNS_REFRESH_MS = 10_000;
const DETAIL_REFRESH_MS = 5_000;
const ACTIVE_STATUSES = new Set(['dispatching', 'running']);

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const RUN_STATUS = {
  dispatching: { label: 'Disparando', tone: 'live' },
  running: { label: 'Em execução', tone: 'live' },
  finished: { label: 'Concluído', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'error' },
  dispatch_failed: { label: 'Falha no disparo', tone: 'error' },
  missed: { label: 'Perdido', tone: 'warn' },
};
const TASK_STATUS = {
  pending: { label: 'Pendente', tone: 'neutral' },
  todo: { label: 'A fazer', tone: 'neutral' },
  running: { label: 'Em execução', tone: 'live' },
  in_progress: { label: 'Em andamento', tone: 'live' },
  done: { label: 'Concluída', tone: 'ok' },
  completed: { label: 'Concluída', tone: 'ok' },
  finished: { label: 'Concluída', tone: 'ok' },
  failed: { label: 'Falhou', tone: 'error' },
  error: { label: 'Erro', tone: 'error' },
  blocked: { label: 'Bloqueada', tone: 'warn' },
  skipped: { label: 'Ignorada', tone: 'neutral' },
};

const FIELD_KEYS = ['name', 'briefing', 'workspaceId', 'time', 'days', 'timezone', 'squadId', 'enabled', 'maestro', 'e2e', 'stack', 'modelPool', 'agentModels'];

// Same limits the plugin enforces (and the ADE Bridge: 50 MB per file).
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 20;
const STACK_LAYERS = [
  ['backend', 'Backend', 'NestJS, Postgres'],
  ['frontend', 'Frontend', 'React, Vite'],
  ['mobile', 'Mobile', 'Expo'],
  ['infra', 'Infra', 'Docker, Terraform'],
  ['other', 'Outros', 'Redis'],
];
const NO_MODEL_UPDATE_HINT = 'Seleção de modelos indisponível: atualize o Jarvis ADE para escolher modelos.';

const state = {
  token: readToken(),
  health: null,
  shell: null, // { main, nav, conn }
  healthTimer: null,
  view: { id: 0, timers: [] },
};

// ---- small DOM helpers -----------------------------------------------------------------

/** Create an element. `props`: class, on<event> handlers, dataset, boolean/string attributes. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || key === 'checked') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const svgNS = 'http://www.w3.org/2000/svg';
function clockIcon() {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M12 6v6l4 2.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeToken(token) {
  state.token = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sessionStorage unavailable: the token lives in memory only */
  }
}

// ---- formatting ------------------------------------------------------------------------

const dtCache = new Map();
function formatter(tz) {
  if (!dtCache.has(tz)) {
    let f;
    try {
      f = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: tz || undefined });
    } catch {
      f = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
    dtCache.set(tz, f);
  }
  return dtCache.get(tz);
}

/** Dates are shown in the plugin's default timezone so they match the schedules. */
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return formatter(state.health?.timezone).format(d);
}

function fmtDays(days) {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return 'Todos os dias';
  if (set.length === 0) return 'Nenhum';
  if (set.join() === '1,2,3,4,5') return 'Seg–Sex';
  if (set.join() === '0,6') return 'Fins de semana';
  return set.map((d) => DAY_LABELS[d] ?? d).join(', ');
}

function fmtCost(usd) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(usd);
}

function fmtDuration(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const ms = new Date(toIso) - new Date(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60}s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const enc = encodeURIComponent;

// ---- API -------------------------------------------------------------------------------

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.unauthorized = status === 401;
  }
}

const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Token inválido ou expirado.',
  NOT_FOUND: 'Item não encontrado.',
  BRIDGE_UNAVAILABLE: 'O Bridge do ADE não está acessível. Verifique se o Jarvis ADE está aberto.',
  NETWORK: 'Não foi possível falar com o plugin. Verifique se ele está em execução.',
};

async function api(method, path, body, { onUnauthorized = true } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${state.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', ERROR_MESSAGES.NETWORK);
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON reply */
  }
  if (res.status === 401) {
    if (onUnauthorized) logout('Token inválido ou expirado. Entre novamente.');
    throw new ApiError(401, 'UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
  }
  if (!res.ok || !payload || payload.ok !== true) {
    const code = payload?.code ?? `HTTP_${res.status}`;
    // VALIDATION_ERROR carries the field-specific message; the rest gets friendly copy.
    const message = code === 'VALIDATION_ERROR' && payload?.message ? payload.message : ERROR_MESSAGES[code] ?? payload?.message ?? `Erro ${res.status}`;
    throw new ApiError(res.status, code, message);
  }
  return payload.data;
}

// ---- toast / confirm dialog ------------------------------------------------------------

function toast(message, { error = false, href = null, linkText = '' } = {}) {
  const el = h('div', { class: `toast${error ? ' error' : ''}` }, h('span', {}, message), href && h('a', { href }, linkText));
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), error ? 8000 : 5000);
}

function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const dialog = h(
      'dialog',
      { 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title' }, title),
      h('p', {}, message),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancelar'),
        h(
          'button',
          {
            class: `btn ${danger ? 'btn-danger solid' : 'btn-primary'}`,
            type: 'button',
            onClick: () => {
              result = true;
              dialog.close();
            },
          },
          confirmLabel,
        ),
      ),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

// ---- badges ----------------------------------------------------------------------------

function badge(map, status) {
  const info = map[status] ?? { label: String(status ?? '—'), tone: 'neutral' };
  const tone = { ok: 'badge-ok', live: 'badge-live', warn: 'badge-warn', error: 'badge-error' }[info.tone] ?? '';
  return h('span', { class: `badge ${tone}`.trim(), 'data-status': status }, info.label);
}
const runBadge = (s) => badge(RUN_STATUS, s);
const taskBadge = (s) => badge(TASK_STATUS, s);
const triggerLabel = (t) => (t === 'manual' ? 'Manual' : 'Agendado');

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** File -> base64 without the `data:` prefix (what POST /api/schedules/:id/attachments expects). */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Não foi possível ler "${file.name}".`));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

const parseList = (text) => [...new Set(text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))];

// ---- shell / login ---------------------------------------------------------------------

const app = document.getElementById('app');

function logout(message = '') {
  writeToken('');
  clearView();
  clearInterval(state.healthTimer);
  state.health = null;
  state.shell = null;
  mountLogin(message);
}

function mountLogin(message = '') {
  const input = h('input', {
    id: 'token',
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    required: true,
    'aria-describedby': message ? 'login-error' : null,
  });
  const error = h('div', { class: 'alert alert-error', role: 'alert', id: 'login-error' }, message);
  error.hidden = !message;
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Entrar');

  const form = h(
    'form',
    {
      class: 'card login',
      onSubmit: async (event) => {
        event.preventDefault();
        const token = input.value.trim();
        if (!token) return;
        submit.disabled = true;
        error.hidden = true;
        writeToken(token);
        try {
          state.health = await api('GET', '/api/health', undefined, { onUnauthorized: false });
          startShell();
        } catch (err) {
          writeToken('');
          error.textContent = err.unauthorized ? 'Token inválido. Confira o token do painel nas configurações do plugin.' : err.message;
          error.hidden = false;
          submit.disabled = false;
          input.select();
        }
      },
    },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, clockIcon()), 'Jarvis Agendador'),
    h('p', {}, 'Informe o token do painel (configuração “dashboardToken” do plugin) para continuar.'),
    error,
    h('div', { class: 'field' }, h('label', { for: 'token' }, 'Token do painel'), input),
    submit,
  );
  app.replaceChildren(h('div', { class: 'login-wrap' }, form));
  input.focus();
}

function mountShell() {
  const conn = h('span', { class: 'conn', 'data-state': 'unknown', role: 'status' }, h('span', { class: 'dot' }), h('span', { class: 'conn-text' }, 'Verificando…'));
  const nav = h(
    'nav',
    { class: 'nav', 'aria-label': 'Principal' },
    h('a', { href: '#/schedules', 'data-nav': 'schedules' }, 'Agendamentos'),
    h('a', { href: '#/runs', 'data-nav': 'runs' }, 'Histórico'),
  );
  const main = h('main', { id: 'main', tabindex: '-1' });
  app.replaceChildren(
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, clockIcon()), 'Jarvis Agendador'),
      nav,
      h(
        'div',
        { class: 'topbar-end' },
        conn,
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => logout('') }, 'Sair'),
      ),
    ),
    main,
  );
  state.shell = { main, nav, conn };
}

function startShell() {
  mountShell();
  renderConn();
  clearInterval(state.healthTimer);
  state.healthTimer = setInterval(refreshHealth, HEALTH_INTERVAL_MS);
  if (!location.hash || location.hash === '#') location.hash = '#/schedules'; // fires hashchange → route()
  else route();
}

function renderConn(unreachable = false) {
  const conn = state.shell?.conn;
  if (!conn) return;
  const [dotState, text] = unreachable
    ? ['down', 'Plugin sem resposta']
    : state.health?.bridgeConnected
      ? ['ok', 'Bridge conectado']
      : ['down', 'Bridge desconectado'];
  conn.dataset.state = dotState;
  conn.querySelector('.conn-text').textContent = text;
  conn.title = state.health?.version ? `Versão ${state.health.version} · fuso ${state.health.timezone}` : '';
}

async function refreshHealth() {
  try {
    state.health = await api('GET', '/api/health');
    renderConn();
  } catch (err) {
    if (!err.unauthorized) renderConn(true);
  }
}

// ---- router ----------------------------------------------------------------------------

function clearView() {
  state.view.id += 1;
  for (const t of state.view.timers) clearInterval(t);
  state.view.timers = [];
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/schedules';
  const [path, query = ''] = raw.split('?');
  return { segments: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(query) };
}

async function route() {
  if (!state.shell) return;
  clearView();
  const ctx = {
    id: state.view.id,
    alive: () => ctx.id === state.view.id,
    every(ms, fn) {
      state.view.timers.push(setInterval(() => ctx.alive() && fn(), ms));
    },
  };
  const { segments, query } = parseHash();
  const [section, param] = segments;
  const main = state.shell.main;

  for (const a of state.shell.nav.querySelectorAll('a')) {
    if (a.dataset.nav === (section === 'runs' ? 'runs' : 'schedules')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  main.replaceChildren(h('p', { class: 'loading' }, 'Carregando…'));
  try {
    if (section === 'runs' && param) await runDetailView(main, ctx, param);
    else if (section === 'runs') await runsView(main, ctx, query.get('schedule') ?? '');
    else if (section === 'schedules' && param) await scheduleFormView(main, ctx, param === 'new' ? null : param);
    else await schedulesView(main, ctx);
  } catch (err) {
    if (err.unauthorized || !ctx.alive()) return;
    main.replaceChildren(
      h('div', { class: 'alert alert-error', role: 'alert' }, err.message),
      h('button', { class: 'btn', type: 'button', onClick: route }, 'Tentar novamente'),
    );
  }
}

/** Report an action error as a toast; a 401 has already bounced the user to the login. */
function reportError(err, prefix) {
  if (err.unauthorized) return;
  toast(`${prefix}: ${err.message}`, { error: true });
}

// ---- Agendamentos: list ----------------------------------------------------------------

async function schedulesView(main, ctx) {
  const schedules = await api('GET', '/api/schedules');
  if (!ctx.alive()) return;

  const tbody = h('tbody');

  const renderRows = (list) => {
    tbody.replaceChildren(
      ...list.map((s) => {
        const runBtn = h('button', { class: 'btn btn-sm', type: 'button', onClick: () => runNow(s, runBtn) }, 'Executar agora');
        return h(
          'tr',
          { 'data-schedule-id': s.id },
          h(
            'td',
            { 'data-label': 'Nome' },
            h('span', {}, h('span', { class: 'cell-title' }, s.name)),
          ),
          h('td', { 'data-label': 'Workspace' }, s.workspaceName ?? s.workspaceId),
          h('td', { 'data-label': 'Horário', class: 'nowrap' }, s.time),
          h('td', { 'data-label': 'Dias' }, fmtDays(s.days)),
          h('td', { 'data-label': 'Fuso' }, s.timezone),
          h('td', { 'data-label': 'Ativo' }, s.enabled ? h('span', { class: 'badge badge-ok' }, 'Ativo') : h('span', { class: 'badge' }, 'Pausado')),
          h('td', { 'data-label': 'Próxima execução', class: 'nowrap' }, s.enabled ? fmtDate(s.nextRunAt) : '—'),
          h('td', { 'data-label': 'Última execução', class: 'nowrap' }, fmtDate(s.lastRunAt)),
          h(
            'td',
            { class: 'actions' },
            h(
              'div',
              { class: 'action-group' },
              runBtn,
              h('a', { class: 'btn btn-sm', href: `#/schedules/${enc(s.id)}`, 'aria-label': `Editar ${s.name}` }, 'Editar'),
              h('button', { class: 'btn btn-sm btn-danger', type: 'button', 'aria-label': `Excluir ${s.name}`, onClick: () => remove(s) }, 'Excluir'),
            ),
          ),
        );
      }),
    );
  };

  async function runNow(s, button) {
    const ok = await confirmDialog({
      title: 'Executar agora?',
      message: `Isto dispara imediatamente uma missão para “${s.name}”, fora do horário programado.`,
      confirmLabel: 'Executar agora',
    });
    if (!ok) return;
    button.disabled = true;
    try {
      const run = await api('POST', `/api/schedules/${enc(s.id)}/run`);
      toast('Disparo iniciado.', { href: `#/runs/${enc(run.id)}`, linkText: 'Ver detalhes' });
      refresh();
    } catch (err) {
      reportError(err, 'Não foi possível executar');
    } finally {
      button.disabled = false;
    }
  }

  async function remove(s) {
    const ok = await confirmDialog({
      title: 'Excluir agendamento?',
      message: `“${s.name}” será removido e deixará de disparar missões. O histórico é mantido.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/api/schedules/${enc(s.id)}`);
      toast('Agendamento excluído.');
      refresh();
    } catch (err) {
      reportError(err, 'Não foi possível excluir');
    }
  }

  const table = h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ['Nome', 'Workspace', 'Horário', 'Dias', 'Fuso', 'Ativo', 'Próxima execução', 'Última execução'].map((t) => h('th', { scope: 'col' }, t)),
          h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Ações')),
        ),
      ),
      tbody,
    ),
  );
  const empty = h('div', { class: 'card empty' }, h('p', {}, 'Nenhum agendamento ainda.'), h('a', { class: 'btn btn-primary', href: '#/schedules/new' }, 'Criar o primeiro agendamento'));

  const body = h('div');
  const show = (list) => {
    renderRows(list);
    body.replaceChildren(list.length ? table : empty);
  };
  async function refresh() {
    try {
      const fresh = await api('GET', '/api/schedules');
      if (ctx.alive()) show(fresh);
    } catch (err) {
      reportError(err, 'Não foi possível atualizar a lista');
    }
  }

  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Agendamentos'), h('p', { class: 'sub' }, 'Missões recorrentes disparadas automaticamente no horário configurado.')),
      h('div', { class: 'head-actions' }, h('a', { class: 'btn btn-primary', href: '#/schedules/new' }, 'Novo agendamento')),
    ),
    body,
  );
  show(schedules);
  ctx.every(RUNS_REFRESH_MS, refresh);
}

// ---- Agendamentos: create / edit form --------------------------------------------------

async function scheduleFormView(main, ctx, id) {
  const [existing, workspaces, catalog] = await Promise.all([
    // The contract has no GET /api/schedules/:id, so the edit form reads from the list.
    id
      ? api('GET', '/api/schedules').then((list) => {
          const found = list.find((s) => s.id === id);
          if (!found) throw new ApiError(404, 'NOT_FOUND', 'Agendamento não encontrado.');
          return found;
        })
      : null,
    api('GET', '/api/workspaces').catch((err) => {
      if (err.unauthorized) throw err;
      return { error: err.message };
    }),
    api('GET', '/api/catalog').catch((err) => {
      if (err.unauthorized) throw err;
      return { available: false, squads: [], maestros: [] };
    }),
  ]);
  if (!ctx.alive()) return;

  const workspaceError = Array.isArray(workspaces) ? null : workspaces.error;
  const workspaceList = Array.isArray(workspaces) ? workspaces : [];
  const squads = catalog?.squads ?? [];
  const maestros = catalog?.maestros ?? [];
  const catalogOk = catalog?.available !== false;
  const models = Array.isArray(catalog?.models) ? catalog.models : null; // absent = Bridge without model selection
  const defaultTz = state.health?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const init = existing ?? { name: '', briefing: '', workspaceId: '', time: '09:00', days: [0, 1, 2, 3, 4, 5, 6], timezone: defaultTz, squadId: null, enabled: true, maestro: null, e2e: false, stack: {}, modelPool: [], agentModels: {}, attachments: [] };

  const banner = h('div', { class: 'alert alert-error', role: 'alert' });
  banner.hidden = true;

  const name = h('input', { id: 'f-name', type: 'text', value: init.name, required: true, maxlength: 120, autocomplete: 'off', placeholder: 'Ex.: Varredura diária de QA' });
  const briefing = h('textarea', { id: 'f-briefing', required: true, placeholder: 'Descreva o que o maestro deve fazer a cada execução…', 'aria-describedby': 'f-briefing-hint' });
  briefing.value = init.briefing;

  const workspace = h('select', { id: 'f-workspace', required: true });
  workspace.append(h('option', { value: '' }, workspaceList.length ? 'Selecione um workspace…' : 'Nenhum workspace disponível'));
  for (const w of workspaceList) workspace.append(h('option', { value: w.id }, `${w.name} — ${w.path}`));
  if (init.workspaceId && !workspaceList.some((w) => w.id === init.workspaceId)) {
    workspace.append(h('option', { value: init.workspaceId }, `${init.workspaceName ?? init.workspaceId} (indisponível)`));
  }
  workspace.value = init.workspaceId;

  const time = h('input', { id: 'f-time', type: 'time', value: init.time, required: true });

  const tzList = h('datalist', { id: 'tz-list' });
  try {
    for (const tz of Intl.supportedValuesOf('timeZone')) tzList.append(h('option', { value: tz }));
  } catch {
    /* older engines: free text only */
  }
  const timezone = h('input', { id: 'f-timezone', type: 'text', value: init.timezone, required: true, list: 'tz-list', autocomplete: 'off', spellcheck: 'false' });

  const squad = h('select', { id: 'f-squad' }, h('option', { value: '' }, 'Padrão'), squads.map((s) => h('option', { value: s.id }, s.name)));
  if (init.squadId && !squads.some((s) => s.id === init.squadId)) squad.append(h('option', { value: init.squadId }, `${init.squadId} (indisponível)`));
  squad.value = init.squadId ?? '';

  const enabled = h('input', { id: 'f-enabled', type: 'checkbox', checked: init.enabled });

  // ---- maestro ----
  const maestro = h('select', { id: 'f-maestro', 'aria-describedby': 'f-maestro-hint' }, h('option', { value: '' }, 'Padrão do Jarvis ADE'));
  for (const m of maestros.filter((x) => x.available)) maestro.append(h('option', { value: m.id }, m.label));
  if (init.maestro && !maestros.some((m) => m.id === init.maestro && m.available)) maestro.append(h('option', { value: init.maestro }, `${init.maestro} (indisponível)`));
  maestro.value = init.maestro ?? '';

  // ---- E2E ----
  const e2e = h('input', { id: 'f-e2e', type: 'checkbox', checked: init.e2e === true, 'aria-describedby': 'f-e2e-hint' });

  // ---- stack (one comma-separated field per layer, like the Bridge's ProjectStack) ----
  const stackInputs = Object.fromEntries(
    STACK_LAYERS.map(([key, , example]) => [key, h('input', { id: `f-stack-${key}`, type: 'text', value: (init.stack?.[key] ?? []).join(', '), autocomplete: 'off', placeholder: `Ex.: ${example}` })]),
  );

  // ---- attachments (kept locally until the schedule is saved) ----
  const existingFiles = [...(init.attachments ?? [])];
  const removedIds = new Set();
  const pendingFiles = [];
  const fileList = h('ul', { class: 'file-list', 'aria-label': 'Anexos do agendamento' });
  const fileNote = h('p', { class: 'hint', role: 'status' });
  const fileInput = h('input', { id: 'f-files', type: 'file', multiple: true, 'aria-describedby': 'f-files-hint' });
  const keptExisting = () => existingFiles.filter((a) => !removedIds.has(a.id));
  const totalBytes = () => keptExisting().reduce((n, a) => n + a.size, 0) + pendingFiles.reduce((n, f) => n + f.size, 0);
  function renderFiles() {
    const rows = [
      ...keptExisting().map((a) => ({ name: a.name, size: a.size, remove: () => removedIds.add(a.id) })),
      ...pendingFiles.map((f) => ({ name: f.name, size: f.size, pending: true, remove: () => pendingFiles.splice(pendingFiles.indexOf(f), 1) })),
    ];
    fileList.replaceChildren(
      ...rows.map((r) =>
        h(
          'li',
          {},
          h('span', { class: 'file-name' }, r.name),
          h('span', { class: 'muted' }, fmtSize(r.size)),
          r.pending && h('span', { class: 'muted' }, 'novo'),
          h(
            'button',
            {
              class: 'btn btn-sm btn-ghost',
              type: 'button',
              'aria-label': `Remover ${r.name}`,
              onClick: () => {
                r.remove();
                fileNote.textContent = '';
                renderFiles();
              },
            },
            'Remover',
          ),
        ),
      ),
    );
    fileList.hidden = rows.length === 0;
    fileNote.hidden = fileNote.textContent === '';
  }
  fileInput.addEventListener('change', () => {
    const problems = [];
    for (const f of fileInput.files) {
      if (f.size === 0) problems.push(`"${f.name}" está vazio.`);
      else if (f.size > MAX_FILE_BYTES) problems.push(`"${f.name}" passa de ${fmtSize(MAX_FILE_BYTES)}.`);
      else if (keptExisting().length + pendingFiles.length >= MAX_FILES) problems.push(`Limite de ${MAX_FILES} anexos por agendamento.`);
      else if (totalBytes() + f.size > MAX_TOTAL_BYTES) problems.push(`Limite de ${fmtSize(MAX_TOTAL_BYTES)} no total de anexos.`);
      else pendingFiles.push(f);
    }
    fileInput.value = '';
    fileNote.textContent = problems.join(' ');
    renderFiles();
  });
  renderFiles();

  // ---- models: pool + per-agent (only when the Bridge advertises catalog.models) ----
  let modelPool = [...(init.modelPool ?? [])];
  let agentModels = { ...(init.agentModels ?? {}) };
  const modelsBox = h('div', { class: 'stack-sm' });
  const modelLabel = (id) => models?.find((m) => m.id === id)?.label ?? id;
  const currentSquad = () => squads.find((s) => s.id === squad.value) ?? null;

  function renderModels() {
    if (!catalogOk) {
      modelsBox.replaceChildren(h('p', { class: 'hint' }, 'Não foi possível carregar os modelos porque o Bridge está inacessível. As escolhas já salvas serão mantidas.'));
      return;
    }
    if (!models) {
      modelsBox.replaceChildren(h('p', { class: 'hint', 'data-role': 'models-unsupported' }, NO_MODEL_UPDATE_HINT));
      return;
    }
    const sq = currentSquad();
    const effectivePool = modelPool.length ? modelPool : sq?.modelPool ?? [];
    const poolChips = models.map((m) => {
      const input = h('input', { type: 'checkbox', value: m.id, checked: modelPool.includes(m.id), 'aria-label': `${m.label} (${m.adapter})` });
      input.addEventListener('change', () => {
        modelPool = input.checked ? [...modelPool, m.id] : modelPool.filter((x) => x !== m.id);
        renderModels();
      });
      return h('label', { class: 'day chip', title: m.adapter }, input, h('span', {}, m.label));
    });

    // An override is only offered when the effective pool allows it (the Bridge rejects the rest).
    const dropped = [];
    const agentRows = (sq?.agents ?? []).map((agent) => {
      const candidates = models.filter((m) => m.adapter === agent.adapter);
      const allowed = candidates.filter((m) => effectivePool.includes(m.id));
      const offered = effectivePool.length && allowed.length ? allowed : candidates;
      if (agentModels[agent.agentId] && !offered.some((m) => m.id === agentModels[agent.agentId])) {
        dropped.push(agent.name);
        delete agentModels[agent.agentId];
      }
      const def = sq.agentModels?.[agent.agentId] ?? agent.model;
      const select = h('select', { id: `f-agent-${agent.agentId}`, 'aria-label': `Modelo do agente ${agent.name}` }, h('option', { value: '' }, `Padrão (${modelLabel(def)})`));
      for (const m of offered) select.append(h('option', { value: m.id }, m.label));
      select.value = agentModels[agent.agentId] ?? '';
      select.addEventListener('change', () => {
        if (select.value) agentModels[agent.agentId] = select.value;
        else delete agentModels[agent.agentId];
      });
      return h('div', { class: 'agent-row' }, h('label', { for: select.id }, agent.name, h('span', { class: 'muted' }, ` · ${agent.adapter}`)), select);
    });

    modelsBox.replaceChildren(
      ...[
      h(
        'fieldset',
        { 'aria-describedby': 'f-pool-hint' },
        h('legend', {}, 'Modelos liberados'),
        h('div', { class: 'days', role: 'group', 'aria-label': 'Modelos liberados' }, poolChips),
        h('span', { class: 'hint', id: 'f-pool-hint' }, modelPool.length ? 'O maestro só poderá usar os modelos marcados.' : sq?.modelPool?.length ? 'Sem seleção: vale o pool do squad.' : 'Sem seleção: o maestro pode usar qualquer modelo.'),
      ),
      sq
        ? agentRows.length
          ? h('fieldset', {}, h('legend', {}, 'Modelo por agente'), h('div', { class: 'agent-rows' }, agentRows))
          : null
        : h('p', { class: 'hint' }, 'Escolha um squad para definir o modelo de cada agente.'),
      dropped.length ? h('p', { class: 'hint', role: 'status' }, `Voltaram ao padrão por sair do pool: ${dropped.join(', ')}.`) : null
      ].filter(Boolean),
    );
  }
  squad.addEventListener('change', () => {
    agentModels = {};
    renderModels();
  });
  renderModels();

  const dayBoxes = DAY_LABELS.map((label, i) => ({
    i,
    input: h('input', { type: 'checkbox', value: String(i), checked: init.days.includes(i), 'aria-label': label }),
    label,
  }));
  const setDays = (set) => dayBoxes.forEach((d) => (d.input.checked = set.includes(d.i)));

  const controls = { name, briefing, workspaceId: workspace, time, days: dayBoxes[0].input, timezone, squadId: squad, enabled, maestro, e2e, stack: stackInputs.backend, modelPool: modelsBox };

  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, id ? 'Salvar alterações' : 'Criar agendamento');

  function fail(message, field) {
    banner.textContent = message;
    banner.hidden = false;
    for (const c of Object.values(controls)) c.removeAttribute('aria-invalid');
    const key = field ?? FIELD_KEYS.find((k) => new RegExp(`\\b${k}\\b`).test(message));
    const target = key && controls[key];
    if (target) {
      target.setAttribute('aria-invalid', 'true');
      target.focus();
    }
    banner.scrollIntoView({ block: 'nearest' });
  }

  function collect() {
    return {
      name: name.value.trim(),
      briefing: briefing.value,
      workspaceId: workspace.value,
      time: time.value,
      days: dayBoxes.filter((d) => d.input.checked).map((d) => d.i),
      timezone: timezone.value.trim(),
      squadId: squad.value || null,
      enabled: enabled.checked,
      maestro: maestro.value || null,
      e2e: e2e.checked,
      stack: Object.fromEntries(STACK_LAYERS.map(([key]) => [key, parseList(stackInputs[key].value)])),
      // Kept as-is when the model picker is hidden (old Bridge / Bridge down) so saved choices are not wiped.
      modelPool,
      agentModels,
    };
  }

  /** Goes to `hash`, re-rendering even when it is already the current one. */
  function goto(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  /** Applies the attachment changes after the schedule exists. Returns an error message or null. */
  async function syncFiles(scheduleId) {
    for (const attId of removedIds) {
      try {
        await api('DELETE', `/api/schedules/${enc(scheduleId)}/attachments/${enc(attId)}`);
      } catch (err) {
        if (err.unauthorized) return null;
        return `não foi possível remover um anexo: ${err.message}`;
      }
    }
    for (const file of pendingFiles) {
      submit.textContent = `Enviando ${file.name}…`;
      try {
        const data = await readAsBase64(file);
        await api('POST', `/api/schedules/${enc(scheduleId)}/attachments`, { name: file.name, mime: file.type || 'application/octet-stream', data });
      } catch (err) {
        if (err.unauthorized) return null;
        return `falha ao enviar "${file.name}": ${err.message}`;
      }
    }
    return null;
  }

  const form = h(
    'form',
    {
      class: 'form',
      novalidate: true,
      onSubmit: async (event) => {
        event.preventDefault();
        banner.hidden = true;
        const input = collect();
        if (!input.name) return fail('Informe o nome do agendamento.', 'name');
        if (!input.briefing.trim()) return fail('Escreva o briefing que o maestro deve executar.', 'briefing');
        if (!input.workspaceId) return fail('Selecione o workspace onde a missão será criada.', 'workspaceId');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) return fail('Informe o horário no formato HH:MM.', 'time');
        if (!input.days.length) return fail('Selecione ao menos um dia da semana.', 'days');
        if (!input.timezone) return fail('Informe o fuso horário (ex.: America/Sao_Paulo).', 'timezone');

        submit.disabled = true;
        const label = submit.textContent;
        let saved;
        try {
          saved = await (id ? api('PUT', `/api/schedules/${enc(id)}`, input) : api('POST', '/api/schedules', input));
        } catch (err) {
          if (err.unauthorized) return;
          fail(err.code === 'VALIDATION_ERROR' ? err.message : `Não foi possível salvar: ${err.message}`);
          submit.disabled = false;
          return;
        }
        const fileError = await syncFiles(saved.id);
        if (fileError) {
          // The schedule itself is saved: reopen it (so the user can retry the files) and say what failed.
          toast(`Agendamento salvo, mas ${fileError}`, { error: true });
          goto(`#/schedules/${enc(saved.id)}`);
          return;
        }
        submit.textContent = label;
        toast(id ? 'Agendamento atualizado.' : 'Agendamento criado.');
        location.hash = '#/schedules';
      },
    },
    banner,
    workspaceError && h('div', { class: 'alert alert-warn', role: 'status' }, `Não foi possível carregar os workspaces: ${workspaceError}`),
    h('div', { class: 'field' }, h('label', { for: 'f-name' }, 'Nome'), name),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'f-briefing' }, 'Briefing'),
      briefing,
      h('span', { class: 'hint', id: 'f-briefing-hint' }, 'Enviado ao maestro exatamente como escrito. O plugin acrescenta a instrução para executar 100% de forma autônoma.'),
    ),
    h('div', { class: 'field' }, h('label', { for: 'f-workspace' }, 'Workspace'), workspace),
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'f-time' }, 'Horário'), time),
      h('div', { class: 'field' }, h('label', { for: 'f-timezone' }, 'Fuso horário'), timezone, tzList),
      h('div', { class: 'field' }, h('label', { for: 'f-squad' }, 'Squad'), squad),
    ),
    h(
      'fieldset',
      { 'aria-describedby': 'days-hint' },
      h('legend', {}, 'Dias da semana'),
      h(
        'div',
        { class: 'days', role: 'group', 'aria-label': 'Dias da semana' },
        dayBoxes.map((d) => h('label', { class: 'day' }, d.input, h('span', {}, d.label))),
      ),
      h(
        'div',
        { class: 'day-presets' },
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => setDays([0, 1, 2, 3, 4, 5, 6]) }, 'Todos os dias'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => setDays([1, 2, 3, 4, 5]) }, 'Dias úteis'),
      ),
      h('span', { class: 'hint muted', id: 'days-hint' }),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'f-files' }, 'Anexos'),
      fileInput,
      h('span', { class: 'hint', id: 'f-files-hint' }, `Arquivos enviados ao maestro a cada execução (até ${fmtSize(MAX_FILE_BYTES)} cada, ${fmtSize(MAX_TOTAL_BYTES)} no total). Eles ficam guardados no plugin e são reenviados ao Jarvis ADE em todo disparo.`),
      fileList,
      fileNote,
    ),
    h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'f-maestro' }, 'Maestro'),
        maestro,
        h('span', { class: 'hint', id: 'f-maestro-hint' }, 'Só aparecem os maestros disponíveis nesta máquina.'),
      ),
    ),
    modelsBox,
    h(
      'fieldset',
      {},
      h('legend', {}, 'Stack (opcional)'),
      h('p', { class: 'hint' }, 'Tecnologias que você já conhece, separadas por vírgula. O maestro ainda analisa o projeto; isto só evita que ele tenha que adivinhar.'),
      h('div', { class: 'row' }, STACK_LAYERS.map(([key, label]) => h('div', { class: 'field' }, h('label', { for: `f-stack-${key}` }, label), stackInputs[key]))),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'switch', for: 'f-e2e' }, e2e, h('span', { class: 'track' }), 'Fluxo de teste E2E visível'),
      h('span', { class: 'hint', id: 'f-e2e-hint' }, 'O QA roda a jornada end-to-end em um navegador visível. Requer um agente de QA (Reviewer) no squad.'),
    ),
    h('label', { class: 'switch', for: 'f-enabled' }, enabled, h('span', { class: 'track' }), 'Agendamento ativo'),
    h('div', { class: 'form-actions' }, submit, h('a', { class: 'btn', href: '#/schedules' }, 'Cancelar')),
  );

  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, id ? 'Editar agendamento' : 'Novo agendamento'), h('p', { class: 'sub' }, id ? init.name : 'A missão será criada e iniciada automaticamente no horário escolhido.')),
    ),
    form,
  );
  name.focus();
}

// ---- Histórico -------------------------------------------------------------------------

async function runsView(main, ctx, scheduleFilter) {
  const schedules = await api('GET', '/api/schedules');
  if (!ctx.alive()) return;

  let filter = schedules.some((s) => s.id === scheduleFilter) ? scheduleFilter : '';

  const select = h(
    'select',
    { id: 'run-filter' },
    h('option', { value: '' }, 'Todos os agendamentos'),
    schedules.map((s) => h('option', { value: s.id }, s.name)),
  );
  select.value = filter;

  const tbody = h('tbody');
  const note = h('p', { class: 'refresh-note' });
  const errorBox = h('div', { class: 'alert alert-error', role: 'alert' });
  errorBox.hidden = true;
  const emptyBox = h('div', { class: 'card empty' }, 'Nenhum disparo registrado.');
  emptyBox.hidden = true;
  const tableWrap = h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ['Agendamento', 'Origem', 'Previsto para', 'Disparado em', 'Status', 'Missão'].map((t) => h('th', { scope: 'col' }, t)),
          h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Detalhes')),
        ),
      ),
      tbody,
    ),
  );

  async function load() {
    try {
      const runs = await api('GET', `/api/runs?limit=100${filter ? `&scheduleId=${enc(filter)}` : ''}`);
      if (!ctx.alive()) return;
      errorBox.hidden = true;
      tbody.replaceChildren(
        ...runs.map((r) =>
          h(
            'tr',
            { 'data-run-id': r.id },
            h('td', { 'data-label': 'Agendamento' }, h('span', { class: 'cell-title' }, r.scheduleName)),
            h('td', { 'data-label': 'Origem' }, triggerLabel(r.trigger)),
            h('td', { 'data-label': 'Previsto para', class: 'nowrap' }, fmtDate(r.scheduledFor)),
            h('td', { 'data-label': 'Disparado em', class: 'nowrap' }, fmtDate(r.dispatchedAt)),
            h('td', { 'data-label': 'Status' }, runBadge(r.status)),
            h('td', { 'data-label': 'Missão' }, r.missionName ?? '—'),
            h('td', { class: 'actions' }, h('a', { class: 'btn btn-sm', href: `#/runs/${enc(r.id)}`, 'aria-label': `Ver detalhes do disparo de ${r.scheduleName}` }, 'Detalhes')),
          ),
        ),
      );
      tableWrap.hidden = runs.length === 0;
      emptyBox.hidden = runs.length !== 0;
      note.textContent = `Atualiza a cada ${RUNS_REFRESH_MS / 1000}s · última atualização ${new Date().toLocaleTimeString('pt-BR', { timeZone: state.health?.timezone })}`;
    } catch (err) {
      if (err.unauthorized || !ctx.alive()) return;
      errorBox.textContent = `Não foi possível carregar o histórico: ${err.message}`;
      errorBox.hidden = false;
    }
  }

  select.addEventListener('change', () => {
    filter = select.value;
    history.replaceState(null, '', filter ? `#/runs?schedule=${enc(filter)}` : '#/runs');
    load();
  });

  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Histórico de disparos'), h('p', { class: 'sub' }, 'Mais recentes primeiro.')),
      h('div', { class: 'filter' }, h('label', { for: 'run-filter' }, 'Agendamento'), select),
    ),
    errorBox,
    tableWrap,
    emptyBox,
    note,
  );
  await load();
  ctx.every(RUNS_REFRESH_MS, load);
}

// ---- Detalhe do disparo ----------------------------------------------------------------

/** "Opções usadas": what the plugin actually sent to the Bridge for this dispatch. */
function optionsSection(o, catalog) {
  const squad = catalog?.squads?.find((s) => s.id === o.squadId);
  const modelName = (id) => catalog?.models?.find((m) => m.id === id)?.label ?? id;
  const agentName = (id) => squad?.agents?.find((a) => a.agentId === id)?.name ?? id;
  const maestroName = catalog?.maestros?.find((m) => m.id === o.maestro)?.label ?? o.maestro;
  const stack = STACK_LAYERS.filter(([key]) => o.stack?.[key]?.length).map(([key, label]) => `${label}: ${o.stack[key].join(', ')}`);
  const agents = Object.entries(o.agentModels ?? {});
  const row = (term, value) => [h('dt', {}, term), h('dd', {}, value)];
  const rows = [
    ...row('Squad', o.squadId ? squad?.name ?? o.squadId : 'Padrão'),
    ...row('Maestro', o.maestro ? maestroName : 'Padrão do Jarvis ADE'),
    ...row('Teste E2E visível', o.e2e ? 'Sim' : 'Não'),
    ...(stack.length ? row('Stack', h('ul', { class: 'plain-list' }, stack.map((line) => h('li', {}, line)))) : []),
    ...(o.modelPool?.length ? row('Modelos liberados', o.modelPool.map(modelName).join(', ')) : []),
    ...(agents.length ? row('Modelo por agente', h('ul', { class: 'plain-list' }, agents.map(([agentId, model]) => h('li', {}, `${agentName(agentId)} → ${modelName(model)}`)))) : []),
    ...row(
      'Anexos',
      o.attachments?.length ? h('ul', { class: 'plain-list' }, o.attachments.map((a) => h('li', {}, a.name, h('span', { class: 'muted' }, ` (${fmtSize(a.size)})`)))) : 'Nenhum',
    ),
  ];
  return [
    h('section', { class: 'card', 'data-role': 'run-options' }, h('h2', { class: 'section-title' }, 'Opções usadas'), h('dl', { class: 'detail-grid' }, rows)),
    ...(o.warnings ?? []).map((w) => h('div', { class: 'alert alert-warn', role: 'status', 'data-role': 'run-warning' }, w)),
  ];
}

function runDetail(run, rawOpen, catalog) {
  const dur = fmtDuration(run.dispatchedAt, run.finishedAt);
  const row = (term, ...value) => [h('dt', {}, term), h('dd', {}, ...value)];
  const result = run.result;

  const sections = [
    h(
      'section',
      { class: 'card' },
      h(
        'dl',
        { class: 'detail-grid' },
        row('Agendamento', h('a', { href: `#/schedules/${enc(run.scheduleId)}` }, run.scheduleName)),
        row('Origem', triggerLabel(run.trigger)),
        row('Status', runBadge(run.status)),
        row('Previsto para', fmtDate(run.scheduledFor)),
        row('Disparado em', fmtDate(run.dispatchedAt)),
        row('Finalizado em', fmtDate(run.finishedAt), dur && h('span', { class: 'muted' }, ` (${dur})`)),
        row('Missão', run.missionName ?? '—', run.missionId && h('span', { class: 'muted mono' }, ` ${run.missionId}`)),
        result?.costUsd != null && row('Custo', fmtCost(result.costUsd)),
        row('ID do disparo', h('span', { class: 'mono' }, run.id)),
      ),
    ),
  ];

  if (run.options) sections.push(...optionsSection(run.options, catalog));

  if (run.error) {
    sections.push(h('div', { class: 'alert alert-error', role: 'alert', 'data-role': 'run-error' }, h('strong', {}, 'Erro: '), run.error));
  }

  if (run.summary) {
    sections.push(h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Resumo do maestro'), h('p', { class: 'prose', 'data-role': 'summary' }, run.summary)));
  } else if (run.status === 'finished') {
    sections.push(h('section', { class: 'card' }, h('h2', { class: 'section-title' }, 'Resumo do maestro'), h('p', { class: 'muted' }, 'O maestro não devolveu um resumo.')));
  }

  if (result?.tasks?.length) {
    sections.push(
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'section-title' }, `Tarefas (${result.tasks.length})`),
        h(
          'ul',
          { class: 'tasks' },
          result.tasks.map((t) =>
            h(
              'li',
              {},
              h('div', { class: 'task-head' }, h('span', {}, t.title), taskBadge(t.status)),
              t.result ? h('p', { class: 'prose task-result' }, typeof t.result === 'string' ? t.result : JSON.stringify(t.result, null, 2)) : null,
            ),
          ),
        ),
      ),
    );
  }

  if (result?.raw != null) {
    const details = h('details', { class: 'raw card', open: rawOpen }, h('summary', {}, 'Dados brutos'), h('pre', {}, JSON.stringify(result.raw, null, 2)));
    sections.push(details);
  }
  return sections;
}

async function runDetailView(main, ctx, id) {
  let run = await api('GET', `/api/runs/${enc(id)}`);
  // Names for squad/agents/models in "Opções usadas"; the raw ids are shown when the Bridge is down.
  const catalog = run.options
    ? await api('GET', '/api/catalog').catch((err) => {
        if (err.unauthorized) throw err;
        return null;
      })
    : null;
  if (!ctx.alive()) return;

  const body = h('div', { class: 'stack' });
  const paint = () => body.replaceChildren(...runDetail(run, body.querySelector('details.raw')?.open, catalog));

  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Detalhe do disparo'), h('p', { class: 'sub' }, run.scheduleName)),
      h('div', { class: 'head-actions' }, h('a', { class: 'btn', href: `#/runs?schedule=${enc(run.scheduleId)}` }, '← Voltar ao histórico')),
    ),
    body,
  );
  paint();

  // Keep a live run fresh until it reaches a terminal status.
  if (ACTIVE_STATUSES.has(run.status)) {
    ctx.every(DETAIL_REFRESH_MS, async () => {
      try {
        run = await api('GET', `/api/runs/${enc(id)}`);
        if (ctx.alive()) paint();
      } catch {
        /* transient; the next tick retries */
      }
    });
  }
}

// ---- boot ------------------------------------------------------------------------------

window.addEventListener('hashchange', route);

async function boot() {
  if (!state.token) return mountLogin('');
  try {
    state.health = await api('GET', '/api/health');
    startShell();
  } catch (err) {
    if (err.unauthorized) return; // logout() already rendered the login screen
    mountLogin(err.message);
  }
}
boot();
