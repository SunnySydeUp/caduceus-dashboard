// What the Brief editor knows about a task, free of the DOM and of React (work model §2.1): the fields it edits, what is wrong with them,
// the requests that create or change the task in Hermes for each dispatch mode (so the policy can be asked about them and a test can send
// them), and how a task Hermes holds reads back into the editor. Nothing is kept: the task in Hermes is the truth.
import { isRecord } from '@caduceus/contracts/policy/guards';
import { parseBrief, serialiseBrief, type BriefText } from './brief.ts';
import type { TaskFields, TaskWorkspace } from './create-task-script.ts';
import type { TaskFull } from './task-model.ts';
import type { Plain } from './task-requests.ts';

export type DispatchMode = 'draft' | 'queue' | 'run-now' | 'schedule';

export const DISPATCH_MODES: readonly { id: DispatchMode; label: string; detail: string }[] = [
  { id: 'draft', label: 'Save draft', detail: 'Keep it on the board without running it: in Triage, to be specified, or in Todo.' },
  { id: 'queue', label: 'Queue', detail: 'Make it Ready. The dispatcher starts a worker when its limits allow.' },
  { id: 'run-now', label: 'Run now', detail: 'Make it Ready and nudge the dispatcher, so a worker starts at once.' },
  { id: 'schedule', label: 'Schedule', detail: 'Put a new task on the board once, or on a timer, with a Create-task job.' },
];

/** Where a saved draft waits: Triage (a specifier writes the brief) or Todo (the owner decides when it is Ready). */
export type DraftKind = 'triage' | 'todo';

/** The reasoning efforts Hermes accepts on a task (`none` turns thinking off); empty is the profile's own level. */
export const TASK_REASONING = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

/** Everything the editor edits about one task. An empty string (or no number) is "not set": Hermes then uses its default. */
export interface BriefFields {
  title: string;
  brief: BriefText;
  /** The profile that works the task. */
  assignee: string;
  /** The model the worker is pinned to, and the provider it belongs to. */
  model: string;
  provider: string;
  reasoningEffort: string;
  skills: string[];
  workspace: TaskWorkspace;
  /** A Hermes project (id or slug); it anchors a worktree under the project's repository. */
  project: string;
  priority?: number;
  /** `300`, `90s`, `30m`, `2h` or `1d`. */
  maxRuntime: string;
  maxRetries?: number;
  goalMode: boolean;
  goalMaxTurns?: number;
  /** `local-only`, `OWNER/REPO` or the exact URL of a GitHub pull request; empty is Hermes's default (`local-only`). */
  completionContract: string;
  /** Tasks that must be done before this one can run. */
  parents: string[];
}

export function newBriefFields(): BriefFields {
  return {
    title: '',
    brief: { kind: 'sections', sections: { goal: '', context: '', references: '', constraints: '', expected: '', scope: '' } },
    assignee: '',
    model: '',
    provider: '',
    reasoningEffort: '',
    skills: [],
    workspace: { kind: 'scratch' },
    project: '',
    maxRuntime: '',
    goalMode: false,
    completionContract: '',
    parents: [],
  };
}

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
const RUNTIME = /^(\d+)([smhd])?$/;

/** Seconds in `300`, `90s`, `30m`, `2h` or `1d`; undefined for anything else, and for none. */
export function durationSeconds(text: string): number | undefined {
  const match = RUNTIME.exec(text.trim());
  if (!match) return undefined;
  const seconds = Number(match[1]) * UNITS[match[2] ?? 's'];
  return seconds >= 1 ? seconds : undefined;
}

