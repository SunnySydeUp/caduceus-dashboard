// What Work › Board changes in Hermes's Kanban, free of the DOM and of React: the requests (as data, so a server test sends the very same ones
// to the real Hermes through Caduceus), which moves Hermes accepts, and the change that undoes each one. `board-actions.ts` adds the dialogs
// and the toasts. Nothing here is kept: the board is whatever Hermes says it is (D1).
import { READ_ONLY_MESSAGE } from '../../tiered-fetch.ts';
import { UNASSIGNED, type BoardStatus, type BoardTask, type LaneGrouping } from './board-model.ts';
import { board as boardQuery, type Plain } from './task-requests.ts';

const KANBAN = '/api/plugins/kanban';

/** A column a card can be moved to: Hermes's statuses except `running` (only the dispatcher claims a task), and `archived`, which takes it off the board. */
export type MoveTarget = Exclude<BoardStatus, 'running'> | 'archived';

/**
 * Where Hermes lets a task go from each status through `PATCH /tasks/{id}` (v0.21.4; a test moves a real task along every one of these and
 * along every one that is not listed). Moving to Ready or Todo from Blocked, Scheduled or Review goes through Hermes's own unblock and
 * reopen paths. `done` is only reachable from Ready, Blocked and Review, and needs evidence of completion, which `cardChangeRequest` supplies. A running task is not moved: it is reclaimed.
 */
export const MOVES: Readonly<Record<Exclude<BoardStatus, 'running'> | 'archived', readonly MoveTarget[]>> = {
  triage: ['todo', 'ready', 'archived'],
  todo: ['triage', 'scheduled', 'ready', 'archived'],
  scheduled: ['triage', 'todo', 'ready', 'archived'],
  ready: ['triage', 'todo', 'scheduled', 'blocked', 'review', 'done', 'archived'],
  blocked: ['triage', 'todo', 'scheduled', 'ready', 'done', 'archived'],
  review: ['triage', 'ready', 'done', 'archived'],
  done: ['triage', 'todo', 'ready', 'archived'],
  archived: ['triage', 'todo', 'ready'],
};

/** The columns `task` can be moved to (none while a worker has it). */
export function moveTargets(task: Pick<BoardTask, 'status'>): readonly MoveTarget[] {
  return task.status === 'running' ? [] : MOVES[task.status];
}

/** What the owner can change about a card from its sheets. */
export type CardChange =
  | { kind: 'move'; to: MoveTarget; /** Why it is blocked, or how it was finished (becomes the run's summary): both optional. */ note?: string }
  | { kind: 'assign'; /** The profile, or `null` for nobody. */ to: string | null }
  | { kind: 'priority'; to: number };

/** The words that stand for a task closed by hand, when its closer gave none: Hermes will not complete a task with no evidence. */
export const CLOSED_BY_HAND = 'Marked done by the owner from Caduceus.';

/** The fields of a task patch for one change; the same for `PATCH /tasks/{id}` and `POST /tasks/bulk`. */
export function changeFields(change: CardChange): Record<string, unknown> {
  if (change.kind === 'assign') return { assignee: change.to ?? '' };
  if (change.kind === 'priority') return { priority: change.to };
  if (change.to === 'archived') return { status: 'archived' };
  if (change.to === 'done') {
    const evidence = change.note?.trim() || CLOSED_BY_HAND;
    return { status: 'done', result: evidence, summary: evidence };
  }
  const reason = change.note?.trim();
  return change.to === 'blocked' && reason ? { status: 'blocked', block_reason: reason } : { status: change.to };
}

/** `PATCH /tasks/{id}`: T0 in the policy map. */
export const cardChangeRequest = (taskId: string, change: CardChange, slug?: string): Plain => ({
  method: 'PATCH',
  path: `${KANBAN}/tasks/${encodeURIComponent(taskId)}${boardQuery(slug)}`,
  body: changeFields(change),
});

/**
 * The change that puts back what `task` showed before `change` was made, or `undefined` when Hermes cannot: a card that was running cannot
 * be sent back to running, and a task that was done and then archived cannot come back as done.
 */
