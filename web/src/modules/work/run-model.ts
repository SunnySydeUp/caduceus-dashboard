// The run view's pure logic (M3 #11): what Hermes's run, run-inspect and session routes say, read defensively (Hermes declares no response schema for
// the Kanban plugin), which worker session is a run's, the run's steps and the header's figures. No DOM and no React. Nothing is kept: a run is whatever
// Hermes last said, and Caduceus has no table that links runs and sessions (D1) — the link is read from what a dispatched worker leaves in Hermes's store.

import { stripAnsi } from '@caduceus/contracts/hermes/shared/ansi';
import { entriesOf } from '../chat/activity.ts';
import type { HistoryRow } from '../chat/history-window.ts';
import { availableActions, outcomeText, runCost, type TaskFull, type TaskRun } from './task-model.ts';

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** One run (a `task_runs` row) as `GET /api/plugins/kanban/runs/{id}` gives it. */
export interface RunInfo {
  id: number;
  taskId: string;
  profile: string | null;
  /** `running`, or how it ended (`completed`, `crashed`, `reclaimed`…). */
  status: string;
  outcome: string | null;
  summary: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: number;
  endedAt: number | null;
  workerPid: number | null;
}

/** Reads the answer of `GET /runs/{id}`; throws when it is not a run (an error body), so the page says so. */
export function parseRun(body: unknown): RunInfo {
  const run = record(record(body).run);
  const id = numberOrNull(run.id);
  const startedAt = numberOrNull(run.started_at);
  if (id === null || typeof run.task_id !== 'string' || startedAt === null) throw new Error('Hermes’s answer is not a run');
  return {
    id,
    taskId: run.task_id,
    profile: textOrNull(run.profile),
    status: typeof run.status === 'string' ? run.status : '',
    outcome: textOrNull(run.outcome),
    summary: textOrNull(run.summary),
    error: textOrNull(run.error),
    metadata: typeof run.metadata === 'object' && run.metadata !== null && !Array.isArray(run.metadata) ? record(run.metadata) : null,
    startedAt,
    endedAt: numberOrNull(run.ended_at),
    workerPid: numberOrNull(run.worker_pid),
  };
}

// ── The run's session ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A session of Hermes's store as far as the run view reads it. */
export interface WorkerSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  /** The first user message (a worker's is `work kanban task <id>`). */
  preview: string;
  inputTokens: number;
  outputTokens: number;
  /** What the session cost: the real figure when Hermes has it, else its estimate. */
  costUsd: number | null;
  messageCount: number;
  profile: string | null;
}

/** How many sessions one request asks for (Hermes allows 100). */
export const SESSION_PAGE = 100;

/** The worker sessions of the run's profile, newest first: where the run's session is looked for, a page at a time. */
export const sessionsPath = (run: Pick<RunInfo, 'profile'>, offset: number): string =>
  `/api/sessions?${new URLSearchParams({ source: 'kanban', ...(run.profile ? { profile: run.profile } : {}), order: 'created', limit: String(SESSION_PAGE), offset: String(offset) })}`;

/** How many rows of a transcript one request asks for (Hermes allows 500). */
export const ROW_PAGE = 500;
/** The most rows the view reads: a worker's transcript past this is read in Chat. */
export const MAX_ROWS = 5000;

/** A page of the session's rows, oldest first. */
export const rowsPath = (sessionId: string, profile: string | null, offset: number): string =>
  `/api/sessions/${encodeURIComponent(sessionId)}/messages?${new URLSearchParams({ ...(profile ? { profile } : {}), order: 'oldest', limit: String(ROW_PAGE), offset: String(offset) })}`;

/** Reads a page of `GET /api/sessions`; a row that is not a session is dropped. */
export function parseSessionRows(body: unknown): WorkerSession[] {
  const rows = record(body).sessions;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw): WorkerSession[] => {
    const row = record(raw);
    const startedAt = numberOrNull(row.started_at);
    if (typeof row.id !== 'string' || startedAt === null) return [];
    return [
      {
        id: row.id,
        startedAt,
        endedAt: numberOrNull(row.ended_at),
        preview: typeof row.preview === 'string' ? row.preview : '',
        inputTokens: numberOrNull(row.input_tokens) ?? 0,
        outputTokens: numberOrNull(row.output_tokens) ?? 0,
        costUsd: numberOrNull(row.actual_cost_usd) ?? numberOrNull(row.estimated_cost_usd),
        messageCount: numberOrNull(row.message_count) ?? 0,
        profile: textOrNull(row.profile),
      },
    ];
  });
}