/** The shortest exact way to write a number of seconds: `7200` is `2h`, `90` is `90s`. */
export function durationText(seconds: number): string {
  for (const unit of ['d', 'h', 'm'] as const) if (seconds % UNITS[unit] === 0) return `${seconds / UNITS[unit]}${unit}`;
  return `${seconds}s`;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PULL_REQUEST = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;
const BRANCH = /^(?![-/])(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}(?<![/.])$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SKILL = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/;

/** Problems by the field they belong to. An empty answer means Hermes can be sent the fields. */
export type BriefErrors = Record<string, string>;

export interface BriefContext {
  mode: DispatchMode;
  /** The names of Hermes's profiles. */
  profiles: readonly string[];
  /** Editing a task that exists: the fields Hermes cannot change after creation are not checked. */
  editing?: boolean;
}

const wholeNumber = (value: number | undefined, min: number) => value === undefined || (Number.isInteger(value) && value >= min);

/** What is wrong with the fields for this dispatch mode, by field name (`title`, `assignee`, `workspace`, `branch`, `maxRuntime`…). */
export function briefProblems(fields: BriefFields, { mode, profiles, editing = false }: BriefContext): BriefErrors {
  const problems: BriefErrors = {};
  if (fields.title.trim() === '') problems.title = 'Give the task a title.';
  else if (/[\r\n]/.test(fields.title)) problems.title = 'A title is one line.';
  if (fields.assignee !== '' && !profiles.includes(fields.assignee)) problems.assignee = `There is no profile called “${fields.assignee}”.`;
  else if (mode === 'run-now' && fields.assignee === '') problems.assignee = 'Choose the profile that runs it: a task nobody has cannot start.';
  if (fields.priority !== undefined && !Number.isInteger(fields.priority)) problems.priority = 'Priority is a whole number.';
  if (fields.provider !== '' && fields.model === '') problems.model = 'A provider needs a model.';
  if (fields.reasoningEffort !== '' && !TASK_REASONING.some((level) => level === fields.reasoningEffort)) problems.reasoningEffort = `Choose one of ${TASK_REASONING.join(', ')}.`;
  if (editing) return problems;
  if (fields.maxRuntime.trim() !== '' && durationSeconds(fields.maxRuntime) === undefined) problems.maxRuntime = 'Use seconds (300) or a duration such as 90s, 30m, 2h or 1d.';
  if (!wholeNumber(fields.maxRetries, 1)) problems.maxRetries = 'Retries is a whole number from 1.';
  if (!wholeNumber(fields.goalMaxTurns, 1)) problems.goalMaxTurns = 'Turns is a whole number from 1.';
  const contract = fields.completionContract.trim();
  if (contract !== '' && contract !== 'local-only' && !REPO.test(contract) && !PULL_REQUEST.test(contract)) problems.completionContract = 'Use local-only, OWNER/REPO, or the exact URL of a pull request on github.com.';
  const workspace = fields.workspace;
  const path = workspace.kind === 'scratch' ? undefined : workspace.path;
  if (workspace.kind === 'dir' && (path === undefined || path.trim() === '')) problems.workspace = 'Choose the folder, or give it as a full path.';
  else if (path !== undefined && path !== '' && !/^[/~]/.test(path)) problems.workspace = 'Give the folder as a full path, such as /Users/you/project.';
  if (workspace.kind === 'worktree' && workspace.branch !== undefined && workspace.branch !== '' && !BRANCH.test(workspace.branch)) problems.branch = 'A branch name has letters, digits and . _ - / only, and does not start with - or /.';
  if (fields.project !== '' && !NAME.test(fields.project)) problems.project = 'A project is named by its id or slug.';
  if (fields.project !== '' && workspace.kind !== 'worktree') problems.project = 'A project anchors a git worktree: choose the worktree workspace for it.';
  if (fields.skills.some((skill) => !SKILL.test(skill))) problems.skills = 'A skill is named with letters, digits and . _ - / only.';
  if (fields.parents.some((parent) => !NAME.test(parent))) problems.parents = 'A task is named by its id, such as t_1a2b3c4d.';
  return problems;
}

/** Whether the fields use something only `hermes kanban create` can set: a worktree's branch, a retry limit or a completion contract. */
export function needsCli(fields: BriefFields): boolean {
  return (fields.workspace.kind === 'worktree' && fields.workspace.branch !== undefined && fields.workspace.branch !== '') || fields.maxRetries !== undefined || fields.completionContract.trim() !== '';
}

const boardQuery = (board: string | undefined, extra: Record<string, string> = {}) => {
  const query = new URLSearchParams(extra);
  if (board) query.set('board', board);
  const text = query.toString();
  return text ? `?${text}` : '';
};

/** The body both ways of creating a task take (the Kanban plugin's `POST /tasks`, and Caduceus's `POST /_caduceus/api/work/tasks`): only what is set. */
function taskBody(fields: BriefFields, triage: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { title: fields.title.trim() };
  const text = serialiseBrief(fields.brief);
  if (text.trim() !== '') body.body = text;
  if (fields.assignee !== '') body.assignee = fields.assignee;
  if (fields.priority !== undefined && fields.priority !== 0) body.priority = fields.priority;
  const workspace = fields.workspace;
  body.workspace_kind = workspace.kind;
  if (workspace.kind !== 'scratch' && workspace.path !== undefined && workspace.path.trim() !== '') body.workspace_path = workspace.path.trim();
  if (workspace.kind === 'worktree' && workspace.branch !== undefined && workspace.branch !== '') body.branch_name = workspace.branch;
  if (fields.project !== '') body.project_id = fields.project;
  if (fields.parents.length > 0) body.parents = fields.parents;
  if (triage) body.triage = true;
  const seconds = durationSeconds(fields.maxRuntime);
  if (seconds !== undefined) body.max_runtime_seconds = seconds;
  if (fields.skills.length > 0) body.skills = fields.skills;
  if (fields.maxRetries !== undefined) body.max_retries = fields.maxRetries;
  if (fields.goalMode) {
    body.goal_mode = true;
    if (fields.goalMaxTurns !== undefined) body.goal_max_turns = fields.goalMaxTurns;
  }
  if (fields.model !== '') {
    body.model_override = fields.model;
    if (fields.provider !== '') body.provider_override = fields.provider;
  }
  if (fields.completionContract.trim() !== '') body.completion_contract = fields.completionContract.trim();
  return body;
}

const KANBAN = '/api/plugins/kanban';

/** The words of the one confirmation a create asks for; the steps after it ride on it. */
export interface PlanConfirmation {
  title: string;
  text: string;
  /** What the dialog names as the thing that changes: the task's title. */
  object: string;
  confirmLabel: string;
}

/** What saving a new task asks of Hermes: the create, then each step that follows it (with the new task's id). */
export interface CreatePlan {
  /** The Kanban plugin's `POST /tasks`, or Caduceus's `hermes kanban create` route for the fields the plugin cannot set. */
  via: 'rest' | 'cli';
  create: Plain;
  after: ((taskId: string) => Plain)[];
  confirm: PlanConfirmation;
}

export interface CreateOptions {
  /** Where a draft waits. */
  draft?: DraftKind;
  /** The board's slug; the current board when empty. */
  board?: string;
  /** The tab's profile, which scopes the CLI command; `default` or none leaves it unscoped. */
  profile?: string;
}

const CONFIRMATIONS: Record<Exclude<DispatchMode, 'schedule'>, (title: string, draft: DraftKind, assignee: string) => PlanConfirmation> = {
  draft: (title, draft) => ({
    title: `Save “${title}” as a draft?`,
    text: draft === 'triage' ? 'It goes to Triage and nothing runs. A model can write its brief later (Specify).' : 'It goes to Todo and nothing runs until you make it Ready.',
    object: title,
    confirmLabel: 'Save draft',
  }),
  queue: (title, _draft, assignee) => ({
    title: `Queue “${title}”?`,
    text: assignee
      ? `It goes to Ready. The dispatcher gives it to a worker of ${assignee} when its limits allow; that uses the model.`
      : 'It goes to Ready. Nobody is assigned, so it waits in Ready until you assign a profile; then the dispatcher gives it to a worker.',
    object: title,
    confirmLabel: 'Queue',
  }),
  'run-now': (title) => ({ title: `Run “${title}” now?`, text: 'It goes to Ready and the dispatcher is told to start a worker at once. That uses the model, and other tasks that are ready may start with it.', object: title, confirmLabel: 'Run now' }),
};

/** The requests that save `fields` as a new task in one of the three modes that make a task now. A schedule makes a job instead (`scheduledFields`). */
export function createPlan(fields: BriefFields, mode: Exclude<DispatchMode, 'schedule'>, { draft = 'triage', board, profile }: CreateOptions = {}): CreatePlan {
  const cli = needsCli(fields);
  // A draft is made in Triage (`triage: true`), where nothing can claim it, and moved to Todo afterwards when that is the draft wanted.
  const parked = mode === 'draft';
  const body = taskBody(fields, parked);
  const scope: Record<string, string> = profile && profile !== 'default' ? { profile } : {};
  const after: CreatePlan['after'] = [];
  // Hermes's CLI has no flag for reasoning effort, so a task made through it gets its effort in a second request.
  if (cli && fields.reasoningEffort !== '') after.push((id) => ({ method: 'PATCH', path: `${KANBAN}/tasks/${encodeURIComponent(id)}${boardQuery(board)}`, body: { reasoning_effort: fields.reasoningEffort } }));
  if (parked && draft === 'todo') after.push((id) => ({ method: 'PATCH', path: `${KANBAN}/tasks/${encodeURIComponent(id)}${boardQuery(board)}`, body: { status: 'todo' } }));
  if (mode === 'run-now') after.push(() => ({ method: 'POST', path: `${KANBAN}/dispatch${boardQuery(board)}` }));
  return {
    via: cli ? 'cli' : 'rest',
    create: cli ? { method: 'POST', path: `/_caduceus/api/work/tasks${boardQuery(board, scope)}`, body } : { method: 'POST', path: `${KANBAN}/tasks${boardQuery(board)}`, body: fields.reasoningEffort !== '' ? { ...body, reasoning_effort: fields.reasoningEffort } : body },
    after,
    confirm: CONFIRMATIONS[mode](fields.title.trim(), draft, fields.assignee),
  };
}

/** The id of the task a create answered with: the plugin answers `{ task }`, the Caduceus route `{ id, task }`. */
export function createdTaskId(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.id === 'string') return body.id;
  return isRecord(body.task) && typeof body.task.id === 'string' ? body.task.id : undefined;
}