export function undoOf(task: BoardTask, change: CardChange): CardChange | undefined {
  if (change.kind === 'assign') return { kind: 'assign', to: task.assignee };
  if (change.kind === 'priority') return { kind: 'priority', to: task.priority };
  if (task.status === 'running') return undefined;
  return MOVES[change.to === 'archived' ? 'archived' : change.to].includes(task.status) ? { kind: 'move', to: task.status } : undefined;
}

/** `POST /tasks/bulk`: the same change for every id, T2 in the policy map. Archiving is its own flag there, not a status. */
export const bulkRequest = (ids: readonly string[], change: CardChange, slug?: string): Plain => {
  const { status, ...fields } = changeFields(change);
  return { method: 'POST', path: `${KANBAN}/tasks/bulk${boardQuery(slug)}`, body: { ids, ...(status === 'archived' ? { archive: true } : status === undefined ? {} : { status }), ...fields } };
};

/** What came of one task in a bulk change. */
export interface BulkResult {
  id: string;
  ok: boolean;
  /** Hermes's reason, when it refused. */
  error?: string;
}

/** Reads `POST /tasks/bulk`'s answer, in the order of the ids that were sent; a task the answer does not mention counts as failed. */
export function readBulk(body: unknown, ids: readonly string[]): BulkResult[] {
  const listed = typeof body === 'object' && body !== null && 'results' in body && Array.isArray(body.results) ? body.results : [];
  const byId = new Map<string, BulkResult>();
  for (const row of listed) {
    if (typeof row !== 'object' || row === null || !('id' in row) || typeof row.id !== 'string') continue;
    const error = 'error' in row && typeof row.error === 'string' ? row.error : undefined;
    byId.set(row.id, { id: row.id, ok: 'ok' in row && row.ok === true, ...(error === undefined ? {} : { error }) });
  }
  return ids.map((id) => byId.get(id) ?? { id, ok: false, error: 'Hermes did not say' });
}