/** A worker's session starts a few seconds after the run opens (the process starts and builds its agent); this is how early a clock may differ. */
const CLOCK_SLACK_S = 5;

/**
 * The session of a run: of those that started inside it (from the moment it opened until it ended), and whose first message names this run's task,
 * the first. A worker that made two (it was restarted) is shown by its first; the rest are one tap away in Chat. `undefined` while the worker has not
 * started its session, or when Hermes no longer has it.
 */
export function pickRunSession(run: Pick<RunInfo, 'taskId' | 'startedAt' | 'endedAt'>, sessions: readonly WorkerSession[]): WorkerSession | undefined {
  return sessions
    .filter((session) => session.startedAt >= run.startedAt - CLOCK_SLACK_S && (run.endedAt === null || session.startedAt <= run.endedAt) && (session.preview === '' || session.preview.includes(run.taskId)))
    .sort((a, b) => a.startedAt - b.startedAt)[0];
}

// ── Steps ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type StepOutcome = 'done' | 'failed' | 'incomplete' | 'running';

/** One turn of the worker: the assistant message, the tool calls it made and their results. */
export interface RunStep {
  /** The id of the step's first row: stable while rows are added after it. */
  key: number;
  /** Starts at 1. */
  index: number;
  title: string;
  /** Seconds from the row before the step to its last row: what the model and its tools took. */
  durationS: number | null;
  /** What Hermes recorded on the step's rows; `null` when it recorded none. Hermes keeps the cost of the session, not of a step. */
  tokens: number | null;
  outcome: StepOutcome;
  /** Why a failed step failed, in the tool's words. */
  failure?: string;
  toolCount: number;
  rows: HistoryRow[];
}

const timestampOf = (row: HistoryRow): number | null => numberOrNull(row.timestamp);

/** A step's name: the start of what the assistant said, else its tools (the first three). */
function titleOf(rows: readonly HistoryRow[], names: readonly string[]): string {
  const words = typeof rows[0]?.content === 'string' ? rows[0].content.trim().replace(/\s+/g, ' ') : '';
  if (words !== '') return words.length > 80 ? `${words.slice(0, 79)}…` : words;
  if (names.length > 0) return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
  return 'Reply';
}

/**
 * The steps of a worker's session, from Hermes's rows (oldest first): every assistant message opens one, and the tool results, and a user message
 * that nudges the worker on, belong to the step before them. `finished` says the session is over: the last step of one that is not is still running,
 * and a tool call without a result in one that is over is incomplete.
 */
export function stepsOf(rows: readonly HistoryRow[], { finished }: { finished: boolean }): RunStep[] {
  const groups: { rows: HistoryRow[]; before: number | null }[] = [];
  let previous: number | null = null;
  for (const row of rows) {
    if (row.display_kind === 'hidden') continue;
    if (row.role === 'assistant') groups.push({ rows: [row], before: previous });
    else groups.at(-1)?.rows.push(row);
    previous = timestampOf(row) ?? previous;
  }
  return groups.map((group, position): RunStep => {
    const tools = entriesOf(group.rows).flatMap((entry) => (entry.kind === 'activity' ? entry.items.flatMap((item) => (item.kind === 'tool' ? [item] : [])) : []));
    const failed = tools.find((tool) => tool.status === 'failed');
    const last = position === groups.length - 1;
    const outcome: StepOutcome = failed ? 'failed' : last && !finished ? 'running' : tools.some((tool) => tool.status === 'incomplete') ? 'incomplete' : 'done';
    const started = group.before ?? timestampOf(group.rows[0]!);
    const ended = group.rows.reduce<number | null>((latest, row) => Math.max(latest ?? -Infinity, timestampOf(row) ?? -Infinity), null);
    const counted = group.rows.map((row) => numberOrNull(row.token_count)).filter((count): count is number => count !== null);
    return {
      key: group.rows[0]!.id,
      index: position + 1,
      title: titleOf(group.rows, tools.map((tool) => tool.name)),
      durationS: started === null || ended === null || !Number.isFinite(ended) ? null : Math.max(0, ended - started),
      tokens: counted.length === 0 ? null : counted.reduce((sum, count) => sum + count, 0),
      outcome,
      ...(failed?.error === undefined ? {} : { failure: failed.error }),
      toolCount: tools.length,
      rows: group.rows,
    };
  });
}

