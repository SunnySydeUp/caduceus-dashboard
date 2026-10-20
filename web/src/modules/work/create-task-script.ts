// The script a Create-task job runs. Hermes cron runs a script from the profile's `scripts/` folder and delivers what it prints, so a job
// that puts a task on the board on schedule is a script that calls `hermes kanban create`. Caduceus writes the script; the fields live in
// its second line as JSON, so the editor can read them back (the command below it is made from the same fields).
import { isRecord } from '@caduceus/contracts/policy/guards';
import { CREATE_TASK_SCRIPT_PREFIX } from './schedules-model.ts';

export type TaskWorkspace = { kind: 'scratch' } | { kind: 'dir'; path: string } | { kind: 'worktree'; path?: string; branch?: string };

/** What a scheduled task is made with: the fields of `hermes kanban create` that Caduceus offers. */
export interface TaskFields {
  title: string;
  /** The brief, as Markdown: the task's body. */
  brief: string;
  /** The profile that works the task; empty leaves it unassigned. */
  assignee: string;
  /** Park the task in triage, for a specifier, instead of making it ready to run. */
  triage: boolean;
  priority?: number;
  skills: string[];
  /** The model the worker is pinned to; empty uses the profile's. */
  model: string;
  /** The provider `model` belongs to; only with a model. */
  provider?: string;
  workspace: TaskWorkspace;
  /** `300`, `90s`, `30m`, `2h` or `1d`. */
  maxRuntime?: string;
  maxRetries?: number;
  /** A Hermes project (id or slug) that anchors a worktree. */
  project?: string;
  /** Run the worker in a goal loop: a judge checks each turn until the task is done. */
  goalMode?: boolean;
  goalMaxTurns?: number;
  /** `local-only`, `OWNER/REPO` or the exact URL of a pull request. */
  completionContract?: string;
}

/** The first line of the fields' JSON: how a script made here is recognised and read back. */
const FIELDS_MARK = '# caduceus-create-task ';
/** What Hermes records as the task's author, so a task made by a schedule can be told from one the owner wrote. */
export const SCHEDULE_AUTHOR = 'caduceus-schedule';

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

function workspaceFlags(workspace: TaskWorkspace): string[] {
  switch (workspace.kind) {
    case 'scratch':
      return [];
    case 'dir':
      return ['--workspace', `dir:${workspace.path}`];
    case 'worktree':
      return ['--workspace', workspace.path ? `worktree:${workspace.path}` : 'worktree', ...(workspace.branch ? ['--branch', workspace.branch] : [])];
  }
}

/** The arguments of `hermes kanban create`, in the order the script gives them. */
function createArguments(fields: TaskFields): string[] {
  return [
    'kanban',
    'create',
    fields.title,
    ...(fields.assignee ? ['--assignee', fields.assignee] : []),
    ...(fields.triage ? ['--triage'] : []),
    ...(fields.priority === undefined ? [] : ['--priority', String(fields.priority)]),
    ...workspaceFlags(fields.workspace),
    ...(fields.project ? ['--project', fields.project] : []),
    ...(fields.maxRuntime ? ['--max-runtime', fields.maxRuntime] : []),
    ...(fields.maxRetries === undefined ? [] : ['--max-retries', String(fields.maxRetries)]),
    ...(fields.model ? ['--model', fields.model] : []),
    ...(fields.model && fields.provider ? ['--provider', fields.provider] : []),
    ...fields.skills.flatMap((skill) => ['--skill', skill]),
    ...(fields.completionContract ? ['--completion-contract', fields.completionContract] : []),
    ...(fields.goalMode ? ['--goal', ...(fields.goalMaxTurns === undefined ? [] : ['--goal-max-turns', String(fields.goalMaxTurns)])] : []),
    '--created-by',
    SCHEDULE_AUTHOR,
  ];
}