/** A Hermes board as the switcher lists it. */
export interface BoardSummary {
  slug: string;
  name: string;
  description: string;
  isCurrent: boolean;
  /** Tasks that are not archived. */
  total: number;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

/** Reads `GET /boards`: every board with its name and its count of live tasks, and the slug that is current. */
export function readBoards(body: unknown): { boards: BoardSummary[]; current: string | undefined } {
  const { boards, current } = record(body);
  return {
    current: typeof current === 'string' ? current : undefined,
    boards: (Array.isArray(boards) ? boards : []).flatMap((item): BoardSummary[] => {
      const board = record(item);
      if (typeof board.slug !== 'string') return [];
      return [
        {
          slug: board.slug,
          name: typeof board.name === 'string' && board.name !== '' ? board.name : board.slug,
          description: typeof board.description === 'string' ? board.description : '',
          isCurrent: board.is_current === true,
          total: typeof board.total === 'number' ? board.total : 0,
        },
      ];
    }),
  };
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Why Hermes would refuse `slug` as a board's address (it lowercases and trims first), or `undefined` when it would take it. */
export function boardSlugProblem(slug: string): string | undefined {
  return SLUG.test(slug.trim().toLowerCase()) ? undefined : 'An address is 1 to 64 lowercase letters, digits, hyphens or underscores, and does not start with a hyphen or underscore.';
}

/** The requests that manage boards, as the Kanban plugin takes them. Tiers: create, rename, archive and export T1; switch T0; import T3. */
export const boardRequests = {
  create: (board: { slug: string; name: string; description?: string }, switchTo = false): Plain => ({
    method: 'POST',
    path: `${KANBAN}/boards`,
    body: { slug: board.slug.trim().toLowerCase(), name: board.name.trim(), ...(board.description?.trim() ? { description: board.description.trim() } : {}), switch: switchTo },
  }),
  rename: (slug: string, fields: { name?: string; description?: string }): Plain => ({ method: 'PATCH', path: `${KANBAN}/boards/${encodeURIComponent(slug)}`, body: { ...fields } }),
  switchTo: (slug: string): Plain => ({ method: 'POST', path: `${KANBAN}/boards/${encodeURIComponent(slug)}/switch` }),
  /** Hermes archives the board (it moves out of the list), unless asked to delete it, which this app never does. */
  archive: (slug: string): Plain => ({ method: 'DELETE', path: `${KANBAN}/boards/${encodeURIComponent(slug)}` }),
  /** Writes an archive file in Hermes's own folder for exports, with the attachments and without the worker logs, and answers its path. */
  export: (slug: string): Plain => ({ method: 'POST', path: `${KANBAN}/boards/${encodeURIComponent(slug)}/export`, body: { attachments: true, logs: false } }),
  /** Imports a board archive on the Hermes host as a new board, which this app never makes the current one. T3. */
  importArchive: ({ archive, slug }: { archive: string; slug?: string }): Plain => ({ method: 'POST', path: `${KANBAN}/boards/import`, body: { archive: archive.trim(), ...(slug?.trim() ? { slug: slug.trim() } : {}), switch: false } }),
  /** Puts back an archived board from the export saved just before: the same import, which the policy lowers to T1 for that file under that address. */
  restore: (archive: string, slug: string): Plain => ({ method: 'POST', path: `${KANBAN}/boards/import`, body: { archive, slug } }),
};

/** The path of an export, from `POST /boards/{slug}/export`'s answer. */
export function readExport(body: unknown): string | undefined {
  const { archive } = record(body);
  return typeof archive === 'string' && archive !== '' ? archive : undefined;
}

/** Where the browser downloads a file on the Hermes host from. */
export const downloadPath = (file: string): string => `/api/fs/download?path=${encodeURIComponent(file)}`;

/** The address an imported file suggests for its board: what Hermes's export name starts with, else the file's name, made to fit. */
export function importSlugFor(file: string): string {
  const name = file.split('/').pop()?.replace(/\.(tar\.gz|tgz)$/i, '') ?? '';
  const stripped = name.replace(/-\d{8}-\d{6}$/, '');
  return stripped.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 64);
}

/** `POST /dispatch`: a nudge starts workers (T1); with `dry_run` it only says what it would do (a read). */
export const dispatchRequest = ({ dryRun = false, slug }: { dryRun?: boolean; slug?: string }): Plain => ({
  method: 'POST',
  path: `${KANBAN}/dispatch${boardQuery(slug, dryRun ? { dry_run: 'true' } : {})}`,
});

/** A ready task that would start, and who by. */
export interface WouldStart {
  taskId: string;
  profile: string;
}

/** A task that stays where it is, and why. */
export interface Waiting {
  taskId: string;
  why: string;
}

/** What a dispatch said it would do (or did). */
export interface DispatchReport {
  wouldStart: WouldStart[];
  waiting: Waiting[];
  /** What Hermes did or found besides spawning: released claims, promoted tasks, memory pressure. In words. */
  notes: string[];
}

const RESPAWN_REASONS: Record<string, string> = {
  blocker_auth: 'Its last run stopped on a quota or sign-in error, so Hermes holds it back.',
  recent_success: 'A run of it finished in the last hour, so Hermes does not start another.',
  active_pr: 'A pull request for it was posted in the last day, so Hermes does not start another run.',
};

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const rows = (value: unknown): unknown[][] => (Array.isArray(value) ? value.filter(Array.isArray) : []);
const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * Reads `POST /dispatch`'s answer (Hermes's `DispatchResult`). `ready` are the ready tasks the page shows: one that Hermes says nothing about
 * is waiting for a free worker, since the limits stop a tick before it reaches the task.
 */
