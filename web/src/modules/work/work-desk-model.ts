// What Work's landing view knows about everything with a lifecycle, free of the DOM and of React: Kanban tasks, the chat runs Hermes has live, finished work
// that has not been opened, and cron jobs, each put in exactly one of four groups by what the owner can do about it now. Everything comes from Hermes's
// answers, the Inbox's feed and Today's review state (D1); nothing here is stored.
import type { LiveRun } from '@caduceus/contracts/inbox';
import type { ReadyItem } from '@caduceus/contracts/today';
import { BLOCK_META, failureLine, type BoardTask } from './board-model.ts';
import { relativeTime, type Job } from './schedules-model.ts';

/**
 * The four groups, in the order the screen lists them. Waiting on you: it cannot go on without the owner. Running: someone is on it now. Ready for review:
 * finished and not yet opened. Scheduled: it has not started, and begins by itself (a timer, a free worker, another task, a retry).
 */
export const WORK_GROUPS = ['waiting', 'running', 'review', 'scheduled'] as const;
export type WorkGroupId = (typeof WORK_GROUPS)[number];

export const WORK_GROUP_META: Record<WorkGroupId, { label: string; hint: string }> = {
  waiting: { label: 'Waiting on you', hint: 'Reviews, questions and approvals that stop work until you answer.' },
  running: { label: 'Running', hint: 'A worker or an agent is on it now.' },
  review: { label: 'Ready for review', hint: 'Finished, and you have not opened it yet.' },
  scheduled: { label: 'Scheduled', hint: 'Not started yet: waiting for its time, a free worker, another task or a retry.' },
};

/** The one thing a row offers. `pause` and `resume` act on a schedule's job; the others open where the row leads. */
export type WorkAction = 'decide' | 'retry' | 'open' | 'review' | 'pause' | 'resume';

/** How a row's time reads: when the owner was asked, when it started, finished or was added, when it is next due, or that a schedule is off or over. */
export type WhenKind = 'asked' | 'started' | 'finished' | 'added' | 'next' | 'paused' | 'ended';

export interface WorkRow {
  /** Stable across loads and unique across sources: `task:<board>/<id>`, `run:<session>`, `finished:<stored session>`, `job:<profile>/<id>`. */
  key: string;
  source: 'task' | 'run' | 'finished' | 'job';
  group: WorkGroupId;
  /** The agent: a task's assignee, a run's or a job's profile. `undefined` for a task nobody has. */
  profile: string | undefined;
  title: string;
  /** What it is doing, or why it waits: one short sentence. */
  line: string;
  /** Milliseconds since the epoch; absent for `paused` and `ended`, and for a job nothing is due for. */
  when: { kind: WhenKind; at?: number } | undefined;
  action: WorkAction;
  /** Where the row's title and its Decide, Open or Review lead. */
  to: string;
  /** The schedule a Pause or Resume acts on. */
  job?: Job;
  /** What to tell Caduceus when the owner opens a row that is ready for review, so that it leaves the list (`POST /_caduceus/api/today/ready/opened`). */
  opened?: { id: string; stamp: string };
}

export interface WorkInput {
  /** The tasks of each Hermes board. */
  boards: readonly { slug: string; tasks: readonly BoardTask[] }[];
  /** The chat runs Hermes has live. */
  runs: readonly LiveRun[];
  /**
   * What is ready for review, as Today's review state says it (`GET /_caduceus/api/today/ready`): Hermes has no notion of finished work that has been opened,
   * so Caduceus keeps it. A done task that is not among them, or was done again since, is settled: it is on the Board and in Tasks, and in no group here.
   */
  ready: readonly ReadyItem[];
  jobs: readonly Job[];
}

export interface WorkGroups {
  groups: Record<WorkGroupId, WorkRow[]>;
  /** The agents who have a row, before the filter, sorted. */
  agents: string[];
  /** Done tasks that are opened already, and so in no group. */
  settled: number;
}

const ms = (seconds: number) => seconds * 1000;

const taskHref = (slug: string, task: BoardTask) => `/work/tasks/${encodeURIComponent(task.id)}?board=${encodeURIComponent(slug)}`;

