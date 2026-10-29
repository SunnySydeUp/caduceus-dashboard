// What Work › Board knows about a Hermes Kanban board, free of the DOM and of React: the columns, the cards, the filters
// and how they read back from the URL. Everything comes from Hermes's answers (D1); nothing here is stored.
import { matchesPlaybook } from './task-playbook.ts';

/** Hermes's task lifecycle, in the order its board lays the columns out (`BOARD_COLUMNS` in the Kanban plugin). `archived` is hidden. */
export const BOARD_STATUSES = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** Why a blocked task is blocked (`VALID_BLOCK_KINDS` in Hermes). */
export const BLOCK_KINDS = ['dependency', 'needs_input', 'capability', 'transient'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** A task as a card shows it. */
export interface BoardTask {
  id: string;
  title: string;
  status: BoardStatus;
  /** The profile the task is assigned to. */
  assignee: string | null;
  /** Hermes's integer priority: higher runs first, 0 is normal. */
  priority: number;
  tenant: string | null;
  projectId: string | null;
  blockKind: BlockKind | null;
  /** A short preview of the latest run's summary (Hermes cuts it at 200 characters). */
  summary: string | null;
  commentCount: number;
  /** Seconds since the epoch. */
  createdAt: number;
  /** The playbook the task came from (`workflow_template_id`). */
  workflowTemplateId: string | null;
  /** The stage the task is at (`current_step_key`); `null` until Hermes fills it. */
  currentStepKey: string | null;
  /** Where the playbook engine writes its tag while Hermes cannot set the native fields (`contracts/playbook-runs.ts`). */
  idempotencyKey: string | null;
  /** Seconds since the epoch; `null` until a worker started it / until it finished. */
  startedAt: number | null;
  completedAt: number | null;
  lastHeartbeatAt: number | null;
  /** Attempts since the last success that did not succeed (`consecutive_failures`); Hermes clears it when the task finishes. */
  failures: number;
  /** What the latest failed attempt said (`last_failure_error`). */
  lastFailureError: string | null;
}

export interface BoardColumn {
  status: BoardStatus;
  tasks: BoardTask[];
}

export interface BoardData {
  /** One per status, in lifecycle order, empty ones included. */
  columns: BoardColumn[];
  /** Every task of every column. */
  tasks: BoardTask[];
  tenants: string[];
  assignees: string[];
  /** The last Kanban event the board already reflects: the events socket resumes after it. */
  latestEventId: number;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

const isStatus = (value: unknown): value is BoardStatus => BOARD_STATUSES.some((status) => status === value);
const isBlockKind = (value: unknown): value is BlockKind => BLOCK_KINDS.some((kind) => kind === value);

/** Reads one task of `GET /api/plugins/kanban/board`; `undefined` for a row that is not a task. */
function parseTask(value: unknown, status: BoardStatus): BoardTask | undefined {
  const task = record(value);
  if (typeof task.id !== 'string' || typeof task.title !== 'string') return undefined;
  return {
    id: task.id,
    title: task.title,
    status,
    assignee: textOrNull(task.assignee),
    priority: count(task.priority),
    tenant: textOrNull(task.tenant),
    projectId: textOrNull(task.project_id),
    blockKind: isBlockKind(task.block_kind) ? task.block_kind : null,
    summary: textOrNull(task.latest_summary),
    commentCount: count(task.comment_count),
    createdAt: count(task.created_at),
    workflowTemplateId: textOrNull(task.workflow_template_id),
    currentStepKey: textOrNull(task.current_step_key),
    idempotencyKey: textOrNull(task.idempotency_key),
    startedAt: maybeNumber(task.started_at),
    completedAt: maybeNumber(task.completed_at),
    lastHeartbeatAt: maybeNumber(task.last_heartbeat_at),
    failures: count(task.consecutive_failures),
    lastFailureError: textOrNull(task.last_failure_error),
  };
}

/**
 * Reads `GET /api/plugins/kanban/board`. Hermes declares no response schema for the plugin (the pin types it `unknown`), so
 * the body is read defensively: a column Hermes does not name is left out, every status has a column, and a row that is not
 * a task is skipped. A body that has no `columns` at all is not a board and throws, so the page shows its error and not an empty board.
 */
export function parseBoard(body: unknown): BoardData {
  const root = record(body);
  if (!Array.isArray(root.columns)) throw new Error('Hermes’s board answer has no columns');
  const columns: BoardColumn[] = BOARD_STATUSES.map((status) => ({ status, tasks: [] }));
  for (const item of root.columns) {
    const column = record(item);
    if (!isStatus(column.name) || !Array.isArray(column.tasks)) continue;
    const status = column.name;
    columns.find((candidate) => candidate.status === status)!.tasks = column.tasks.flatMap((value) => parseTask(value, status) ?? []);
  }
  return {
    columns,
    tasks: columns.flatMap((column) => column.tasks),
    tenants: strings(root.tenants),
    assignees: strings(root.assignees),
    latestEventId: count(root.latest_event_id),
  };
}

/** The assignee filter's value for tasks nobody is assigned to. */
export const UNASSIGNED = 'none';

export interface BoardFilters {
  /** A profile name, or `UNASSIGNED`. */
  assignee?: string;
  /** Hermes's integer priority; 0 is the normal ones. */
  priority?: number;
  /** A Hermes project id. */
  project?: string;
  /** What the playbook filter holds: `<id>@<version>` (`task-playbook.ts`). */
  playbook?: string;
  tenant?: string;
  /** Words that must each appear in a task's id, title, assignee or tenant. */
  text?: string;
}

/** Whether a task passes every filter that is set. */
export function filterTasks(tasks: readonly BoardTask[], filters: BoardFilters): BoardTask[] {
  const words = (filters.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter((task) => {
    if (filters.assignee !== undefined && (filters.assignee === UNASSIGNED ? task.assignee !== null : task.assignee !== filters.assignee)) return false;
    if (filters.priority !== undefined && task.priority !== filters.priority) return false;
    if (filters.project !== undefined && task.projectId !== filters.project) return false;
    if (filters.tenant !== undefined && task.tenant !== filters.tenant) return false;
    if (filters.playbook !== undefined && !matchesPlaybook(task, filters.playbook)) return false;
    const haystack = `${task.id} ${task.title} ${task.assignee ?? ''} ${task.tenant ?? ''}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** How the lanes are cut: one per Hermes status, or one per assignee profile. */
export type LaneGrouping = 'status' | 'profile';

/** What the URL of the board carries besides the board itself: the grouping, the lane a phone shows, and the filters. */
export interface BoardView {
  lanes: LaneGrouping;
  /** The lane a phone's list shows: a status, or a profile name (`UNASSIGNED` for tasks nobody has). */
  lane?: string;
  filters: BoardFilters;
}

const wholeNumber = (value: unknown): number | undefined => (typeof value === 'string' && /^-?\d{1,9}$/.test(value) ? Number(value) : undefined);
const nonBlank = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** Reads the view from the URL's query; anything damaged is as if it were not there. */
export function readView(search: Record<string, unknown>): BoardView {
  const filters: BoardFilters = {};
  const assignee = nonBlank(search.assignee);
  const priority = wholeNumber(search.priority);
  const project = nonBlank(search.project);
  const tenant = nonBlank(search.tenant);
  const playbook = nonBlank(search.playbook);
  const text = nonBlank(search.q);
  if (assignee !== undefined) filters.assignee = assignee;
  if (priority !== undefined) filters.priority = priority;
  if (project !== undefined) filters.project = project;
  if (playbook !== undefined) filters.playbook = playbook;
  if (tenant !== undefined) filters.tenant = tenant;
  if (text !== undefined) filters.text = text.trim();
  const lane = nonBlank(search.lane);
  return { lanes: search.lanes === 'profile' ? 'profile' : 'status', ...(lane === undefined ? {} : { lane }), filters };
}

/** The query that carries a view; the default view (by status, no filters) is no query at all. */
export function viewSearch({ lanes, lane, filters }: BoardView): Record<string, string> {
  const search: Record<string, string> = {};
  if (lanes === 'profile') search.lanes = lanes;
  if (lane !== undefined) search.lane = lane;
  if (filters.assignee !== undefined) search.assignee = filters.assignee;
  if (filters.priority !== undefined) search.priority = String(filters.priority);
  if (filters.project !== undefined) search.project = filters.project;
  if (filters.playbook !== undefined) search.playbook = filters.playbook;
  if (filters.tenant !== undefined) search.tenant = filters.tenant;
  if (filters.text !== undefined && filters.text.trim() !== '') search.q = filters.text;
  return search;
}

/** What each status is called, and what it means in Hermes's lifecycle (the hint a lane shows when it is empty). */
export const STATUS_META: Record<BoardStatus, { label: string; hint: string }> = {
  triage: { label: 'Triage', hint: 'Rough ideas. Hermes can turn one into a brief.' },
  todo: { label: 'Todo', hint: 'Accepted, but not ready to be picked up yet.' },
  scheduled: { label: 'Scheduled', hint: 'Becomes ready at a set time.' },
  ready: { label: 'Ready', hint: 'The dispatcher starts a worker when one is free.' },
  running: { label: 'Running', hint: 'A worker has claimed the task and is on it.' },
  blocked: { label: 'Blocked', hint: 'Waiting on input, another task, or a retry.' },
  review: { label: 'Review', hint: 'Finished by a worker and waiting for you.' },
  done: { label: 'Done', hint: 'Finished.' },
};

/** A lane of the board: a status, or one assignee profile. */
export interface Lane {
  /** The status, or the profile name (`UNASSIGNED` for tasks nobody has). It names the lane in the URL. */
  key: string;
  label: string;
  tasks: BoardTask[];
  /** The status of a by-status lane. */
  status?: BoardStatus;
}

const STATUS_RANK = new Map<string, number>(BOARD_STATUSES.map((status, index) => [status, index]));

/** The lanes of `tasks` (already filtered): every status in lifecycle order, or each assignee that has tasks. Tasks keep Hermes's order within a lane. */
export function lanesFor(tasks: readonly BoardTask[], grouping: LaneGrouping): Lane[] {
  if (grouping === 'status') return BOARD_STATUSES.map((status) => ({ key: status, label: STATUS_META[status].label, status, tasks: tasks.filter((task) => task.status === status) }));
  const names = [...new Set(tasks.flatMap((task) => task.assignee ?? []))].sort((a, b) => a.localeCompare(b));
  const byLifecycle = (list: BoardTask[]) => list.toSorted((a, b) => STATUS_RANK.get(a.status)! - STATUS_RANK.get(b.status)!);
  const lanes = names.map((name): Lane => ({ key: name, label: name, tasks: byLifecycle(tasks.filter((task) => task.assignee === name)) }));
  const unassigned = tasks.filter((task) => task.assignee === null);
  return unassigned.length > 0 ? [...lanes, { key: UNASSIGNED, label: 'Unassigned', tasks: unassigned }] : lanes;
}

/** The statuses a phone always offers, as its segmented control lists them. Todo and Scheduled join them only while they hold tasks. */
const PHONE_STATUS_ORDER: readonly BoardStatus[] = ['triage', 'todo', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done'];
const PHONE_ALWAYS = new Set<string>(['triage', 'ready', 'running', 'review', 'blocked', 'done']);

/** The lanes a phone's segmented control offers (by profile: all of them). */
export function phoneLanes(lanes: readonly Lane[]): Lane[] {
  if (!lanes.some((lane) => lane.status !== undefined)) return [...lanes];
  return PHONE_STATUS_ORDER.flatMap((status) => lanes.filter((lane) => lane.status === status && (PHONE_ALWAYS.has(status) || lane.tasks.length > 0)));
}

/** The statuses that wait for the owner, most urgent first: where a phone opens when no lane was asked for. */
const NEEDS_THE_OWNER: readonly string[] = ['review', 'blocked'];

/** The lane a phone shows: the one asked for, else the first that needs the owner, else the first that holds tasks, else the first. */
export function currentLane(lanes: readonly Lane[], requested: string | undefined): Lane {
  return (
    lanes.find((lane) => lane.key === requested) ??
    NEEDS_THE_OWNER.flatMap((key) => lanes.filter((lane) => lane.key === key && lane.tasks.length > 0))[0] ??
    lanes.find((lane) => lane.tasks.length > 0) ??
    lanes[0]
  );
}

/** The latest attempt at a task, as the peek shows it (a Kanban `task_runs` row). */
export interface PeekRun {
  /** How the attempt ended: `completed`, `blocked`, `crashed`, `timed_out`, `reclaimed`…; `null` while it runs. */
  outcome: string | null;
  status: string;
  summary: string | null;
  error: string | null;
  profile: string | null;
  startedAt: number;
  endedAt: number | null;
}

/** What the read-only peek of a task shows. */
export interface TaskPeek {
  id: string;
  title: string;
  /** A board status, or `archived`. */
  status: string;
  assignee: string | null;
  priority: number;
  blockKind: BlockKind | null;
  /** The task's Markdown body. */
  brief: string;
  latestRun: PeekRun | null;
  runCount: number;
}

const maybeNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Reads `GET /api/plugins/kanban/tasks/{id}`; throws when the answer is not a task (an error body), so the peek says so. */
export function parsePeek(body: unknown): TaskPeek {
  const root = record(body);
  const task = record(root.task);
  if (typeof task.id !== 'string' || typeof task.title !== 'string' || typeof task.status !== 'string') throw new Error('Hermes’s answer is not a task');
  const runs = Array.isArray(root.runs) ? root.runs : [];
  const latest = record(runs.at(-1));
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    assignee: textOrNull(task.assignee),
    priority: count(task.priority),
    blockKind: isBlockKind(task.block_kind) ? task.block_kind : null,
    brief: typeof task.body === 'string' ? task.body : '',
    latestRun:
      runs.length === 0
        ? null
        : {
            outcome: textOrNull(latest.outcome),
            status: typeof latest.status === 'string' ? latest.status : '',
            summary: textOrNull(latest.summary),
            error: textOrNull(latest.error),
            profile: textOrNull(latest.profile),
            startedAt: count(latest.started_at),
            endedAt: maybeNumber(latest.ended_at),
          },
    runCount: runs.length,
  };
}

/** The start of a brief, at most `max` characters, cut between words; `cut` says whether there was more. */
export function briefExcerpt(brief: string, max: number): { text: string; cut: boolean } {
  const text = brief.trim();
  if (text.length <= max) return { text, cut: false };
  const head = text.slice(0, max);
  const lastSpace = head.search(/\s\S*$/);
  return { text: (lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd(), cut: true };
}

/** Why a task is blocked, in words, by Hermes's block kind. */
export const BLOCK_META: Record<BlockKind, { label: string; hint: string }> = {
  dependency: { label: 'Waiting on a task', hint: 'Another task has to finish first.' },
  needs_input: { label: 'Needs your input', hint: 'The worker asked a question and is waiting for an answer.' },
  capability: { label: 'No worker can take it', hint: 'No profile has the skills this task needs.' },
  transient: { label: 'Will retry', hint: 'It failed in a way that may pass, so Hermes will try again.' },
};

/** What a failed worker's last error says, in words the owner can use: protocol text is replaced, anything else is kept. */
export function failureLine(error: string | null): string {
  if (error === null || /without\s+kanban_complete|rc\s*=\s*0/i.test(error)) return 'The worker stopped before it finished. Retry it.';
  return `Failed: ${error}`;
}

/** The line a blocked task's card and row show: Hermes's kind in words, else the failure, else the reason whoever blocked it typed. `undefined` unless blocked. */
export function blockReason(task: Pick<BoardTask, 'status' | 'blockKind' | 'summary' | 'lastFailureError' | 'failures'>): { label: string; tone: 'warning' | 'blocked'; icon: 'question' | 'blocked' } | undefined {
  if (task.status !== 'blocked') return undefined;
  if (task.blockKind !== null) return { label: BLOCK_META[task.blockKind].label, tone: task.blockKind === 'needs_input' ? 'warning' : 'blocked', icon: task.blockKind === 'needs_input' ? 'question' : 'blocked' };
  if (task.lastFailureError !== null || task.failures > 0) return { label: failureLine(task.lastFailureError), tone: 'warning', icon: 'blocked' };
  return { label: task.summary ?? 'Blocked', tone: 'blocked', icon: 'blocked' };
}

/** The palette's hits for `query`: tasks whose title has every word of it (any case), at most `max`, each with its state and agent. */
export function taskHits(board: BoardData, query: string, max = 8): { id: string; label: string; sub: string; path: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];
  return board.tasks
    .filter((task) => words.every((word) => task.title.toLowerCase().includes(word)))
    .slice(0, max)
    .map((task) => ({ id: `task:${task.id}`, label: task.title, sub: `${STATUS_META[task.status].label} · ${task.assignee ?? 'Unassigned'}`, path: `/work/tasks/${encodeURIComponent(task.id)}` }));
}

/** The priority as a card says it; the normal priority, 0, is not worth a tag. */
export function priorityLabel(priority: number): string | undefined {
  return priority === 0 ? undefined : priority > 0 ? `Priority ${priority}` : `Low priority ${-priority}`;
}

/** How a run ended, in words. */
export function outcomeLabel(run: PeekRun): string {
  const labels: Record<string, string> = {
    completed: 'Completed',
    blocked: 'Blocked',
    crashed: 'Crashed',
    timed_out: 'Timed out',
    spawn_failed: 'Could not start',
    review_requested: 'Sent for review',
    reclaimed: 'Reclaimed',
  };
  return run.outcome === null ? 'Running' : (labels[run.outcome] ?? run.outcome.replaceAll('_', ' '));
}
