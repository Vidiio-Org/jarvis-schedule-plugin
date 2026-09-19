import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { withOptionDefaults } from './validation.js';
/**
 * Persistence under ADE_PLUGIN_DATA_DIR.
 *
 * Why JSON files and not node:sqlite: node:sqlite is still flagged
 * experimental in Node 22 (prints an ExperimentalWarning, API may change),
 * the volume is tiny (a handful of schedules, a few runs a day), and plain
 * files keep the plugin dependency-free and trivially inspectable/repairable.
 * Every write is atomic (tmp file + fsync + rename) so a crash leaves either
 * the old or the new content, never a torn file:
 *   schedules.json       — all schedules
 *   runs/<runId>.json    — one file per run (small rewrites as a run progresses)
 * Runs double as the dispatch ledger: a run's `slotKey` is the dedupe key, and
 * a run is written (inflight) BEFORE the Bridge is called, so a restart at any
 * point can never dispatch the same slot twice.
 */
export class Store {
    dataDir;
    log;
    schedulesFile;
    runsDir;
    schedules = new Map();
    runs = new Map();
    slotKeys = new Set();
    constructor(dataDir, log = () => undefined) {
        this.dataDir = dataDir;
        this.log = log;
        this.schedulesFile = join(dataDir, 'schedules.json');
        this.runsDir = join(dataDir, 'runs');
        mkdirSync(this.runsDir, { recursive: true });
        this.load();
    }
    load() {
        try {
            const parsed = JSON.parse(readFileSync(this.schedulesFile, 'utf8'));
            // Schedules written by older plugin versions lack the briefing options: fill the defaults.
            for (const s of parsed.schedules ?? []) {
                this.schedules.set(s.id, { ...withOptionDefaults(s), attachments: Array.isArray(s.attachments) ? s.attachments : [] });
            }
        }
        catch (err) {
            if (err.code !== 'ENOENT') {
                const backup = `${this.schedulesFile}.corrupt-${Date.now()}`;
                try {
                    renameSync(this.schedulesFile, backup);
                }
                catch {
                    // best effort
                }
                this.log('error', `schedules.json was unreadable (${String(err)}); moved to ${backup} and starting empty`);
            }
        }
        for (const file of readdirSync(this.runsDir)) {
            if (!file.endsWith('.json'))
                continue;
            try {
                const run = JSON.parse(readFileSync(join(this.runsDir, file), 'utf8'));
                if (typeof run.id !== 'string')
                    throw new Error('missing id');
                run.options ??= null;
                this.runs.set(run.id, run);
                if (run.slotKey)
                    this.slotKeys.add(run.slotKey);
            }
            catch (err) {
                this.log('warn', `Skipping unreadable run file ${file}: ${String(err)}`);
            }
        }
    }
    writeAtomic(path, data) {
        const tmp = `${path}.tmp-${process.pid}`;
        const fd = openSync(tmp, 'w', 0o600);
        try {
            writeSync(fd, JSON.stringify(data));
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        renameSync(tmp, path);
    }
    /* ── schedules ── */
    listSchedules() {
        return [...this.schedules.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    getSchedule(id) {
        return this.schedules.get(id);
    }
    saveSchedule(schedule) {
        this.schedules.set(schedule.id, schedule);
        this.flushSchedules();
    }
    deleteSchedule(id) {
        const existed = this.schedules.delete(id);
        if (existed)
            this.flushSchedules();
        return existed;
    }
    flushSchedules() {
        this.writeAtomic(this.schedulesFile, { version: 1, schedules: [...this.schedules.values()] });
    }
    /* ── runs ── */
    listRuns() {
        return [...this.runs.values()];
    }
    getRun(id) {
        return this.runs.get(id);
    }
    hasSlot(key) {
        return this.slotKeys.has(key);
    }
    slotKeySet() {
        return this.slotKeys;
    }
    /** Persists (create or update) a run synchronously — durable before the caller continues. */
    saveRun(run) {
        this.runs.set(run.id, run);
        if (run.slotKey)
            this.slotKeys.add(run.slotKey);
        this.writeAtomic(join(this.runsDir, `${run.id}.json`), run);
    }
    deleteRun(id) {
        const run = this.runs.get(id);
        if (!run)
            return;
        this.runs.delete(id);
        if (run.slotKey)
            this.slotKeys.delete(run.slotKey);
        try {
            unlinkSync(join(this.runsDir, `${id}.json`));
        }
        catch {
            // already gone
        }
    }
}
