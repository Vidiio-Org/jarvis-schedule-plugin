/**
 * Shared types. `ScheduleInput`, `Schedule` and `Run` are the LOCAL REST
 * contract the dashboard (ui/) is built against — do not change their shape
 * without coordinating with the ui pane.
 */

/** Technology stack declared for the mission — same shape as the Bridge's `ProjectStack`. */
export interface ProjectStack {
  backend: string[];
  frontend: string[];
  mobile: string[];
  infra: string[];
  other: string[];
}

export const STACK_LAYERS = ['backend', 'frontend', 'mobile', 'infra', 'other'] as const;

/** What the API shows for a file attached to a schedule (never a path). */
export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
}

/** What was actually sent to the Bridge for a run (recorded for the run detail). */
export interface RunOptions {
  squadId: string | null;
  maestro: string | null;
  e2e: boolean;
  stack: ProjectStack | null;
  modelPool: string[];
  agentModels: Record<string, string>;
  attachments: Array<{ name: string; size: number }>;
  /** Anything the plugin dropped or adjusted on purpose (e.g. models on an old Bridge). */
  warnings: string[];
}

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
  /** Maestro backend id (Bridge `maestros[].id`), null = the Bridge's default. */
  maestro: string | null;
  /** Visible E2E test flow (Bridge `e2e`). */
  e2e: boolean;
  stack: ProjectStack;
  /** Model ids allowed for the mission; [] = inherit the squad's pool. */
  modelPool: string[];
  /** agentId -> model id overrides; {} = the squad's defaults. */
  agentModels: Record<string, string>;
}

export interface Schedule extends ScheduleInput {
  id: string;
  attachments: AttachmentMeta[];
  workspaceName: string | null;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

/** What POST/PUT /api/schedules answer: the schedule plus what could not be checked or will not take effect. */
export interface SavedSchedule extends Schedule {
  warnings: string[];
}

/** What is persisted for a schedule: the input plus bookkeeping the API hides. */
export interface StoredAttachment extends AttachmentMeta {
  /** File name inside the schedule's attachment directory (server-generated, never client-supplied). */
  file: string;
}

export interface StoredSchedule extends ScheduleInput {
  id: string;
  attachments: StoredAttachment[];
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
  /** Options sent to the Bridge; null for runs that were never dispatched (missed) or predate this field. */
  options: RunOptions | null;
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

/** Where the Bridge credentials came from: the ADE host (automatic) or the plugin settings (older ADE, manual). */
export type BridgeSource = 'host' | 'settings';

export interface Config {
  bridgeUrl: string;
  bridgeToken: string;
  bridgeSource: BridgeSource;
  dashboardPort: number;
  /** Null when not configured (optional since the embedded view is authenticated by the host). */
  dashboardToken: string | null;
  defaultTimezone: string;
  historyRetentionDays: number;
  enabled: boolean;
}