export function readDispatch(body: unknown, ready: readonly string[]): DispatchReport {
  const result = record(body);
  const wouldStart = rows(result.spawned).flatMap(([taskId, profile]): WouldStart[] => (typeof taskId === 'string' ? [{ taskId, profile: typeof profile === 'string' ? profile : '' }] : []));
  const waiting: Waiting[] = [
    ...ids(result.skipped_unassigned).map((taskId) => ({ taskId, why: 'Nobody is assigned, and Hermes has no default profile to give it to.' })),
    ...ids(result.skipped_nonspawnable).map((taskId) => ({ taskId, why: 'Its assignee is not a Hermes profile, so no worker can start it.' })),
    ...rows(result.skipped_per_profile_capped).flatMap(([taskId, profile, running]): Waiting[] =>
      typeof taskId === 'string' ? [{ taskId, why: `${String(profile)} already has ${typeof running === 'number' ? counted(running, 'worker') : 'workers'} running, which is its limit.` }] : [],
    ),
    ...rows(result.respawn_guarded).flatMap(([taskId, reason]): Waiting[] => (typeof taskId === 'string' ? [{ taskId, why: RESPAWN_REASONS[String(reason)] ?? 'Hermes’s guard against starting it again holds it back.' }] : [])),
  ];
  const spoken = new Set([...wouldStart.map((item) => item.taskId), ...waiting.map((item) => item.taskId)]);
  for (const taskId of ready) if (!spoken.has(taskId)) waiting.push({ taskId, why: 'No worker slot is free: the limits on how many workers run at once are reached.' });

  const notes: string[] = [];
  const count = (key: string) => (typeof result[key] === 'number' ? result[key] : ids(result[key]).length);
  if (count('reclaimed') > 0) notes.push(`${counted(count('reclaimed'), 'task')} had an expired claim released.`);
  if (count('promoted') > 0) notes.push(`${counted(count('promoted'), 'task')} moved from Todo to Ready, their parents being done.`);
  for (const [key, text] of [['crashed', 'lost its worker'], ['timed_out', 'ran past its time limit'], ['stale', 'had no heartbeat for too long'], ['auto_blocked', 'was blocked after repeated failures']] as const) {
    if (count(key) > 0) notes.push(`${counted(count(key), 'task')} ${text}.`);
  }
  if (result.memory_pressure === 'critical') notes.push('The Mac is short of memory, so no worker starts now.');
  else if (result.memory_pressure === 'elevated') notes.push('The Mac is low on memory, so at most one worker starts now.');
  if (result.skipped_locked === true) notes.push('Another dispatcher holds this board’s lock right now, so this pass did nothing.');
  return { wouldStart, waiting, notes };
}

/** The dispatcher's limits and orchestration settings, as Hermes holds them. */
export interface DispatcherSettings {
  /** The most workers running at once on this Mac, across boards; `null` while the owner has set none (Hermes then derives one from memory, or sets none). */
  maxInProgress: number | null;
  /** The most workers of one profile at once; `null` for no limit. */
  maxInProgressPerProfile: number | null;
  /** Seconds between ticks. */
  intervalSeconds: number;
  /** A running task with no heartbeat for this long is reclaimed; 0 switches it off. */
  staleTimeoutSeconds: number;
  /** Consecutive failed attempts before a task is blocked. */
  failureLimit: number;
  /** Whether Hermes's gateway runs the dispatcher. */
  dispatchInGateway: boolean;
  autoDecompose: boolean;
  autoPromoteChildren: boolean;
  /** The profile for the root task after a decomposition; empty for Hermes's choice. */
  orchestratorProfile: string;
  defaultAssignee: string;
  /** The profiles those two settings come to in effect. */
  effectiveOrchestrator: string;
  effectiveDefaultAssignee: string;
}

const cap = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null);
const whole = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const word = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Reads `GET /api/config`'s `kanban` section together with `GET /orchestration`, which adds the profiles Hermes resolves the two profile settings to. */
export function readSettings(config: unknown, orchestration: unknown): DispatcherSettings {
  const kanban = record(record(config).kanban);
  const orchestrate = record(orchestration);
  return {
    maxInProgress: cap(kanban.max_in_progress),
    maxInProgressPerProfile: cap(kanban.max_in_progress_per_profile),
    intervalSeconds: whole(kanban.dispatch_interval_seconds, 60),
    staleTimeoutSeconds: whole(kanban.dispatch_stale_timeout_seconds, 14400),
    failureLimit: whole(kanban.failure_limit, 2),
    dispatchInGateway: flag(kanban.dispatch_in_gateway, true),
    autoDecompose: flag(orchestrate.auto_decompose, flag(kanban.auto_decompose, true)),
    autoPromoteChildren: flag(orchestrate.auto_promote_children, true),
    orchestratorProfile: word(orchestrate.orchestrator_profile) || word(kanban.orchestrator_profile),
    defaultAssignee: word(orchestrate.default_assignee) || word(kanban.default_assignee),
    effectiveOrchestrator: word(orchestrate.resolved_orchestrator_profile),
    effectiveDefaultAssignee: word(orchestrate.resolved_default_assignee),
  };
}

