// What the Details panel of Talk says about an agent (M8 #04): Right now, the workspace preview, Work and About. Pure: every value is something Hermes already sent
// (the transcript, the usage, the board, the cron jobs, the live runs), read on this load. Nothing here is kept, and nothing is made up for a field Hermes did not send.
import type { GoalSnapshot, Usage } from '@caduceus/contracts/hermes/gateway';
import type { LiveRun } from '@caduceus/contracts/inbox';
import { plainDuration } from '../../plain-duration.ts';
import { crewStateLabel, type CrewMember } from '../crew/crew-state.ts';
import { STATUS_META, type BoardTask } from '../work/board-model.ts';
import type { Job } from '../work/schedules-model.ts';
import { waitsForOwner } from '../work/tasks-model.ts';
import type { ActivityItem, SubagentActivity, Todo, ToolActivity } from './activity.ts';
import type { ChatMessage, ChatTurn } from './chat-session.ts';
import { contextRing } from './composer-model.ts';
import type { OpenRequest } from './requests.ts';

/** The line under the agent's name: its state in words and what it is doing, so the state is never colour alone. An idle agent has only the state. */
export function liveLine(member: CrewMember | undefined): string {
  if (member === undefined) return '';
  const state = crewStateLabel[member.state];
  return member.state === 'idle' ? state : `${state} · ${member.line}`;
}

// ── Right now ──

export interface RightNow {
  /** `waiting`: the owner must decide; `working`: a turn is under way; `failed`: the last turn did not complete; `idle`: nothing is. */
  tone: 'idle' | 'working' | 'waiting' | 'failed';
  headline: string;
  /** "Step 3 of 4", from the agent's own task list; none when it keeps no list. */
  step: string | undefined;
  /** How far along that list is, 0 to 1. */
  progress: number | undefined;
}

/** What a tool is doing, in words, for the ones the owner meets most; any other is "Running <name>". */
const TOOL_WORDS: Record<string, string> = {
  terminal: 'Running a command',
  process: 'Managing a process',
  write_file: 'Writing a file',
  patch: 'Editing a file',
  read_file: 'Reading a file',
  search_files: 'Searching files',
  delegate_task: 'Handing work to a helper agent',
};

const toolWords = (name: string): string => TOOL_WORDS[name] ?? (name.startsWith('browser_') ? 'Using the browser' : `Running ${name}`);

const LINE_MAX = 80;
const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= LINE_MAX ? flat : `${flat.slice(0, LINE_MAX - 1).trimEnd()}…`;
};

const isLive = (status: ToolActivity['status']): boolean => status === 'running' || status === 'generating';

/** The items of the turn in progress, in the order they happened. */
const turnItems = (turn: ChatTurn | undefined): ActivityItem[] => (turn?.segments ?? []).flatMap((segment) => (segment.kind === 'activity' ? segment.items : []));

/** Where the agent's own task list stands: the step it is on, and the share that is done. Cancelled tasks are not steps. */
function stepsOf(todos: readonly Todo[]): { step: string; progress: number } | undefined {
  const steps = todos.filter((todo) => todo.status !== 'cancelled');
  if (steps.length === 0) return undefined;
  const done = steps.filter((todo) => todo.status === 'completed').length;
  return { step: `Step ${Math.min(steps.length, done + 1)} of ${steps.length}`, progress: done / steps.length };
}

export function rightNow({ requests, turn, running, todos, subagents }: { requests: readonly OpenRequest[]; turn: ChatTurn | undefined; running: boolean; todos: readonly Todo[]; subagents: readonly SubagentActivity[] }): RightNow {
  const steps = stepsOf(todos);
  const progress = { step: steps?.step, progress: steps?.progress };
  const asked = requests[0];
  if (asked?.kind === 'approval') return { tone: 'waiting', headline: shorten(`Waiting for your OK to run ${asked.command || asked.description || asked.tool || 'a tool'}`), ...progress };
  if (asked?.kind === 'clarify') return { tone: 'waiting', headline: shorten(`Waiting for your answer: ${asked.questions[0]?.question ?? 'a question'}`), ...progress };
  if (turn?.status === 'failed') return { tone: 'failed', headline: shorten(`The last turn failed: ${turn.error ?? 'Hermes gave no reason'}`), ...progress };
  if (!running && turn === undefined) return { tone: 'idle', headline: 'Nothing is running', ...progress };

  const items = turnItems(turn);
  const live = items.findLast((item): item is ToolActivity => item.kind === 'tool' && isLive(item.status));
  if (live) return { tone: 'working', headline: shorten(`${toolWords(live.name)}${live.context ? `: ${live.context}` : ''}`), ...progress };
  const helper = subagents.findLast((child) => child.status === 'running' || child.status === 'queued');
  if (helper) return { tone: 'working', headline: shorten(`A helper agent is working: ${helper.goal}`), ...progress };
  const last = items.at(-1);
  if (last?.kind === 'reasoning' && last.streaming) return { tone: 'working', headline: 'Thinking', ...progress };
  if (turn?.status === 'waiting') return { tone: 'working', headline: 'Starting', ...progress };
  return { tone: 'working', headline: 'Writing a reply', ...progress };
}

