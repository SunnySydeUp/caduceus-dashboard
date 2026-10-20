// The task page's pure logic: what Hermes's `GET /api/plugins/kanban/tasks/{id}` says, read defensively (Hermes declares no
// response schema for the plugin), and what the page derives from it. No DOM and no React. Nothing is kept: the detail is
// whatever Hermes last said (D1).

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);

export const TASK_TABS = [
  { id: 'brief', label: 'Brief' },
  { id: 'runs', label: 'Runs' },
  { id: 'activity', label: 'Activity' },
  { id: 'links', label: 'Links' },
  { id: 'attachments', label: 'Attachments' },
  { id: 'settings', label: 'Settings' },
] as const;
export type TaskTab = (typeof TASK_TABS)[number]['id'];

/** The tab an address names; an unknown or missing name is the Brief. */
export function tabOf(name: string | undefined): TaskTab {
  return TASK_TABS.find((tab) => tab.id === name)?.id ?? 'brief';
}

/** A task as the page shows it: the fields Hermes keeps on the task row. */
export interface TaskFull {
  id: string;
  title: string;
  /** A board status, or `archived`. */
  status: string;
  assignee: string | null;
  priority: number;
  /** The task's Markdown body. */
  brief: string;
  createdBy: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  workspaceKind: string;
  workspacePath: string | null;
  /** The branch a worktree task works on. */
  branchName: string | null;
  tenant: string | null;
  projectId: string | null;
  result: string | null;
  latestSummary: string | null;
  maxRuntimeSeconds: number | null;
  skills: string[] | null;
  modelOverride: string | null;
  providerOverride: string | null;
  reasoningEffort: string | null;
  goalMode: boolean;
  goalMaxTurns: number | null;
  /** Failures in a row that block the task; `null` is the dispatcher's own limit. */
  maxRetries: number | null;
  /** `local-only`, `OWNER/REPO` or a pull request's URL; Hermes writes `local-only` when none was given. */
  completionContract: string | null;
  blockKind: string | null;
  currentRunId: number | null;
  consecutiveFailures: number;
  lastFailureError: string | null;
}

export interface TaskRun {
  id: number;
  profile: string | null;
  status: string;
  /** How the attempt ended (`completed`, `crashed`, `reclaimed`…); `null` while it runs. */
  outcome: string | null;
  summary: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: number;
  endedAt: number | null;
}

export interface TaskComment {
  id: number;
  author: string;
  body: string;
  createdAt: number;
}

export interface TaskEvent {
  id: number;
  kind: string;
  payload: Record<string, unknown> | null;
  runId: number | null;
  createdAt: number;
}

export interface TaskAttachment {
  id: number;
  filename: string;
  contentType: string | null;
  size: number;
  uploadedBy: string | null;
  createdAt: number;
}

export interface TaskChildResult {
  id: string;
  title: string;
  status: string;
}

export interface TaskDetail {
  task: TaskFull;
  comments: TaskComment[];
  events: TaskEvent[];
  runs: TaskRun[];
  attachments: TaskAttachment[];
  links: { parents: string[]; children: string[] };
  childResults: TaskChildResult[];
  /** The newest event of this task: where the events socket resumes. */
  latestEventId: number;
}

