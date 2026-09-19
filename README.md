# Jarvis Schedule

A Jarvis ADE plugin that runs **recurring scheduled missions**. Create a schedule (briefing + workspace + time + days + optional squad) and every day at that time the plugin dispatches a mission into the workspace through the ADE SaaS Bridge, then keeps a history of each dispatch and the data the maestro returned. It serves its own local web dashboard.

> Stub — the full README is a later card. Below is what the core delivers.

## How it works

- **Sidecar** (`dist/index.js`): JSONL `hello`/`shutdown` protocol over stdin/stdout like the sibling plugins. Runtime is dependency-free (Node ≥ 22, built-ins + global `fetch`); `dist/` is committed.
- **Scheduler**: ticks every 20 s. A slot (`schedule × local date × HH:MM`, DST-safe via `Intl`) is dispatched when it is due and within a 15-minute grace window; older un-dispatched slots are recorded as `missed`. New/edited schedules never fire slots from before the edit.
- **Dispatch**: `POST /api/missions` on the Bridge with the user's briefing **verbatim** followed by a fixed autonomy block (never `ask_user`, decide alone, finish with a complete `mission_finish` summary).
- **Tracking**: SSE `mission:update` plus a 30 s poll of `GET /api/missions` (also resumes runs left open across a restart). A finished run stores status, the maestro's summary, task results, cost (best effort) and the raw mission data.
- **No double dispatch**: the run record is written to `ADE_PLUGIN_DATA_DIR` *before* the Bridge is called and doubles as the dedupe ledger, so a restart (the host replays `hello`) never repeats a slot. A crash mid-dispatch is never retried. Only "connection refused"-class failures are retried, and only inside the grace window.
- **Storage**: `schedules.json` + `runs/<id>.json`, atomic writes (JSON rather than `node:sqlite`, which is still experimental on Node 22). History is pruned after `historyRetentionDays`.

## Settings

| key | type | default | |
| --- | --- | --- | --- |
| `bridgeUrl` | string | `http://127.0.0.1:4820` | ADE SaaS Bridge |
| `bridgeToken` | secret | — (required) | Bridge bearer token |
| `dashboardPort` | number | `4870` | dashboard port (127.0.0.1 only) |
| `dashboardToken` | secret | — (required, ≥ 12 chars) | dashboard login token |
| `defaultTimezone` | string | `America/Sao_Paulo` | IANA zone proposed for new schedules |
| `historyRetentionDays` | number | `90` | history retention |
| `enabled` | boolean | `true` | master switch: off = nothing fires automatically (manual runs still work) |

## Local REST API

Served on `127.0.0.1:<dashboardPort>`; static UI from `ui/` at `/`. Every `/api/*` call needs `Authorization: Bearer <dashboardToken>`; non-localhost `Host` headers are rejected; no CORS. Replies are `{ok:true,data}` / `{ok:false,code,message}` (`UNAUTHORIZED`, `VALIDATION_ERROR`, `NOT_FOUND`, `BRIDGE_UNAVAILABLE`).

`GET /api/health` · `GET /api/workspaces` · `GET /api/catalog` · `GET|POST /api/schedules` · `PUT|DELETE /api/schedules/:id` · `POST /api/schedules/:id/run` · `GET /api/runs?scheduleId=&limit=` · `GET /api/runs/:id`

## Development

```sh
npm install
npm run build       # tsc -> dist/ (commit it)
npm run typecheck
npm test            # builds, then vitest (unit + API + sidecar e2e against the fake bridge)
npm run fake-bridge -- --port 4820 --token secret --auto-finish-ms 5000   # standalone fake ADE Bridge
```

`test/fake-bridge.mjs` is a reusable fake Bridge that honours the real wire format (envelopes, bearer/`?token=` auth, `POST /api/missions`, `GET /api/missions[/:id]`, `/api/catalog`, SSE `/api/events`). Use `startFakeBridge()` from tests or run it as a CLI.