// ── The workspace preview ──

export type WorkspaceView = 'terminal' | 'files' | 'browser';

export interface Workspace {
  /** The agent's last terminal command, and the last step it took in a browser. */
  terminal: ToolActivity | undefined;
  browser: ToolActivity | undefined;
  /** The files it wrote or patched, newest first, each once. */
  files: string[];
}

const FILE_EDITS = ['write_file', 'patch'];

export function workspaceOf(messages: readonly ChatMessage[]): Workspace {
  const tools = messages.flatMap((message) => (message.activity ?? []).filter((item): item is ToolActivity => item.kind === 'tool'));
  const files: string[] = [];
  for (const call of tools.toReversed()) {
    const path = FILE_EDITS.includes(call.name) ? call.args?.path : undefined;
    if (typeof path === 'string' && path !== '' && !files.includes(path)) files.push(path);
  }
  return {
    terminal: tools.findLast((call) => call.name === 'terminal'),
    browser: tools.findLast((call) => call.name.startsWith('browser_')),
    files,
  };
}

// ── Which sections show ──

export type DetailsSection = 'now' | 'last-command' | 'work' | 'about' | 'plan';

/** Whether the agent's plan and run have anything to show: a task list, a helper, a goal or a usage report. */
export function planHasContent({ todos, subagents, goal, usage }: { todos: readonly Todo[]; subagents: readonly SubagentActivity[]; goal: GoalSnapshot | undefined; usage: Usage | undefined }): boolean {
  return todos.length > 0 || subagents.length > 0 || goal !== undefined || usage !== undefined;
}

/**
 * The sections Details draws, in order. Last command and About are always there; Right now shows while the agent is doing something, waits for the owner or failed
 * its last turn, Work when the agent has any, Plan and run once it has a plan, a helper, a goal or a usage report.
 */
export function detailsSections({ now, workEntries, plan }: { now: RightNow; workEntries: number; plan: boolean }): DetailsSection[] {
  return [...(now.tone === 'idle' ? [] : ['now' as const]), 'last-command', ...(workEntries > 0 ? ['work' as const] : []), 'about', ...(plan ? ['plan' as const] : [])];
}

/** From this width Details is a column beside the thread; a tablet gets it over the thread, and a phone (the compact size class) a sheet. */
const DETAILS_COLUMN_MIN_PX = 1280;
const DETAILS_OVERLAY_MIN_PX = 600;

export function detailsLayout(widthPx: number): 'sheet' | 'overlay' | 'column' {
  return widthPx >= DETAILS_COLUMN_MIN_PX ? 'column' : widthPx >= DETAILS_OVERLAY_MIN_PX ? 'overlay' : 'sheet';
}

// ── Work ──

export interface WorkEntry {
  kind: 'task' | 'run' | 'routine';
  id: string;
  title: string;
  detail: string;
  /** `waiting`: it needs the owner; `running`: it is going on now; `failed`: it stopped badly; `idle`: it waits its turn. */
  tone: 'waiting' | 'running' | 'failed' | 'idle';
  /** Where it opens. */
  to: string;
}

/** How many entries Work lists before it counts the rest. */
export const WORK_SHOWN = 6;

const TONE_ORDER: Record<WorkEntry['tone'], number> = { waiting: 0, failed: 1, running: 2, idle: 3 };

function taskEntry(task: BoardTask, now: number): WorkEntry {
  const failed = task.status === 'blocked' || (task.status !== 'done' && (task.failures > 0 || task.lastFailureError !== null));
  const tone: WorkEntry['tone'] = waitsForOwner(task) ? 'waiting' : failed ? 'failed' : task.status === 'running' ? 'running' : 'idle';
  const detail = task.status === 'running' && task.startedAt !== null ? `Running for ${plainDuration(Math.max(0, now / 1000 - task.startedAt))}` : STATUS_META[task.status].label;
  return { kind: 'task', id: task.id, title: task.title, detail, tone, to: `/work/tasks/${encodeURIComponent(task.id)}` };
}