/** Reads `GET /api/plugins/kanban/tasks/{id}`; throws when the answer is not a task (an error body), so the page says so. */
export function parseTaskDetail(body: unknown): TaskDetail {
  const root = record(body);
  const task = record(root.task);
  if (typeof task.id !== 'string' || typeof task.title !== 'string' || typeof task.status !== 'string') throw new Error('Hermes’s answer is not a task');
  const links = record(root.links);
  const events = list(root.events).map(
    (event): TaskEvent => ({
      id: count(event.id),
      kind: typeof event.kind === 'string' ? event.kind : '',
      payload: typeof event.payload === 'object' && event.payload !== null ? record(event.payload) : null,
      runId: numberOrNull(event.run_id),
      createdAt: count(event.created_at),
    }),
  );
  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      assignee: textOrNull(task.assignee),
      priority: count(task.priority),
      brief: typeof task.body === 'string' ? task.body : '',
      createdBy: textOrNull(task.created_by),
      createdAt: count(task.created_at),
      startedAt: numberOrNull(task.started_at),
      completedAt: numberOrNull(task.completed_at),
      workspaceKind: textOrNull(task.workspace_kind) ?? 'scratch',
      workspacePath: textOrNull(task.workspace_path),
      branchName: textOrNull(task.branch_name),
      tenant: textOrNull(task.tenant),
      projectId: textOrNull(task.project_id),
      result: textOrNull(task.result),
      latestSummary: textOrNull(task.latest_summary),
      maxRuntimeSeconds: numberOrNull(task.max_runtime_seconds),
      skills: Array.isArray(task.skills) ? strings(task.skills) : null,
      modelOverride: textOrNull(task.model_override),
      providerOverride: textOrNull(task.provider_override),
      reasoningEffort: textOrNull(task.reasoning_effort),
      goalMode: task.goal_mode === true,
      goalMaxTurns: numberOrNull(task.goal_max_turns),
      maxRetries: numberOrNull(task.max_retries),
      completionContract: textOrNull(task.completion_contract),
      blockKind: textOrNull(task.block_kind),
      currentRunId: numberOrNull(task.current_run_id),
      consecutiveFailures: count(task.consecutive_failures),
      lastFailureError: textOrNull(task.last_failure_error),
    },
    comments: list(root.comments).map((comment) => ({ id: count(comment.id), author: typeof comment.author === 'string' ? comment.author : '', body: typeof comment.body === 'string' ? comment.body : '', createdAt: count(comment.created_at) })),
    events,
    runs: list(root.runs).map(
      (run): TaskRun => ({
        id: count(run.id),
        profile: textOrNull(run.profile),
        status: typeof run.status === 'string' ? run.status : '',
        outcome: textOrNull(run.outcome),
        summary: textOrNull(run.summary),
        error: textOrNull(run.error),
        metadata: typeof run.metadata === 'object' && run.metadata !== null && !Array.isArray(run.metadata) ? record(run.metadata) : null,
        startedAt: count(run.started_at),
        endedAt: numberOrNull(run.ended_at),
      }),
    ),
    attachments: list(root.attachments).map((file) => ({
      id: count(file.id),
      filename: typeof file.filename === 'string' ? file.filename : '',
      contentType: textOrNull(file.content_type),
      size: count(file.size),
      uploadedBy: textOrNull(file.uploaded_by),
      createdAt: count(file.created_at),
    })),
    links: { parents: strings(links.parents), children: strings(links.children) },
    childResults: list(root.child_results).flatMap((child) => (typeof child.id === 'string' ? [{ id: child.id, title: typeof child.title === 'string' ? child.title : child.id, status: typeof child.status === 'string' ? child.status : '' }] : [])),
    latestEventId: events.reduce((newest, event) => Math.max(newest, event.id), 0),
  };
}

/** One line of the Activity tab: a Kanban event or a comment. */
export type ActivityItem =
  | { kind: 'comment'; key: string; at: number; comment: TaskComment }
  | { kind: 'event'; key: string; at: number; event: TaskEvent; text: string };

const EVENT_TEXT: Record<string, string> = {
  created: 'Task created',
  edited: 'Title or brief edited',
  claimed: 'A worker claimed the task',
  spawned: 'A worker was started',
  completed: 'Completed',
  blocked: 'Blocked',
  unblocked: 'Unblocked',
  crashed: 'The worker crashed',
  timed_out: 'The run timed out',
  reclaimed: 'The claim was reclaimed',
  assigned: 'Assigned',
  reassigned: 'Reassigned',
  commented: 'Commented',
  archived: 'Archived',
  heartbeat: 'Worker heartbeat',
};

/** What an event says, in words. A status change names the status; an unknown kind is its name with spaces. */
export function eventText(event: TaskEvent): string {
  const status = event.payload?.status;
  if (event.kind === 'status' && typeof status === 'string') return `Moved to ${status}`;
  const assignee = event.payload?.assignee ?? event.payload?.profile;
  if ((event.kind === 'assigned' || event.kind === 'reassigned') && typeof assignee === 'string') return `${EVENT_TEXT[event.kind]} to ${assignee}`;
  return EVENT_TEXT[event.kind] ?? event.kind.replaceAll('_', ' ');
}