/** The warning Hermes attaches to a create (no dispatcher is running to start a ready task), if it did. */
export function createWarning(body: unknown): string | undefined {
  return isRecord(body) && typeof body.warning === 'string' && body.warning !== '' ? body.warning : undefined;
}

// --- Reading a task back, and changing one that exists ---

/** The fields as a task Hermes holds reads back, for the editor to open (or to start a copy from). `parents` come from the task's links. */
export function fieldsOfTask(task: TaskFull, parents: readonly string[] = []): BriefFields {
  const kind = task.workspaceKind === 'dir' || task.workspaceKind === 'worktree' ? task.workspaceKind : 'scratch';
  const workspace: TaskWorkspace =
    kind === 'scratch' ? { kind } : kind === 'dir' ? { kind, path: task.workspacePath ?? '' } : { kind, ...(task.workspacePath ? { path: task.workspacePath } : {}), ...(task.branchName ? { branch: task.branchName } : {}) };
  return {
    title: task.title,
    brief: parseBrief(task.brief),
    assignee: task.assignee ?? '',
    model: task.modelOverride ?? '',
    provider: task.providerOverride ?? '',
    reasoningEffort: task.reasoningEffort ?? '',
    skills: task.skills ?? [],
    workspace,
    project: task.projectId ?? '',
    ...(task.priority !== 0 ? { priority: task.priority } : {}),
    maxRuntime: task.maxRuntimeSeconds === null ? '' : durationText(task.maxRuntimeSeconds),
    ...(task.maxRetries === null ? {} : { maxRetries: task.maxRetries }),
    goalMode: task.goalMode,
    ...(task.goalMode && task.goalMaxTurns !== null ? { goalMaxTurns: task.goalMaxTurns } : {}),
    // Hermes writes `local-only` into every task that has no contract; the editor shows that as "not set".
    completionContract: task.completionContract === null || task.completionContract === 'local-only' ? '' : task.completionContract,
    parents: [...parents],
  };
}