/** A row and the key it sorts by in its group: the smaller tuple comes first, a tie goes to the key. */
interface Candidate {
  row: WorkRow;
  order: number[];
}

/** The time a task has been at its status: since a worker started it, else since it was added. */
function sinceStarted(task: BoardTask): NonNullable<WorkRow['when']> & { at: number } {
  return task.startedAt === null ? { kind: 'added', at: ms(task.createdAt) } : { kind: 'started', at: ms(task.startedAt) };
}

/** How Today's review state names a task: the id its items carry (`ReadyItem.id`). */
export const readyTaskId = (slug: string, taskId: string): string => `task:${slug}:${taskId}`;


function taskCandidate(slug: string, task: BoardTask, unopened: Readonly<Record<string, string>>): Candidate | 'settled' {
  const base = { key: `task:${slug}/${task.id}`, source: 'task', profile: task.assignee ?? undefined, title: task.title, to: taskHref(slug, task) } as const;
  const waiting = (line: string): Candidate => {
    const when = sinceStarted(task);
    return { row: { ...base, group: 'waiting', line, when, action: 'decide' }, order: [when.at] };
  };
  const queued = (line: string): Candidate => ({ row: { ...base, group: 'scheduled', line, when: { kind: 'added', at: ms(task.createdAt) }, action: 'open' }, order: [1, -task.priority, ms(task.createdAt)] });
  switch (task.status) {
    case 'review':
      return waiting(task.summary ?? 'Finished by its worker, waiting for your review');
    case 'blocked': {
      // A question and a missing capability need the owner; a block on another task and one that will retry go on without.
      if (task.blockKind === 'dependency' || task.blockKind === 'transient') return queued(BLOCK_META[task.blockKind].label);
      if (task.blockKind === 'needs_input') return waiting(task.summary ?? 'Asked you a question');
      if (task.blockKind === 'capability') return waiting(BLOCK_META.capability.label);
      // A block with no kind and no failed attempt is one somebody set on purpose, with their reason: it is not waiting on the owner.
      if (task.lastFailureError === null && task.failures === 0) return queued(task.summary ?? 'Blocked');
      const when = sinceStarted(task);
      return { row: { ...base, group: 'waiting', line: failureLine(task.lastFailureError), when, action: 'retry' }, order: [when.at] };
    }
    case 'running': {
      const when = sinceStarted(task);
      // The latest summary belongs to an earlier attempt or a block that is over: a running task says what stage it is at, not that.
      return { row: { ...base, group: 'running', line: task.currentStepKey === null ? 'A worker is on it' : `Stage: ${task.currentStepKey}`, when, action: 'open' }, order: [when.at] };
    }
    case 'done': {
      const id = readyTaskId(slug, task.id);
      if (task.completedAt === null || unopened[id] !== String(task.completedAt)) return 'settled';
      const at = ms(task.completedAt);
      return { row: { ...base, group: 'review', line: task.summary ?? 'Finished', when: { kind: 'finished', at }, action: 'review', opened: { id, stamp: unopened[id] } }, order: [-at] };
    }
    case 'triage':
      return queued('A rough idea, not yet a brief');
    case 'todo':
      return queued('Not ready to be picked up');
    case 'ready':
      return queued('Waiting for a worker');
    case 'scheduled':
      return queued('Starts at a set time');
  }
}

function runCandidate(run: LiveRun): Candidate {
  const waiting = run.status === 'waiting';
  const row: WorkRow = {
    key: `run:${run.sessionId}`,
    source: 'run',
    group: waiting ? 'waiting' : 'running',
    profile: run.profile,
    title: run.title,
    line: waiting ? 'Waiting for your decision' : run.background ? 'Running in the background' : 'Working on it',
    when: { kind: waiting ? 'asked' : 'started', at: run.since },
    action: waiting ? 'decide' : 'open',
    to: run.storedSessionId === undefined ? '/chat' : `/chat/${encodeURIComponent(run.storedSessionId)}`,
  };
  return { row, order: [run.since] };
}

