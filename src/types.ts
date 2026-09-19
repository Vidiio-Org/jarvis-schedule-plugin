/**
 * Shared types. `ScheduleInput`, `Schedule` and `Run` are the LOCAL REST
 * contract the dashboard (ui/) is built against — do not change their shape
 * without coordinating with the ui pane.
 */

export interface ScheduleInput {
  name: string;
  briefing: string;
  workspaceId: string;
  /** Local wall-clock time in `timezone`, `HH:MM` (24h). */
  time: string;
  /** Days of week the schedule fires on: 0=Sunday .. 6=Saturday. */
  days: number[];
  /** IANA timezone name. */
  timezone: string;
  squadId: string | null;
  enabled: boolean;
}

export interface Schedule extends ScheduleInput {
  id: string;
  workspaceName: string | null;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

/** What is persisted for a schedule: the input plus bookkeeping the API hides. */
export interface StoredSchedule extends ScheduleInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Epoch ms from which slots count. Reset whenever time/days/timezone/enabled
   * change, so creating or editing a schedule never fires (or reports as
   * missed) a slot that lies before the edit.
   */
  armedAt: number;
}

export type RunStatus = 'dispatching' | 'running' | 'finished' | 'failed' | 'dispatch_failed' | 'missed';
export type RunTrigger = 'schedule' | 'manual';

export interface RunTask {
  title: string;
  status: string;
  result: string | null;
}

export interface RunResult {
  tasks: RunTask[];
  costUsd: number | null;
  raw: Record<string, unknown> | null;
}

export interface Run {
  id: string;
  scheduleId: string;
  scheduleName: string;
  trigger: RunTrigger;
  scheduledFor: string | null;
  dispatchedAt: string | null;
  status: RunStatus;
  missionId: string | null;
  missionName: string | null;
  finishedAt: string | null;
  error: string | null;
  summary: string | null;
  result: RunResult | null;
}

/** What is persisted for a run: the API shape plus internal dedupe/tracking state. */
export interface StoredRun extends Run {
  /** `<scheduleId>|<YYYY-MM-DD>|<HH:MM>` for scheduled runs, null for manual ones. */
  slotKey: string | null;
  /** Epoch ms the record was created (used for retention when scheduledFor is null). */
  createdAtMs: number;
  /** True while a POST /api/missions may be in flight — a crash here must never be retried. */
  inflight: boolean;
  /** Epoch ms of the next dispatch retry (only while status is 'dispatching' and no request is in flight). */
  retryAt: number | null;
  /** Consecutive polls where the Bridge answered but did not list the mission. */
  missingPolls: number;
}

/** A mission as the Bridge serialises it (only the fields the plugin reads). */
export interface BridgeMission {
  id: string;
  workspaceId?: string;
  name?: string;
  status: string;
  usd?: number;
  startedAt?: number;
  finishedAt?: number | null;
  summary?: string | null;
  [key: string]: unknown;
}

export interface BridgeTask {
  id?: string;
  missionId?: string;
  title?: string;
  status?: string;
  result?: string | null;
  [key: string]: unknown;
}

export interface Config {
  bridgeUrl: string;
  bridgeToken: string;
  dashboardPort: number;
  dashboardToken: string;
  defaultTimezone: string;
  historyRetentionDays: number;
  enabled: boolean;
}