/**
 * The agent's work: its tasks that are not done (the board's, by assignee), its other live chats and its routines that are on. The ones that need the owner come first, then
 * failures, then what is running, then what waits; the first `WORK_SHOWN` are listed and `more` counts the rest. Before Hermes has answered (`undefined`) there is nothing.
 */
export function workOf({ profile, session, tasks, jobs, runs, now }: { profile: string; /** The stored id of the chat that is open: it is not listed as a run of its own. */ session: string | undefined; tasks: readonly BoardTask[] | undefined; jobs: readonly Job[] | undefined; runs: readonly LiveRun[]; now: number }): { entries: WorkEntry[]; more: number } {
  const entries: WorkEntry[] = [
    ...(tasks ?? []).filter((task) => task.assignee === profile && task.status !== 'done').map((task) => taskEntry(task, now)),
    ...runs
      .filter((run) => run.profile === profile && run.storedSessionId !== undefined && run.storedSessionId !== session)
      .map((run): WorkEntry => ({ kind: 'run', id: run.storedSessionId!, title: run.title, detail: run.status === 'waiting' ? 'Waiting for you' : `Running for ${plainDuration(Math.max(0, (now - run.since) / 1000))}`, tone: run.status === 'waiting' ? 'waiting' : 'running', to: `/chat/${encodeURIComponent(run.storedSessionId!)}` })),
    ...(jobs ?? []).filter((job) => job.profile === profile && job.enabled).map((job): WorkEntry => ({ kind: 'routine', id: job.id, title: job.name, detail: job.schedule, tone: 'idle', to: `/work/schedules/${encodeURIComponent(job.id)}` })),
  ];
  // A stable sort keeps the board's, the list of runs' and the cron's own order inside each tone.
  const ordered = entries.toSorted((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
  return { entries: ordered.slice(0, WORK_SHOWN), more: Math.max(0, ordered.length - WORK_SHOWN) };
}

// ── About ──

export interface AboutRow {
  label: string;
  value: string;
}

const money = (dollars: number): string => (dollars > 0 && dollars < 0.01 ? 'Under $0.01' : `$${dollars.toFixed(2)}`);

export function aboutOf({ model, cwd, usage, spendToday }: { model: string | undefined; cwd: string | undefined; usage: Usage | undefined; spendToday: number | undefined }): AboutRow[] {
  const { percent } = contextRing(usage);
  return [
    { label: 'Model', value: model ?? 'The profile’s default' },
    { label: 'Folder', value: cwd ?? 'Not set' },
    { label: 'Cost today', value: spendToday === undefined ? 'Not known yet' : money(spendToday) },
    { label: 'Context', value: percent === undefined ? 'Not known until the first reply' : `${percent}% used` },
  ];
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export interface SpendPeriod {
  /** US dollars: what the provider billed when Hermes knows it, else Hermes's estimate. */
  cost: number;
  tokens: number;
}

export interface Spend {
  today: SpendPeriod;
  month: SpendPeriod;
}

/**
 * Today's and this month's use, from the `daily` rows of one usage analytics answer per profile (`GET /api/analytics/usage`). Hermes groups
 * sessions by the UTC day they started, so "today" and "this month" are the UTC ones. An answer that is not usable counts as nothing spent.
 */
export function spendOf(answers: readonly unknown[], now: Date): Spend {
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const spend: Spend = { today: { cost: 0, tokens: 0 }, month: { cost: 0, tokens: 0 } };
  for (const answer of answers) {
    const { daily } = record(answer);
    for (const raw of Array.isArray(daily) ? daily : []) {
      const row = record(raw);
      const { day } = row;
      if (typeof day !== 'string' || !day.startsWith(month)) continue;
      const cost = number(row.actual_cost) > 0 ? number(row.actual_cost) : number(row.estimated_cost);
      const tokens = number(row.input_tokens) + number(row.output_tokens);
      spend.month.cost += cost;
      spend.month.tokens += tokens;
      if (day === today) {
        spend.today.cost += cost;
        spend.today.tokens += tokens;
      }
    }
  }
  return spend;
}