/** A change to the settings: only the keys given are written. */
export type SettingsChange = Partial<Pick<DispatcherSettings, 'maxInProgress' | 'maxInProgressPerProfile' | 'intervalSeconds' | 'staleTimeoutSeconds' | 'failureLimit' | 'autoDecompose' | 'autoPromoteChildren' | 'orchestratorProfile' | 'defaultAssignee'>>;

const SETTING_KEYS: Record<keyof SettingsChange, string> = {
  maxInProgress: 'max_in_progress',
  maxInProgressPerProfile: 'max_in_progress_per_profile',
  intervalSeconds: 'dispatch_interval_seconds',
  staleTimeoutSeconds: 'dispatch_stale_timeout_seconds',
  failureLimit: 'failure_limit',
  autoDecompose: 'auto_decompose',
  autoPromoteChildren: 'auto_promote_children',
  orchestratorProfile: 'orchestrator_profile',
  defaultAssignee: 'default_assignee',
};

/** `PUT /api/config` with only the `kanban` keys given: Hermes merges them into its config. A T2, which the policy allows only for these keys. */
export const settingsRequest = (change: SettingsChange): Plain => ({
  method: 'PUT',
  path: '/api/config',
  body: { config: { kanban: Object.fromEntries(Object.entries(change).map(([key, value]) => [SETTING_KEYS[key as keyof SettingsChange], value])) } },
});

/** One distress signal Hermes found on a task (its diagnostics rules). */
export interface Problem {
  kind: string;
  severity: 'warning' | 'error' | 'critical';
  title: string;
  detail: string;
}

/** A task with signals, worst first. */
export interface ProblemTask {
  taskId: string;
  title: string;
  status: string;
  assignee: string | null;
  problems: Problem[];
  /** Hermes offers a Reclaim for it. */
  canReclaim: boolean;
}

/** A worker running now: an open run with a process. */
export interface ActiveWorker {
  runId: number;
  taskId: string;
  title: string;
  profile: string | null;
  /** Seconds since the epoch. */
  startedAt: number | null;
  lastHeartbeatAt: number | null;
}

/** What the board's side panel shows, all from Hermes. */
export interface BoardSide {
  byStatus: Record<string, number>;
  byAssignee: { name: string; counts: Record<string, number>; total: number }[];
  /** How long the oldest Ready task has waited, in seconds. */
  oldestReadySeconds: number | null;
  problemCount: number;
  problems: ProblemTask[];
  workers: ActiveWorker[];
}