function jobCandidate(job: Job): Candidate {
  const base = { key: `job:${job.profile}/${job.id}`, source: 'job', group: 'scheduled', profile: job.profile, title: job.name, to: `/work/schedules/${encodeURIComponent(job.id)}`, job } as const;
  const line = job.lastStatus === 'error' ? `${job.schedule} · last run failed` : job.schedule;
  if (job.state === 'completed') return { row: { ...base, line, when: { kind: 'ended' }, action: 'open' }, order: [3] };
  if (!job.enabled) return { row: { ...base, line, when: { kind: 'paused' }, action: 'resume' }, order: [2] };
  return { row: { ...base, line, when: job.nextRunAt === undefined ? undefined : { kind: 'next', at: job.nextRunAt }, action: 'pause' }, order: [0, job.nextRunAt ?? Number.POSITIVE_INFINITY] };
}

/** Compares two order tuples place by place; a shorter tuple that matches as far as it goes comes first. */
function byOrder(a: Candidate, b: Candidate): number {
  for (let place = 0; place < Math.min(a.order.length, b.order.length); place++) {
    if (a.order[place] !== b.order[place]) return a.order[place] < b.order[place] ? -1 : 1;
  }
  return a.order.length - b.order.length || a.row.key.localeCompare(b.row.key);
}

/**
 * Puts every task, live run, finished run that is ready for review and schedule in one group, and narrows them to `agent` when one is given (a row nobody
 * owns is then left out). Precedence, where one thing could be two: a run that is live is in Running or Waiting and not also in Ready for review, even
 * while Hermes still lists its session after the turn is over. Waiting is oldest first (that request has waited longest), Running oldest first (that run
 * is the one to look at), Ready for review newest first, and Scheduled in the order things start: timed schedules by their next run, then queued tasks by
 * priority and age, then schedules that are off, then those that are over.
 */
export function groupWork({ boards, runs, ready, jobs }: WorkInput, agent?: string): WorkGroups {
  const candidates: Candidate[] = [];
  const unopened: Record<string, string> = Object.fromEntries(ready.map((item) => [item.id, item.stamp]));
  let settled = 0;
  for (const { slug, tasks } of boards) {
    for (const task of tasks) {
      const placed = taskCandidate(slug, task, unopened);
      if (placed === 'settled') settled++;
      else candidates.push(placed);
    }
  }
  candidates.push(...runs.map(runCandidate));
  const live = new Set(runs.flatMap((run) => (run.storedSessionId === undefined ? [] : [run.storedSessionId])));
  for (const item of ready) {
    if (item.kind !== 'run') continue;
    const session = item.id.slice('run:'.length);
    if (live.has(session)) continue;
    const row: WorkRow = {
      key: `finished:${session}`,
      source: 'finished',
      group: 'review',
      profile: item.profile,
      title: item.title,
      line: item.summary ?? 'Finished its run',
      when: { kind: 'finished', at: item.at },
      action: 'review',
      to: item.to,
      opened: { id: item.id, stamp: item.stamp },
    };
    candidates.push({ row, order: [-item.at] });
  }
  candidates.push(...jobs.map(jobCandidate));
  const everyone = new Set(candidates.flatMap(({ row }) => (row.profile === undefined ? [] : [row.profile])));
  const groups: Record<WorkGroupId, WorkRow[]> = { waiting: [], running: [], review: [], scheduled: [] };
  for (const candidate of candidates.sort(byOrder)) {
    if (agent === undefined || candidate.row.profile === agent) groups[candidate.row.group].push(candidate.row);
  }
  return { groups, agents: [...everyone].sort((a, b) => a.localeCompare(b)), settled };
}

/** A row's time in words: "Asked 6 min ago", "Running for 12 min", "Next in 3 h", "Paused". */
export function whenInWords(when: WorkRow['when'], now: number): string {
  if (when === undefined) return '';
  if (when.kind === 'paused') return 'Paused';
  if (when.kind === 'ended') return 'Finished';
  const at = when.at ?? now;
  if (when.kind === 'next') return `Next ${relativeTime(at, now)}`;
  const earlier = Math.min(at, now);
  const ago = now - earlier < 1000 ? 'just now' : relativeTime(earlier, now);
  if (when.kind === 'started') return `Started ${ago}`;
  return `${when.kind === 'asked' ? 'Asked' : when.kind === 'finished' ? 'Finished' : 'Added'} ${ago}`;
}
