import { randomUUID } from 'node:crypto';
import { AttachmentStore } from './attachments.js';
import { buildBrief } from './autonomy.js';
import { BridgeError } from './bridge.js';
import { GRACE_MS, planSlots } from './scheduler.js';
import { DAY_MS, dateString, nextSlotAfter, pad2, zonedParts } from './time.js';
import { hasDeclaredStack, parseScheduleInput, validateAgainstCatalog, ValidationError } from './validation.js';
export class NotFoundError extends Error {
}
const TERMINAL_MISSION = new Set(['done', 'aborted', 'failed']);
const TERMINAL_RUN = new Set(['finished', 'failed', 'dispatch_failed', 'missed']);
/** Polls in a row where the Bridge answers but does not know the mission before the run is failed. */
const MAX_MISSING_POLLS = 3;
/** A run still "running" this long after dispatch is failed (the maestro is not coming back). */
const MAX_RUN_MS = 48 * 60 * 60 * 1000;
const CATALOG_TTL_MS = 30_000;
const BRIDGE_PROBE_TTL_MS = 5_000;
const RAW_TEXT_CAP = 8_000;
const RAW_CARD_CAP = 200;
function cap(text) {
    if (typeof text !== 'string')
        return null;
    return text.length > RAW_TEXT_CAP ? `${text.slice(0, RAW_TEXT_CAP)}… [truncated]` : text;
}
function toMeta({ id, name, mime, size }) {
    return { id, name, mime, size };
}
function toRun(stored) {
    const { slotKey: _s, createdAtMs: _c, inflight: _i, retryAt: _r, missingPolls: _m, ...run } = stored;
    return run;
}
export class ScheduleService {
    cfg;
    store;
    files;
    bridge;
    log;
    version;
    now;
    retryDelayMs;
    ticking = false;
    polling = false;
    finalizing = new Set();
    workspaceNames = new Map();
    catalogAt = 0;
    probe = { at: 0, connected: false };
    lastPruneAt = 0;
    timers = [];
    unsubscribe = null;
    constructor(opts) {
        this.cfg = opts.config;
        this.store = opts.store;
        this.files = new AttachmentStore(opts.store.dataDir);
        this.bridge = opts.bridge;
        this.log = opts.log;
        this.version = opts.version;
        this.now = opts.now ?? Date.now;
        this.retryDelayMs = opts.retryDelayMs ?? 30_000;
    }
    get config() {
        return this.cfg;
    }
    /* ── lifecycle ── */
    start(tickMs = 20_000, pollMs = 30_000) {
        this.recoverInterruptedRuns();
        this.unsubscribe = this.bridge.subscribe((evt) => {
            if (evt.event === 'mission:update' && evt.data && typeof evt.data === 'object') {
                void this.applyMissionUpdate(evt.data).catch((e) => this.log('warn', `mission:update failed: ${String(e)}`));
            }
        }, (connected, error) => {
            if (!connected && error)
                this.log('warn', `Bridge event stream: ${error}`);
        });
        const guard = (name, fn) => () => {
            void fn().catch((e) => this.log('error', `${name} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
        };
        const tick = guard('tick', () => this.tick());
        const poll = guard('poll', () => this.pollRuns());
        tick();
        poll();
        this.timers.push(setInterval(tick, tickMs), setInterval(poll, pollMs));
        for (const t of this.timers)
            t.unref?.();
    }
    stop() {
        for (const t of this.timers)
            clearInterval(t);
        this.timers = [];
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
    /** A run that was mid-dispatch when the process died is NEVER retried (the mission may exist). */
    recoverInterruptedRuns() {
        for (const run of this.store.listRuns()) {
            if (run.status !== 'dispatching')
                continue;
            if (run.inflight) {
                run.inflight = false;
                run.retryAt = null;
                run.status = 'dispatch_failed';
                run.error =
                    'The plugin stopped while this run was being dispatched, so it is unknown whether the mission was created. It was not retried, to avoid a duplicate mission — check the ADE missions list.';
                this.store.saveRun(run);
                this.log('warn', `Run ${run.id} was interrupted mid-dispatch; marked dispatch_failed (not retried)`);
            }
            else if (run.retryAt === null) {
                run.retryAt = this.now();
                this.store.saveRun(run);
            }
        }
    }
    /* ── scheduler ── */
    /** One scheduler pass: dispatch due slots, record missed ones, retry, prune. Safe to call repeatedly. */
    async tick() {
        if (this.ticking)
            return;
        this.ticking = true;
        try {
            const now = this.now();
            if (this.cfg.enabled) {
                const plan = planSlots(this.store.listSchedules(), {
                    now,
                    handledKeys: this.store.slotKeySet(),
                    lookbackMs: this.cfg.historyRetentionDays * DAY_MS
                });
                for (const { schedule, slot, action } of plan) {
                    if (this.store.hasSlot(slot.key))
                        continue;
                    const run = this.newRun(schedule, 'schedule', slot.key, slot.at);
                    if (action === 'missed') {
                        run.status = 'missed';
                        run.error = `The plugin was not running (or the Bridge was down) within ${Math.round(GRACE_MS / 60000)} minutes of the scheduled time, so this slot was not dispatched.`;
                        this.store.saveRun(run);
                        this.log('warn', `Schedule "${schedule.name}" missed slot ${slot.key}`);
                        continue;
                    }
                    // Write-ahead: the slot is recorded before the Bridge is called.
                    this.store.saveRun(run);
                    await this.attempt(run, schedule, slot.at + GRACE_MS);
                }
                for (const run of this.store.listRuns()) {
                    if (run.status !== 'dispatching' || run.inflight || run.retryAt === null || run.retryAt > now)
                        continue;
                    const schedule = this.store.getSchedule(run.scheduleId);
                    if (!schedule || run.scheduledFor === null) {
                        run.status = 'dispatch_failed';
                        run.retryAt = null;
                        run.error = 'The schedule was deleted before the dispatch could be retried.';
                        this.store.saveRun(run);
                        continue;
                    }
                    await this.attempt(run, schedule, Date.parse(run.scheduledFor) + GRACE_MS);
                }
            }
            if (now - this.lastPruneAt >= 60 * 60 * 1000) {
                this.lastPruneAt = now;
                this.prune();
            }
        }
        finally {
            this.ticking = false;
        }
    }
    newRun(schedule, trigger, slotKey, scheduledFor) {
        return {
            id: randomUUID(),
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            trigger,
            scheduledFor: scheduledFor === null ? null : new Date(scheduledFor).toISOString(),
            dispatchedAt: null,
            status: 'dispatching',
            missionId: null,
            missionName: null,
            finishedAt: null,
            error: null,
            summary: null,
            result: null,
            options: null,
            slotKey,
            createdAtMs: this.now(),
            inflight: false,
            retryAt: null,
            missingPolls: 0
        };
    }
    missionName(schedule, at) {
        const p = zonedParts(at, schedule.timezone);
        return `${schedule.name} · ${dateString(p)} ${pad2(p.hour)}:${pad2(p.minute)}`;
    }
    /**
     * Builds the Bridge request for a schedule. The Bridge's attachment pantry is
     * in memory and evicts old ids, so the stored files are re-uploaded on EVERY
     * dispatch and only the fresh ids are sent. Model selection is sent only when
     * the Bridge advertises `catalog.models` (an older Bridge would silently drop
     * or reject it); what was dropped is recorded in `options.warnings`.
     */
    async prepareMission(schedule, at) {
        const warnings = [];
        let modelPool = [];
        let agentModels = {};
        const wantsModels = schedule.modelPool.length > 0 || Object.keys(schedule.agentModels).length > 0;
        if (wantsModels) {
            const catalog = await this.bridge.catalog();
            if (catalog.models === undefined) {
                warnings.push('The ADE Bridge does not support model selection (update Jarvis ADE): modelPool/agentModels were not sent.');
                this.log('warn', `Schedule "${schedule.name}": Bridge has no catalog.models; model selection not sent`);
            }
            else {
                modelPool = schedule.modelPool;
                agentModels = schedule.agentModels;
            }
        }
        const uploaded = [];
        for (const att of schedule.attachments) {
            const bytes = this.files.read(schedule.id, att);
            if (bytes === null) {
                throw new BridgeError(0, 'ATTACHMENT_MISSING', `Attachment "${att.name}" is missing from the plugin data directory; remove it and attach it again.`);
            }
            try {
                const res = await this.bridge.uploadAttachment({ name: att.name, mime: att.mime, data: bytes.toString('base64') });
                uploaded.push({ id: res.id, name: att.name, size: att.size });
            }
            catch (err) {
                if (err instanceof BridgeError) {
                    throw new BridgeError(err.status, err.code, `Could not upload attachment "${att.name}": ${err.message}`, err.neverSent, err.unavailable);
                }
                throw err;
            }
        }
        const stack = hasDeclaredStack(schedule.stack) ? schedule.stack : null;
        const input = {
            brief: buildBrief(schedule.briefing),
            workspaceId: schedule.workspaceId,
            name: this.missionName(schedule, at),
            mode: schedule.squadId ? 'squad' : 'free',
            ...(schedule.squadId ? { squadId: schedule.squadId } : {}),
            ...(schedule.maestro ? { maestro: schedule.maestro } : {}),
            ...(schedule.e2e ? { e2e: true } : {}),
            ...(stack ? { stack } : {}),
            ...(uploaded.length > 0 ? { attachmentIds: uploaded.map((u) => u.id) } : {}),
            ...(modelPool.length > 0 ? { modelPool } : {}),
            ...(Object.keys(agentModels).length > 0 ? { agentModels } : {})
        };
        const options = {
            squadId: schedule.squadId,
            maestro: schedule.maestro,
            e2e: schedule.e2e,
            stack,
            modelPool,
            agentModels,
            attachments: uploaded.map((u) => ({ name: u.name, size: u.size })),
            warnings
        };
        return { input, options };
    }
    /**
     * Sends the run's mission to the Bridge. `retryUntil` (scheduled runs only)
     * is the end of the grace window: a failure that provably never reached the
     * Bridge (connection refused, DNS) is retried until then; anything ambiguous
     * (timeout, HTTP error, dropped connection) is final — never risk a duplicate.
     */
    async attempt(run, schedule, retryUntil) {
        run.retryAt = null;
        this.store.saveRun(run);
        const at = run.scheduledFor ? Date.parse(run.scheduledFor) : this.now();
        try {
            // Everything that can fail without creating a mission (catalog probe, file uploads) happens first,
            // while the run is not yet "in flight" — a crash here is safely retried after a restart.
            const { input, options } = await this.prepareMission(schedule, at);
            run.options = options;
            run.inflight = true;
            this.store.saveRun(run);
            const mission = await this.bridge.createMission(input);
            run.inflight = false;
            run.status = 'running';
            run.error = null;
            run.missionId = mission.id;
            run.missionName = typeof mission.name === 'string' ? mission.name : null;
            run.dispatchedAt = new Date(this.now()).toISOString();
            this.store.saveRun(run);
            this.log('info', `Dispatched "${schedule.name}" as mission ${mission.id}`);
            if (TERMINAL_MISSION.has(mission.status))
                await this.applyMissionUpdate(mission);
            return { run: toRun(run), bridgeUnavailable: false };
        }
        catch (err) {
            const be = err instanceof BridgeError ? err : null;
            const message = be ? `${be.code}: ${be.message}` : err instanceof Error ? err.message : String(err);
            run.inflight = false;
            run.error = message;
            if (be?.neverSent && retryUntil !== null && this.now() + this.retryDelayMs <= retryUntil) {
                run.retryAt = this.now() + this.retryDelayMs;
                this.log('warn', `Dispatch of "${schedule.name}" failed (${message}); retrying in ${this.retryDelayMs / 1000}s`);
            }
            else {
                run.status = 'dispatch_failed';
                run.retryAt = null;
                this.log('error', `Dispatch of "${schedule.name}" failed: ${message}`);
            }
            this.store.saveRun(run);
            return { run: toRun(run), bridgeUnavailable: be?.unavailable === true };
        }
    }
    /** Dispatches a schedule immediately (trigger 'manual'). Works even when the master switch is off. */
    async runNow(scheduleId) {
        const schedule = this.store.getSchedule(scheduleId);
        if (!schedule)
            throw new NotFoundError(`Schedule "${scheduleId}" does not exist.`);
        const run = this.newRun(schedule, 'manual', null, null);
        this.store.saveRun(run);
        return this.attempt(run, schedule, null);
    }
    /* ── tracking ── */
    /** Applies a Mission object (SSE `mission:update` payload or a poll result) to the run that owns it. */
    async applyMissionUpdate(mission, tasksHint) {
        if (!mission || typeof mission.id !== 'string')
            return;
        const run = this.store.listRuns().find((r) => r.missionId === mission.id);
        if (!run || TERMINAL_RUN.has(run.status) || !TERMINAL_MISSION.has(mission.status))
            return;
        if (this.finalizing.has(run.id))
            return;
        this.finalizing.add(run.id);
        try {
            let detail = null;
            try {
                detail = await this.bridge.getMission(mission.id);
            }
            catch (err) {
                this.log('warn', `Could not fetch detail of mission ${mission.id}: ${String(err)}`);
            }
            const finalMission = detail?.mission ?? mission;
            const tasks = detail?.tasks ?? tasksHint ?? [];
            const runTasks = tasks.map((t) => ({
                title: typeof t.title === 'string' ? t.title : '(untitled)',
                status: typeof t.status === 'string' ? t.status : 'unknown',
                result: typeof t.result === 'string' ? t.result : null
            }));
            const { brief: _brief, attachments: _att, ...missionRest } = finalMission;
            const columns = detail?.boardColumns ?? [];
            const columnTitle = new Map(columns.map((c) => [String(c.id), String(c.title ?? '')]));
            const result = {
                tasks: runTasks,
                costUsd: typeof finalMission.usd === 'number' && Number.isFinite(finalMission.usd) ? finalMission.usd : null,
                raw: {
                    mission: missionRest,
                    tasks,
                    boardCards: (detail?.boardCards ?? []).slice(0, RAW_CARD_CAP).map((c) => ({
                        id: c.id,
                        title: c.title,
                        type: c.type,
                        column: columnTitle.get(String(c.columnId)) ?? null,
                        description: cap(c.description),
                        docs: cap(c.docs)
                    }))
                }
            };
            const summary = typeof finalMission.summary === 'string' ? finalMission.summary : null;
            run.summary = summary;
            run.result = result;
            run.finishedAt = new Date(typeof finalMission.finishedAt === 'number' ? finalMission.finishedAt : this.now()).toISOString();
            if (finalMission.status === 'done') {
                run.status = 'finished';
                run.error = null;
            }
            else {
                run.status = 'failed';
                run.error = `Mission ${finalMission.status}${summary ? `: ${summary}` : ''}`;
            }
            run.retryAt = null;
            this.store.saveRun(run);
            this.log('info', `Run ${run.id} (${run.scheduleName}) ${run.status}`);
        }
        finally {
            this.finalizing.delete(run.id);
        }
    }
    /** Safety net for missed SSE events and for runs still open across a plugin restart. */
    async pollRuns() {
        if (this.polling)
            return;
        const active = this.store.listRuns().filter((r) => r.status === 'running' && r.missionId);
        if (active.length === 0)
            return;
        this.polling = true;
        try {
            let list;
            try {
                list = await this.bridge.listMissions();
            }
            catch {
                return; // Bridge down: nothing to conclude, try again next poll
            }
            for (const run of active) {
                const mission = list.missions.find((m) => m.id === run.missionId);
                if (!mission) {
                    run.missingPolls += 1;
                    if (run.missingPolls >= MAX_MISSING_POLLS) {
                        run.status = 'failed';
                        run.finishedAt = new Date(this.now()).toISOString();
                        run.error = 'The ADE Bridge no longer lists this mission, so its outcome is unknown.';
                        this.store.saveRun(run);
                    }
                    else {
                        this.store.saveRun(run);
                    }
                    continue;
                }
                if (run.missingPolls !== 0) {
                    run.missingPolls = 0;
                    this.store.saveRun(run);
                }
                if (TERMINAL_MISSION.has(mission.status)) {
                    await this.applyMissionUpdate(mission, list.tasks.filter((t) => t.missionId === mission.id));
                }
                else if (run.dispatchedAt && this.now() - Date.parse(run.dispatchedAt) > MAX_RUN_MS) {
                    run.status = 'failed';
                    run.finishedAt = new Date(this.now()).toISOString();
                    run.error = `The mission was still "${mission.status}" ${MAX_RUN_MS / 3_600_000}h after dispatch; the plugin stopped tracking it.`;
                    this.store.saveRun(run);
                }
            }
        }
        finally {
            this.polling = false;
        }
    }
    prune() {
        const cutoff = this.now() - this.cfg.historyRetentionDays * DAY_MS;
        for (const run of this.store.listRuns()) {
            if (!TERMINAL_RUN.has(run.status))
                continue;
            const ref = run.scheduledFor ? Date.parse(run.scheduledFor) : run.createdAtMs;
            if (ref <= cutoff)
                this.store.deleteRun(run.id);
        }
    }
    /* ── schedules CRUD ── */
    async refreshCatalog() {
        if (this.now() - this.catalogAt < CATALOG_TTL_MS)
            return;
        this.catalogAt = this.now();
        try {
            const catalog = await this.bridge.catalog();
            this.workspaceNames = new Map(catalog.workspaces.map((w) => [w.id, w.name]));
        }
        catch {
            // keep whatever names we had
        }
    }
    toSchedule(s) {
        const now = this.now();
        const next = s.enabled && this.cfg.enabled ? nextSlotAfter(s, Math.max(now, s.armedAt)) : null;
        let last = null;
        for (const r of this.store.listRuns()) {
            if (r.scheduleId === s.id && r.dispatchedAt && (last === null || r.dispatchedAt > last))
                last = r.dispatchedAt;
        }
        const { armedAt: _armed, attachments, ...input } = s;
        return { ...input, attachments: attachments.map(toMeta), workspaceName: this.workspaceNames.get(s.workspaceId) ?? null, nextRunAt: next ? new Date(next.at).toISOString() : null, lastRunAt: last };
    }
    async listSchedules() {
        await this.refreshCatalog();
        return this.store.listSchedules().map((s) => this.toSchedule(s));
    }
    /**
     * Checks workspace/squad/maestro/models against the live Bridge catalog (400 naming the field on a mismatch).
     * With the Bridge unreachable the schedule is accepted and the returned warning says what was not checked.
     */
    async checkAgainstBridge(input) {
        let catalog;
        try {
            catalog = await this.bridge.catalog();
        }
        catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            this.log('warn', `Schedule "${input.name}" saved without validating against the Bridge: ${why}`);
            return [`The ADE Bridge could not be reached (${why}), so workspaceId, squadId, maestro and models were not validated. They are checked again when the schedule dispatches.`];
        }
        this.workspaceNames = new Map(catalog.workspaces.map((w) => [w.id, w.name]));
        this.catalogAt = this.now();
        return validateAgainstCatalog(input, catalog);
    }
    async createSchedule(body) {
        const input = parseScheduleInput(body, this.cfg.defaultTimezone);
        const warnings = await this.checkAgainstBridge(input);
        const nowIso = new Date(this.now()).toISOString();
        const stored = { ...input, attachments: [], id: randomUUID(), createdAt: nowIso, updatedAt: nowIso, armedAt: this.now() };
        this.store.saveSchedule(stored);
        return { ...this.toSchedule(stored), warnings };
    }
    async updateSchedule(id, body) {
        const existing = this.store.getSchedule(id);
        if (!existing)
            throw new NotFoundError(`Schedule "${id}" does not exist.`);
        const input = parseScheduleInput(body, this.cfg.defaultTimezone);
        const warnings = await this.checkAgainstBridge(input);
        const timingChanged = input.time !== existing.time ||
            input.timezone !== existing.timezone ||
            input.enabled !== existing.enabled ||
            input.days.join(',') !== existing.days.join(',');
        const stored = {
            ...input,
            attachments: existing.attachments,
            id,
            createdAt: existing.createdAt,
            updatedAt: new Date(this.now()).toISOString(),
            armedAt: timingChanged ? this.now() : existing.armedAt
        };
        this.store.saveSchedule(stored);
        return { ...this.toSchedule(stored), warnings };
    }
    deleteSchedule(id) {
        if (!this.store.deleteSchedule(id))
            throw new NotFoundError(`Schedule "${id}" does not exist.`);
        this.files.removeAll(id);
    }
    /** Stores a file for a schedule (JSON upload, base64). Returns the updated schedule. */
    async addAttachment(scheduleId, upload) {
        const existing = this.store.getSchedule(scheduleId);
        if (!existing)
            throw new NotFoundError(`Schedule "${scheduleId}" does not exist.`);
        const attachment = this.files.save(scheduleId, upload, existing.attachments);
        const stored = { ...existing, attachments: [...existing.attachments, attachment], updatedAt: new Date(this.now()).toISOString() };
        this.store.saveSchedule(stored);
        await this.refreshCatalog();
        return this.toSchedule(stored);
    }
    async removeAttachment(scheduleId, attachmentId) {
        const existing = this.store.getSchedule(scheduleId);
        if (!existing)
            throw new NotFoundError(`Schedule "${scheduleId}" does not exist.`);
        const attachment = existing.attachments.find((a) => a.id === attachmentId);
        if (!attachment)
            throw new NotFoundError(`Attachment "${attachmentId}" does not exist on this schedule.`);
        const stored = {
            ...existing,
            attachments: existing.attachments.filter((a) => a.id !== attachmentId),
            updatedAt: new Date(this.now()).toISOString()
        };
        this.store.saveSchedule(stored);
        this.files.remove(scheduleId, attachment);
        await this.refreshCatalog();
        return this.toSchedule(stored);
    }
    /* ── runs ── */
    listRuns(filter = {}) {
        const limit = filter.limit ?? 100;
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
            throw new ValidationError('limit: must be an integer between 1 and 1000');
        const sortTime = (r) => (r.scheduledFor ? Date.parse(r.scheduledFor) : r.createdAtMs);
        return this.store
            .listRuns()
            .filter((r) => !filter.scheduleId || r.scheduleId === filter.scheduleId)
            .sort((a, b) => sortTime(b) - sortTime(a) || b.createdAtMs - a.createdAtMs)
            .slice(0, limit)
            .map(toRun);
    }
    getRun(id) {
        const run = this.store.getRun(id);
        if (!run)
            throw new NotFoundError(`Run "${id}" does not exist.`);
        return toRun(run);
    }
    /* ── bridge passthrough for the dashboard ── */
    async bridgeConnected() {
        if (this.now() - this.probe.at < BRIDGE_PROBE_TTL_MS)
            return this.probe.connected;
        let connected = false;
        try {
            await this.bridge.health();
            connected = true;
        }
        catch {
            connected = false;
        }
        this.probe = { at: this.now(), connected };
        return connected;
    }
    async workspaces() {
        const catalog = await this.bridge.catalog();
        this.workspaceNames = new Map(catalog.workspaces.map((w) => [w.id, w.name]));
        this.catalogAt = this.now();
        return catalog.workspaces;
    }
    /** Catalog for the dashboard's form: squads (with their agents), maestros and — when the Bridge has them — models. */
    async catalog() {
        try {
            const { squads, maestros, models } = await this.bridge.catalog();
            return { available: true, squads, maestros, ...(models ? { models } : {}) };
        }
        catch {
            return { available: false, squads: [], maestros: [] };
        }
    }
}
