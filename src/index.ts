/**
 * Sidecar entrypoint — JSONL protocol over stdin/stdout (`hello`/`shutdown`),
 * same shape as the sibling plugins. `hello` is replayed on every restart
 * (including crash backoff), so nothing here may repeat a side effect: all
 * dispatch dedupe lives in the persisted run ledger (see store.ts).
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { ApiServer } from './api.js';
import { parseHostHello, resolveApiTokens } from './auth.js';
import { BridgeClient } from './bridge.js';
import { ConfigError, loadSettings, resolveBridge, resolveConfig } from './config.js';
import { Emitter, parseEventLine, type HostEvent } from './protocol.js';
import { ScheduleService } from './service.js';
import { Store, type LogFn } from './store.js';

const emitter = new Emitter(process.stdout);
const log: LogFn = (level, message) => emitter.log(level, message);

let service: ScheduleService | null = null;
let api: ApiServer | null = null;
let started = false;
/** Last Bridge credentials in use — a repeated hello only swaps them when they actually changed. */
let currentBridge: { url: string; token: string; source: 'host' | 'settings' } | null = null;
let shuttingDown = false;

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** A hello while running: only the Bridge credentials can change live (restart / token rotation). */
function handleRepeatedHello(event: HostEvent): void {
  const host = parseHostHello(event.host);
  if (host.bridgeInvalid) {
    log('warn', 'Ignoring repeated hello: hello.host.bridge is malformed; keeping the current Bridge credentials.');
    return;
  }
  const { settings } = loadSettings(event.settings);
  let next;
  try {
    next = resolveBridge(settings, host.bridge);
  } catch {
    log('info', 'Ignoring repeated hello: already running');
    return;
  }
  const cur = currentBridge;
  if (!service || (cur && cur.url === next.bridgeUrl && cur.token === next.bridgeToken && cur.source === next.bridgeSource)) {
    log('info', 'Ignoring repeated hello: already running');
    return;
  }
  currentBridge = { url: next.bridgeUrl, token: next.bridgeToken, source: next.bridgeSource };
  service.setBridge(currentBridge);
  log('info', `Bridge credentials updated (${describeBridge(next.bridgeSource, next.bridgeUrl)})`);
}

function describeBridge(source: 'host' | 'settings', url: string): string {
  return source === 'host' ? `provided by the ADE host (automatic) at ${url}` : `manual settings, ${url}`;
}

async function handleHello(event: HostEvent): Promise<void> {
  if (started) {
    handleRepeatedHello(event);
    return;
  }
  const { settings, warning } = loadSettings(event.settings);
  if (warning) log('warn', warning);
  const host = parseHostHello(event.host);
  if (host.bridgeInvalid) log('warn', 'hello.host.bridge is malformed; falling back to the bridgeUrl/bridgeToken settings.');

  let resolved;
  try {
    resolved = resolveConfig(settings, host.bridge);
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : String(err);
    log('error', `Configuration invalid, plugin will not start: ${message}`);
    emitter.send({ type: 'error', message });
    return;
  }
  for (const w of resolved.warnings) log('warn', w);
  const { config } = resolved;
  if (host.invalid) log('warn', 'hello.host.viewToken is malformed; the embedded view will not be authenticated.');
  const { tokens, fallbackToken } = resolveApiTokens({ dashboardToken: config.dashboardToken, viewToken: host.viewToken });
  started = true;
  currentBridge = { url: config.bridgeUrl, token: config.bridgeToken, source: config.bridgeSource };

  const dataDir = process.env.ADE_PLUGIN_DATA_DIR?.trim() || join(process.cwd(), '.data');
  if (!process.env.ADE_PLUGIN_DATA_DIR?.trim()) log('warn', `ADE_PLUGIN_DATA_DIR is not set; using "${dataDir}"`);

  try {
    const store = new Store(dataDir, log);
    const bridge = new BridgeClient({ baseUrl: config.bridgeUrl, token: config.bridgeToken });
    service = new ScheduleService({ config, store, bridge, log, version: readVersion() });
    api = new ApiServer({
      service,
      tokens,
      port: config.dashboardPort,
      uiDir: fileURLToPath(new URL('../ui/', import.meta.url)),
      log
    });
    const port = await api.start();
    service.start();
    log('info', `Bridge: ${describeBridge(config.bridgeSource, config.bridgeUrl)}`);
    log('info', `Dashboard listening on http://127.0.0.1:${port}/ — scheduler ${config.enabled ? 'enabled' : 'DISABLED (master switch off)'}`);
    // Older-host fallback (no host.viewToken, no dashboardToken): a random per-launch token, shown in the local plugin log only.
    if (fallbackToken) log('info', `Painel: http://127.0.0.1:${port}/ — token ${fallbackToken}`);
    // The real bound port (dashboardPort may be 0): the host proxies the embedded view to it. Re-emitted on every (re)start.
    emitter.send({ type: 'ready', name: 'Jarvis Schedule', http: { port } });
  } catch (err) {
    started = false;
    currentBridge = null;
    service?.stop();
    const message = err instanceof Error ? err.message : String(err);
    log('error', `Failed to start: ${message}`);
    emitter.send({ type: 'error', message: `Failed to start: ${message}` });
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  service?.stop();
  const grace = new Promise<void>((resolve) => setTimeout(resolve, 3000).unref());
  try {
    await Promise.race([api?.stop() ?? Promise.resolve(), grace]);
  } catch (err) {
    log('warn', `Error while stopping the dashboard: ${String(err)}`);
  }
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const event = parseEventLine(line);
  if (!event) {
    // Never echo the line: a malformed hello can carry secrets (settings, viewToken).
    log('warn', `Ignoring unparseable stdin line (${line.length} chars)`);
    return;
  }
  if (event.type === 'hello') {
    void handleHello(event);
    return;
  }
  if (event.type === 'shutdown') {
    void shutdown();
  }
});

// stdin closing means the host is gone: same as an explicit shutdown.
rl.on('close', () => void shutdown());

process.on('uncaughtException', (error) => {
  log('error', `Uncaught exception: ${String(error?.stack ?? error)}`);
});
process.on('unhandledRejection', (reason) => {
  log('error', `Unhandled rejection: ${String(reason)}`);
});