const FIND_HERMES = `HERMES_BIN="$(command -v hermes 2>/dev/null || true)"
if [ -z "$HERMES_BIN" ]; then
  for candidate in "$HOME/.local/bin/hermes" /opt/homebrew/bin/hermes /usr/local/bin/hermes; do
    if [ -x "$candidate" ]; then HERMES_BIN="$candidate"; break; fi
  done
fi
if [ -z "$HERMES_BIN" ]; then
  echo "hermes was not found where this job runs; install it or put it on PATH" >&2
  exit 127
fi`;

/** The script, as bash runs it. The brief goes in on standard input, so it reaches Hermes exactly as typed, whatever it contains. */
export function createTaskScript(fields: TaskFields): string {
  const args = createArguments(fields).map((arg, index) => (index < 2 ? arg : quote(arg)));
  const lines = ['#!/bin/bash', '# Made by Caduceus for a Create-task job (Work › Schedules). Saving the job there writes this file again: change the job, not this file.', `${FIELDS_MARK}${JSON.stringify(fields)}`, 'set -eu', FIND_HERMES];
  if (fields.brief === '') return `${[...lines, `exec "$HERMES_BIN" ${args.join(' ')}`].join('\n')}\n`;
  // A quoted string is the one way to carry any text through a shell untouched; `printf '%s'` writes it without adding a newline.
  return `${[...lines, `BRIEF=${quote(fields.brief)}`, `printf '%s' "$BRIEF" | "$HERMES_BIN" ${args.join(' ')} --body-file -`].join('\n')}\n`;
}

const strings = (value: unknown): string[] | undefined => (Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : undefined);

function workspaceOf(value: unknown): TaskWorkspace | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'scratch') return { kind: 'scratch' };
  if (value.kind === 'dir' && typeof value.path === 'string') return { kind: 'dir', path: value.path };
  if (value.kind === 'worktree') return { kind: 'worktree', ...(typeof value.path === 'string' ? { path: value.path } : {}), ...(typeof value.branch === 'string' ? { branch: value.branch } : {}) };
  return undefined;
}

/** The fields a script made by Caduceus was made from; undefined for a script written by hand, which the editor does not open. */
export function readCreateTaskScript(text: string): TaskFields | undefined {
  const line = text.split('\n').find((candidate) => candidate.startsWith(FIELDS_MARK));
  if (line === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(FIELDS_MARK.length));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const skills = strings(parsed.skills);
  const workspace = workspaceOf(parsed.workspace);
  if (typeof parsed.title !== 'string' || typeof parsed.brief !== 'string' || typeof parsed.assignee !== 'string' || typeof parsed.model !== 'string' || typeof parsed.triage !== 'boolean' || !skills || !workspace) return undefined;
  return {
    title: parsed.title,
    brief: parsed.brief,
    assignee: parsed.assignee,
    triage: parsed.triage,
    ...(typeof parsed.priority === 'number' ? { priority: parsed.priority } : {}),
    skills,
    model: parsed.model,
    workspace,
    ...(typeof parsed.maxRuntime === 'string' ? { maxRuntime: parsed.maxRuntime } : {}),
    ...(typeof parsed.maxRetries === 'number' ? { maxRetries: parsed.maxRetries } : {}),
    ...(typeof parsed.provider === 'string' ? { provider: parsed.provider } : {}),
    ...(typeof parsed.project === 'string' ? { project: parsed.project } : {}),
    ...(parsed.goalMode === true ? { goalMode: true } : {}),
    ...(typeof parsed.goalMaxTurns === 'number' ? { goalMaxTurns: parsed.goalMaxTurns } : {}),
    ...(typeof parsed.completionContract === 'string' ? { completionContract: parsed.completionContract } : {}),
  };
}

/**
 * The file name of a Create-task job's script: the prefix the schedule list reads the job's type from, the job's name in a form a shell and a
 * file system both accept, and `unique` (a few random characters) so that two jobs of one name never share a script.
 */
export function scriptFileName(jobName: string, unique: string): string {
  const slug = jobName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${CREATE_TASK_SCRIPT_PREFIX}${slug ? `${slug}-` : ''}${unique}.sh`;
}