const SEVERITIES = ['warning', 'error', 'critical'] as const;
const severityOf = (value: unknown): Problem['severity'] => SEVERITIES.find((severity) => severity === value) ?? 'warning';
const countsOf = (value: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(record(value)).flatMap(([status, n]): [string, number][] => (typeof n === 'number' ? [[status, n]] : [])));
const textOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const time = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Reads the three answers the side panel is made of (`/stats`, `/diagnostics`, `/workers/active`); one Hermes did not give is empty. */
export function readSide({ stats, diagnostics, workers }: { stats?: unknown; diagnostics?: unknown; workers?: unknown }): BoardSide {
  const { by_status, by_assignee, oldest_ready_age_seconds } = record(stats);
  const problems = (Array.isArray(record(diagnostics).diagnostics) ? (record(diagnostics).diagnostics as unknown[]) : []).flatMap((item): ProblemTask[] => {
    const row = record(item);
    if (typeof row.task_id !== 'string') return [];
    const found = (Array.isArray(row.diagnostics) ? row.diagnostics : []).map(record);
    return [
      {
        taskId: row.task_id,
        title: textOf(row.task_title) ?? row.task_id,
        status: textOf(row.task_status) ?? '',
        assignee: textOf(row.task_assignee),
        canReclaim: found.some((diagnostic) => (Array.isArray(diagnostic.actions) ? diagnostic.actions : []).some((action) => record(action).kind === 'reclaim')),
        problems: found.map((diagnostic) => ({ kind: textOf(diagnostic.kind) ?? 'problem', severity: severityOf(diagnostic.severity), title: textOf(diagnostic.title) ?? 'A problem', detail: textOf(diagnostic.detail) ?? '' })),
      },
    ];
  });
  const active = Array.isArray(record(workers).workers) ? (record(workers).workers as unknown[]) : [];
  return {
    byStatus: countsOf(by_status),
    byAssignee: Object.entries(record(by_assignee))
      .map(([name, counts]) => ({ name, counts: countsOf(counts), total: Object.values(countsOf(counts)).reduce((sum, n) => sum + n, 0) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    oldestReadySeconds: time(oldest_ready_age_seconds),
    problemCount: problems.reduce((sum, task) => sum + task.problems.length, 0),
    problems,
    workers: active.flatMap((item): ActiveWorker[] => {
      const row = record(item);
      if (typeof row.run_id !== 'number' || typeof row.task_id !== 'string') return [];
      return [{ runId: row.run_id, taskId: row.task_id, title: textOf(row.task_title) ?? row.task_id, profile: textOf(row.profile) ?? textOf(row.task_assignee), startedAt: time(row.started_at), lastHeartbeatAt: time(row.last_heartbeat_at) }];
    }),
  };
}

/** The priorities the Priority… sheet lists, lowest first; any whole number is allowed besides (Hermes runs higher numbers first). */
export const PRIORITY_CHOICES: readonly { value: number; label: string }[] = [
  { value: -5, label: 'Lowest' },
  { value: -1, label: 'Low' },
  { value: 0, label: 'Normal' },
  { value: 1, label: 'High' },
  { value: 5, label: 'Higher' },
  { value: 10, label: 'Highest' },
];

/** One entry of a card's menu: the ⋮ button and a long press on a phone open the same list. */
export interface MenuEntry {
  id: 'move' | 'assign' | 'priority' | 'reclaim' | 'select' | 'open';
  label: string;
  /** It changes Hermes: switched off in read-only mode. */
  writes: boolean;
  /** Why it is switched off, in words; absent when it works. */
  disabled?: string;
}

const HELD = 'A worker has it. Reclaim it first, which stops the worker and returns the task to Ready.';

/** A card's menu, in order. Read-only mode and a running worker switch entries off with their reason (the entries stay, so nobody wonders where they went). */
export function cardMenu(task: Pick<BoardTask, 'status'>, { readOnly }: { readOnly: boolean }): MenuEntry[] {
  const running = task.status === 'running';
  const entry = (id: MenuEntry['id'], label: string, writes: boolean, held?: string): MenuEntry => {
    const disabled = writes && readOnly ? READ_ONLY_MESSAGE : held;
    return { id, label, writes, ...(disabled === undefined ? {} : { disabled }) };
  };
  return [
    entry('move', 'Move to…', true, running ? HELD : undefined),
    entry('assign', 'Assign…', true, running ? HELD : undefined),
    entry('priority', 'Priority…', true),
    ...(running ? [entry('reclaim', 'Reclaim', true)] : []),
    entry('select', 'Select', false),
    entry('open', 'Open task', false),
  ];
}

/**
 * What dropping `task` on a lane does: by status it moves the card there, by profile it hands the card to that profile (`UNASSIGNED` for
 * nobody). `undefined` when it would change nothing, or Hermes would refuse (a running card, a column the card cannot reach).
 */
export function dropChange(task: BoardTask, grouping: LaneGrouping, lane: string): CardChange | undefined {
  if (task.status === 'running') return undefined;
  if (grouping === 'profile') {
    const to = lane === UNASSIGNED ? null : lane;
    return to === task.assignee ? undefined : { kind: 'assign', to };
  }
  const target = (Object.keys(MOVES) as MoveTarget[]).find((status) => status === lane);
  return target !== undefined && MOVES[task.status].includes(target) ? { kind: 'move', to: target } : undefined;
}

/** What the toolbar says of the dispatcher. */
export interface DispatcherMode {
  state: 'auto' | 'manual' | 'stopped';
  label: string;
  detail: string;
  /** The limits on workers, in a sentence. */
  limits: string;
}

const every = (seconds: number) => (seconds % 60 === 0 && seconds >= 120 ? `${seconds / 60} minutes` : `${seconds} seconds`);

/** The dispatcher's mode from Hermes's settings and whether its gateway runs: the gateway is what ticks it, so without one only a nudge dispatches. */
export function dispatcherMode(settings: DispatcherSettings, gatewayRunning: boolean): DispatcherMode {
  const { maxInProgress: all, maxInProgressPerProfile: each } = settings;
  const limits =
    all === null && each === null
      ? 'No limit of your own on workers running at once.'
      : all === null
        ? `Up to ${counted(each!, 'worker')} for each profile at once.`
        : `Up to ${counted(all, 'worker')} at once${each === null ? '' : `, ${each} for each profile`}.`;
  if (!gatewayRunning) return { state: 'stopped', label: 'Stopped', detail: 'The dispatcher runs inside the Hermes gateway, which is not running. Ready tasks wait until it is, or until you nudge.', limits };
  if (!settings.dispatchInGateway) return { state: 'manual', label: 'Manual', detail: 'Hermes does not dispatch by itself (its gateway is set not to). Ready tasks start when you nudge.', limits };
  return { state: 'auto', label: 'Automatic', detail: `Hermes looks for ready tasks every ${every(settings.intervalSeconds)} and starts a worker for each.`, limits };
}

const capWords = (value: number | null) => (value === null ? 'no limit' : String(value));

/** What a settings change comes to, from what Hermes holds now: the sentence the confirmation shows. */
export function settingsSummary(before: DispatcherSettings, change: SettingsChange): string {
  const parts: string[] = [];
  if (change.maxInProgress !== undefined) parts.push(`Workers at once: ${capWords(before.maxInProgress)} → ${capWords(change.maxInProgress)}.`);
  if (change.maxInProgressPerProfile !== undefined) parts.push(`Workers per profile: ${capWords(before.maxInProgressPerProfile)} → ${capWords(change.maxInProgressPerProfile)}.`);
  if (change.staleTimeoutSeconds !== undefined) parts.push(`Reclaim a silent worker after: ${before.staleTimeoutSeconds === 0 ? 'never' : `${Math.round(before.staleTimeoutSeconds / 60)} min`} → ${change.staleTimeoutSeconds === 0 ? 'never' : `${Math.round(change.staleTimeoutSeconds / 60)} min`}.`);
  if (change.failureLimit !== undefined) parts.push(`Blocks a task after ${before.failureLimit} → ${change.failureLimit} failed attempts.`);
  if (change.intervalSeconds !== undefined) parts.push(`Looks every ${before.intervalSeconds} → ${change.intervalSeconds} seconds.`);
  if (change.autoDecompose !== undefined) parts.push(`Splits Triage tasks by itself: ${before.autoDecompose ? 'on' : 'off'} → ${change.autoDecompose ? 'on' : 'off'}.`);
  if (change.autoPromoteChildren !== undefined) parts.push(`Promotes finished tasks’ children by itself: ${before.autoPromoteChildren ? 'on' : 'off'} → ${change.autoPromoteChildren ? 'on' : 'off'}.`);
  if (change.orchestratorProfile !== undefined) parts.push(`Orchestrator profile: ${before.orchestratorProfile || 'Hermes’s choice'} → ${change.orchestratorProfile || 'Hermes’s choice'}.`);
  if (change.defaultAssignee !== undefined) parts.push(`Profile for tasks nobody has: ${before.defaultAssignee || 'none'} → ${change.defaultAssignee || 'none'}.`);
  return parts.join(' ');
}

/** The address a board's name suggests: lowercase letters, digits and hyphens. */
export function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
