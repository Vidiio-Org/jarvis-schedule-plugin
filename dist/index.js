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
import { BridgeClient } from './bridge.js';
import { ConfigError, loadSettings, resolveConfig } from './config.js';
import { Emitter, parseEventLine } from './protocol.js';
import { ScheduleService } from './service.js';
import { Store } from './store.js';
const emitter = new Emitter(process.stdout);
const log = (level, message) => emitter.log(level, message);
let service = null;
let api = null;
let started = false;
let shuttingDown = false;
function readVersion() {
    try {
        const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
        return pkg.version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
async function handleHello(helloSettings) {
    if (started) {
        log('info', 'Ignoring repeated hello: already running');
        return;
    }
    const { settings, warning } = loadSettings(helloSettings);
    if (warning)
        log('warn', warning);
    let resolved;
    try {
        resolved = resolveConfig(settings);
    }
    catch (err) {
        const message = err instanceof ConfigError ? err.message : String(err);
        log('error', `Configuration invalid, plugin will not start: ${message}`);
        emitter.send({ type: 'error', message });
        return;
    }
    for (const w of resolved.warnings)
        log('warn', w);
    const { config } = resolved;
    started = true;
    const dataDir = process.env.ADE_PLUGIN_DATA_DIR?.trim() || join(process.cwd(), '.data');
    if (!process.env.ADE_PLUGIN_DATA_DIR?.trim())
        log('warn', `ADE_PLUGIN_DATA_DIR is not set; using "${dataDir}"`);
    try {
        const store = new Store(dataDir, log);
        const bridge = new BridgeClient({ baseUrl: config.bridgeUrl, token: config.bridgeToken });
        service = new ScheduleService({ config, store, bridge, log, version: readVersion() });
        api = new ApiServer({
            service,
            token: config.dashboardToken,
            port: config.dashboardPort,
            uiDir: fileURLToPath(new URL('../ui/', import.meta.url)),
            log
        });
        const port = await api.start();
        service.start();
        log('info', `Dashboard listening on http://127.0.0.1:${port}/ — scheduler ${config.enabled ? 'enabled' : 'DISABLED (master switch off)'}`);
        emitter.send({ type: 'ready', name: 'Jarvis Schedule' });
    }
    catch (err) {
        started = false;
        service?.stop();
        const message = err instanceof Error ? err.message : String(err);
        log('error', `Failed to start: ${message}`);
        emitter.send({ type: 'error', message: `Failed to start: ${message}` });
    }
}
async function shutdown() {
    if (shuttingDown)
        return;
    shuttingDown = true;
    service?.stop();
    const grace = new Promise((resolve) => setTimeout(resolve, 3000).unref());
    try {
        await Promise.race([api?.stop() ?? Promise.resolve(), grace]);
    }
    catch (err) {
        log('warn', `Error while stopping the dashboard: ${String(err)}`);
    }
    process.exit(0);
}
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
    const event = parseEventLine(line);
    if (!event) {
        log('warn', `Ignoring unparseable stdin line: ${line.slice(0, 120)}`);
        return;
    }
    if (event.type === 'hello') {
        void handleHello(event.settings);
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