// ── The header ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RunSummary {
  label: string;
  running: boolean;
  /** Seconds from the start of the run to its end, or to now while it goes. */
  elapsedS: number;
  costUsd: number | null;
  /** Who gave the cost: Hermes's record of the run's session, or the worker, in the run's metadata (Hermes records none of its own). */
  costFrom: 'session' | 'worker' | null;
  /** Input and output tokens of the session; `null` without one. */
  tokens: number | null;
}

/** The status, time, cost and tokens of a run, as the header shows them. `nowS` ends a run that has not ended. */
export function runSummary(run: RunInfo, session: WorkerSession | undefined, nowS: number): RunSummary {
  const sessionCost = session?.costUsd ?? null;
  const workerCost = runCost(run.metadata);
  return {
    label: outcomeText(run),
    running: run.endedAt === null,
    elapsedS: Math.max(0, (run.endedAt ?? nowS) - run.startedAt),
    costUsd: sessionCost ?? workerCost,
    costFrom: sessionCost !== null ? 'session' : workerCost !== null ? 'worker' : null,
    tokens: session ? session.inputTokens + session.outputTokens : null,
  };
}

// ── Density ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How much of a run the page shows, the way Chat's activity modes do: Stream shows everything and opens every card, Worklog is quiet and keeps cards closed, Raw is what Hermes holds, unformatted. */
export const DENSITIES = ['stream', 'worklog', 'raw'] as const;
export type RunDensity = (typeof DENSITIES)[number];
export const DEFAULT_DENSITY: RunDensity = 'worklog';

export const parseDensity = (value: unknown): RunDensity | undefined => DENSITIES.find((density) => density === value);

/** The frames the Hermes CLI draws around its output (box lines) and what it says on the way in and out, which is not what the worker did. */
const CHROME = /^[\s─━═╭╮╰╯│┃┌┐└┘☤]*(Hermes)?[\s─━═╭╮╰╯│┃┌┐└┘☤]*$/;
const NOISE = /^(session_id:|Query:|Initializing agent|Resume this session with:)/;

/** The lines of the worker log in a density. */
export function shownLogLines(lines: readonly string[], density: RunDensity): string[] {
  if (density === 'raw') return [...lines];
  const clean = lines.map(stripAnsi);
  if (density === 'stream') return clean;
  return clean.filter((line) => line.trim() !== '' && !CHROME.test(line) && !NOISE.test(line.trim()));
}

// ── Inspect, Chat and actions ─────────────────────────────────────────────────────────────────────────────────────────────────

/** What Hermes's `GET /runs/{id}/inspect` says of the worker's process: live figures, or why there are none. */
export interface WorkerProcess {
  alive: boolean;
  pid: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  threads: number | null;
  status: string | null;
  /** Why there are no figures (`run already ended`, `process not found`, `access denied`). */
  reason: string | null;
}

export function parseInspect(body: unknown): WorkerProcess {
  const fields = record(body);
  return {
    alive: fields.alive === true,
    pid: numberOrNull(fields.pid),
    cpuPercent: numberOrNull(fields.cpu_percent),
    memoryBytes: numberOrNull(fields.memory_rss_bytes),
    threads: numberOrNull(fields.num_threads),
    status: textOrNull(fields.status),
    reason: textOrNull(fields.reason) ?? textOrNull(fields.error),
  };
}

/** Open in Chat: the worker's session is a chat of the profile that ran it. */
export const chatHref = (sessionId: string, profile: string | null): string => `/chat/${encodeURIComponent(sessionId)}${profile ? `?${new URLSearchParams({ profile })}` : ''}`;

export type RunActionId = 'terminate' | 'reclaim' | 'retry';

/**
 * The actions the run view offers, which are the task page's: Terminate and Reclaim while this run is going (and the task is still running), Retry
 * for the newest run of a task Hermes will take back to Ready. Hermes still decides, and says why when it refuses.
 */
export function runActions(task: TaskFull, run: RunInfo, runs: readonly TaskRun[]): RunActionId[] {
  if (task.status === 'archived') return [];
  if (run.endedAt === null) return task.status === 'running' ? ['terminate', 'reclaim'] : [];
  const newest = [...runs, run].sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)[0];
  if (newest?.id !== run.id) return [];
  return availableActions(task, runs).includes('retry') ? ['retry'] : [];
}