/**
 * The Activity tab: Kanban events and comments in one list, oldest first (a conversation reads down). `commented` events are left
 * out, since the comment itself is in the list; a worker's heartbeats are noise.
 */
export function activityOf(detail: Pick<TaskDetail, 'comments' | 'events'>): ActivityItem[] {
  const items: ActivityItem[] = [
    ...detail.comments.map((comment): ActivityItem => ({ kind: 'comment', key: `c${comment.id}`, at: comment.createdAt, comment })),
    ...detail.events.filter((event) => event.kind !== 'commented' && event.kind !== 'heartbeat').map((event): ActivityItem => ({ kind: 'event', key: `e${event.id}`, at: event.createdAt, event, text: eventText(event) })),
  ];
  // Events first at the same second: a comment answers what happened before it.
  return items.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'event' ? -1 : 1) || a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/** A run as the Runs tab lists it. */
export interface RunRow {
  id: number;
  profile: string | null;
  status: string;
  outcomeLabel: string;
  /** Seconds, from start to end (or to `now` while it runs). */
  durationSeconds: number;
  running: boolean;
  /** US dollars, when the worker reported a cost in the run's metadata; Hermes keeps no cost of its own. */
  costUsd: number | null;
  summary: string | null;
  error: string | null;
  startedAt: number;
}

const OUTCOMES: Record<string, string> = {
  completed: 'Completed',
  blocked: 'Blocked',
  crashed: 'Crashed',
  timed_out: 'Timed out',
  spawn_failed: 'Could not start',
  review_requested: 'Sent for review',
  reclaimed: 'Reclaimed',
};

/** How a run ended, in words; a run that has not ended is Running. */
export function outcomeText(run: Pick<TaskRun, 'outcome'>): string {
  return run.outcome === null ? 'Running' : (OUTCOMES[run.outcome] ?? run.outcome.replaceAll('_', ' '));
}

/** The cost a worker put in a run's metadata (`cost_usd`, or `cost` as a number), or `null`. */
export function runCost(metadata: Record<string, unknown> | null): number | null {
  const cost = metadata?.cost_usd ?? metadata?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

/** Every run of the task, newest first, as rows. `nowSeconds` ends a run that is still going. */
export function runRows(runs: readonly TaskRun[], nowSeconds: number): RunRow[] {
  return [...runs]
    .sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)
    .map((run) => ({
      id: run.id,
      profile: run.profile,
      status: run.status,
      outcomeLabel: outcomeText(run),
      durationSeconds: Math.max(0, (run.endedAt ?? nowSeconds) - run.startedAt),
      running: run.endedAt === null,
      costUsd: runCost(run.metadata),
      summary: run.summary,
      error: run.error,
      startedAt: run.startedAt,
    }));
}

export type TaskActionId = 'run-now' | 'terminate' | 'retry' | 'specify' | 'decompose' | 'estimate' | 'reassign' | 'reclaim';

const FAILED_OUTCOMES = ['crashed', 'timed_out', 'spawn_failed'];

/** The actions that make sense for the task as it stands; Hermes still decides, and says why when it refuses. */
export function availableActions(task: TaskFull, runs: readonly TaskRun[]): TaskActionId[] {
  if (task.status === 'archived') return [];
  const latest = [...runs].sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)[0];
  const actions: TaskActionId[] = [];
  if (task.status === 'ready' || task.status === 'todo') actions.push('run-now');
  const failedAgain = (task.status === 'todo' || task.status === 'done') && latest !== undefined && latest.outcome !== null && FAILED_OUTCOMES.includes(latest.outcome);
  if (task.status === 'blocked' || task.status === 'scheduled' || task.status === 'review' || failedAgain) actions.push('retry');
  if (task.status === 'running') actions.push('terminate', 'reclaim');
  if (task.status === 'triage') actions.push('specify', 'decompose');
  actions.push('reassign', 'estimate');
  return actions;
}