/** The fields Hermes cannot change once the task exists, by the names the editor shows them with. Changing one means a copy: "Duplicate with changes". */
export const LOCKED_FIELDS = ['workspace', 'project', 'skills', 'maxRuntime', 'maxRetries', 'goalMode', 'goalMaxTurns', 'completionContract', 'parents'] as const;

/** The locked fields whose value differs between the task and the fields, so that a form that offers them can say they will not be saved. */
export function lockedChanges(task: TaskFull, fields: BriefFields, parents: readonly string[] = []): (typeof LOCKED_FIELDS)[number][] {
  const before = fieldsOfTask(task, parents);
  return LOCKED_FIELDS.filter((name) => JSON.stringify(before[name]) !== JSON.stringify(fields[name]));
}

/** The one PATCH that saves what changed on a task that exists, or `undefined` when nothing did. Only what changed is sent. */
export function editRequest(task: TaskFull, fields: BriefFields, board?: string): Plain | undefined {
  const before = fieldsOfTask(task);
  const body: Record<string, unknown> = {};
  if (fields.title.trim() !== before.title) body.title = fields.title.trim();
  // A body the Brief did not change is left exactly as it is: opening a CLI-written body and saving must not rewrite it.
  if (serialiseBrief(fields.brief) !== serialiseBrief(before.brief)) body.body = serialiseBrief(fields.brief);
  if (fields.assignee !== before.assignee) body.assignee = fields.assignee;
  if ((fields.priority ?? 0) !== (before.priority ?? 0)) body.priority = fields.priority ?? 0;
  if (fields.model !== before.model || (fields.model !== '' && fields.provider !== before.provider)) {
    if (fields.model === '') body.clear_model_override = true;
    else {
      body.model_override = fields.model;
      if (fields.provider !== '') body.provider_override = fields.provider;
    }
  }
  if (fields.reasoningEffort !== before.reasoningEffort) {
    if (fields.reasoningEffort === '') body.clear_reasoning_effort = true;
    else body.reasoning_effort = fields.reasoningEffort;
  }
  return Object.keys(body).length === 0 ? undefined : { method: 'PATCH', path: `${KANBAN}/tasks/${encodeURIComponent(task.id)}${boardQuery(board)}`, body };
}

// --- Schedule mode ---

/** The fields a Create-task job's script is made from, for the Schedule mode; the schedule builder writes and saves it. Reasoning effort and parents have no `hermes kanban create` flag a script could use, so they are not carried. */
export function scheduledFields(fields: BriefFields): TaskFields {
  return {
    title: fields.title.trim(),
    brief: serialiseBrief(fields.brief),
    assignee: fields.assignee,
    triage: false,
    ...(fields.priority !== undefined && fields.priority !== 0 ? { priority: fields.priority } : {}),
    skills: fields.skills,
    model: fields.model,
    ...(fields.model !== '' && fields.provider !== '' ? { provider: fields.provider } : {}),
    workspace: fields.workspace.kind === 'worktree' && fields.workspace.path === '' ? { kind: 'worktree', ...(fields.workspace.branch ? { branch: fields.workspace.branch } : {}) } : fields.workspace,
    ...(fields.project !== '' ? { project: fields.project } : {}),
    ...(durationSeconds(fields.maxRuntime) !== undefined ? { maxRuntime: fields.maxRuntime.trim() } : {}),
    ...(fields.maxRetries !== undefined ? { maxRetries: fields.maxRetries } : {}),
    ...(fields.goalMode ? { goalMode: true, ...(fields.goalMaxTurns !== undefined ? { goalMaxTurns: fields.goalMaxTurns } : {}) } : {}),
    ...(fields.completionContract.trim() !== '' ? { completionContract: fields.completionContract.trim() } : {}),
  };
}
