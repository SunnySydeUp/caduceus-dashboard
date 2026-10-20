// What Work › Schedules knows about Hermes cron jobs, free of the DOM and of React: how a job reads, which of the four types it is,
// when it fires and how it last went, and how the list is filtered. Everything comes from Hermes's answers (D1); nothing here is stored.
import { isRecord } from '@caduceus/contracts/policy/guards';
import { SCHEDULER_STALE_AFTER_S } from '@caduceus/contracts/scheduler';
import { plainDuration } from '../../plain-duration.ts';

export type JobType = 'agent' | 'script' | 'task' | 'blueprint';

/** The four job types as the badge, the filter and the help name them. */
export const JOB_TYPES: Record<JobType, { label: string; detail: string }> = {
  agent: { label: 'Agent prompt', detail: 'An agent answers a prompt on schedule.' },
  script: { label: 'Script', detail: 'A script runs on schedule: its output is the result, or goes to an agent as context.' },
  task: { label: 'Create task', detail: 'A script that puts a new task on the board on schedule.' },
  blueprint: { label: 'Blueprint', detail: 'A job made from one of Hermes’s Automation Blueprints.' },
};

/** A job as the list and the detail show it. */
export interface Job {
  /** Hermes's id. The same id can exist in two profiles only when a job file was copied, so the profile travels with it. */
  id: string;
  name: string;
  profile: string;
  type: JobType;
  /** False for a paused job. */
  enabled: boolean;
  /** Hermes's own state: `scheduled`, `paused`, `completed`… */
  state: string;
  /** The schedule in words: "Every Monday at 09:00". */
  schedule: string;
  /** What Hermes stores for the schedule (`every 120m`, `0 9 * * 1`), for the owner who wants the exact expression. */
  scheduleExpression: string;
  /** Milliseconds since the epoch; undefined when nothing is due (paused, finished). */
  nextRunAt?: number;
  lastRunAt?: number;
  /** `ok`, `error`, or whatever else Hermes recorded; undefined before the first run. */
  lastStatus?: string;
  lastError?: string;
  /** Seconds since this profile's scheduler last ticked; undefined when it never has. */
  schedulerAgeS?: number;
  /** The record as Hermes sent it: the configuration the detail shows, a duplicate is made from, and diagnostics report. */
  config: Record<string, unknown>;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
const instant = (value: unknown): number | undefined => {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(at) ? undefined : at;
};

/** The titles of Hermes's Automation Blueprints (`GET /api/cron/blueprints`). Hermes puts no mark on a job a blueprint made, but it names the job by the blueprint's title. */
export function parseBlueprintTitles(body: unknown): string[] {
  const listed = isRecord(body) && Array.isArray(body.blueprints) ? body.blueprints : [];
  return listed.flatMap((entry) => (isRecord(entry) && text(entry.title) ? [entry.title as string] : []));
}

/**
 * A Create-task job's script is named `caduceus-create-task-…` when Caduceus made it; a script an operator wrote to call
 * `hermes kanban create` is recognised by a name that says so. Hermes keeps the script in a file, so the name is all a list can see.
 */
export const CREATE_TASK_SCRIPT_PREFIX = 'caduceus-create-task-';
const KANBAN_CREATE_SCRIPT = /kanban[-_ ]?create/i;

/** Which of the four types a job is. */
export function jobType(job: Record<string, unknown>, blueprintTitles: readonly string[] = []): JobType {
  const script = text(job.script);
  if (script !== undefined) {
    const file = script.split('/').pop() ?? script;
    // A script that puts tasks on the board is a Create-task job; any other script is a Script job, whether its output is the result or goes to an agent.
    return job.no_agent === true && (file.startsWith(CREATE_TASK_SCRIPT_PREFIX) || KANBAN_CREATE_SCRIPT.test(file)) ? 'task' : 'script';
  }
  const name = text(job.name);
  if (script === undefined && name !== undefined && blueprintTitles.includes(name)) return 'blueprint';
  return 'agent';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const plural = (count: number, unit: string) => (count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`);
const clock = (hour: string, minute: string) => `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const WHOLE = /^\d+$/;

/** One weekday field (`1`, `mon`, `1,4`, `1-5`) as a list of weekdays 0–6, or undefined when it is more than that. */
function weekdays(field: string): number[] | undefined {
  const days = new Set<number>();
  for (const part of field.toLowerCase().split(',')) {
    const [from, to = from] = part.split('-').map((item) => (WHOLE.test(item) ? Number(item) % 7 : (WEEKDAY_NAMES[item.slice(0, 3)] ?? Number.NaN)));
    if (Number.isNaN(from) || Number.isNaN(to) || (part.includes('-') && to < from && to !== 0)) return undefined;
    for (let day = from; day <= (to === 0 && part.includes('-') ? 7 : to); day++) days.add(day % 7);
  }
  return [...days].sort((a, b) => a - b);
}

function listOf(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A five-field cron expression in words; an expression it cannot say simply is shown as it is. */
function cronInWords(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return `Cron ${expression}`;
  const [minute, hour, day, month, weekday] = fields;
  const exact = WHOLE.test(minute) && WHOLE.test(hour);
  if (day === '*' && month === '*' && weekday === '*') {
    if (minute === '*' && hour === '*') return 'Every minute';
    const everyMinutes = /^\*\/(\d+)$/.exec(minute);
    if (everyMinutes && hour === '*') return plural(Number(everyMinutes[1]), 'minute');
    const everyHours = /^\*\/(\d+)$/.exec(hour);
    if (everyHours && minute === '0') return plural(Number(everyHours[1]), 'hour');
    if (WHOLE.test(minute) && hour === '*') return minute === '0' ? 'Every hour' : `Every hour at :${minute.padStart(2, '0')}`;
    if (exact) return `Every day at ${clock(hour, minute)}`;
  }
  if (exact && month === '*' && day === '*') {
    const days = weekdays(weekday);
    if (days && days.length === 7) return `Every day at ${clock(hour, minute)}`;
    if (days && days.join() === '1,2,3,4,5') return `Weekdays at ${clock(hour, minute)}`;
    if (days && days.join() === '0,6') return `Weekends at ${clock(hour, minute)}`;
    if (days && days.length > 0) return `Every ${listOf(days.map((d) => WEEKDAYS[d]))} at ${clock(hour, minute)}`;
  }
  if (exact && month === '*' && weekday === '*' && WHOLE.test(day)) return `The ${ordinal(Number(day))} of every month at ${clock(hour, minute)}`;
  return `Cron ${expression}`;
}

/** Hermes's schedule record (`{ kind: 'interval' | 'cron' | 'once', … }`) in words. */
export function scheduleInWords(schedule: unknown, display?: string): string {
  if (!isRecord(schedule)) return display ?? 'No schedule';
  if (schedule.kind === 'interval' && typeof schedule.minutes === 'number' && schedule.minutes > 0) {
    const minutes = schedule.minutes;
    if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
    if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
    return plural(minutes, 'minute');
  }
  if (schedule.kind === 'cron' && typeof schedule.expr === 'string') return cronInWords(schedule.expr);
  if (schedule.kind === 'once' && typeof schedule.run_at === 'string') return `Once at ${schedule.run_at.slice(0, 16).replace('T', ' ')}`;
  return display ?? text(schedule.display) ?? 'No schedule';
}

/** The jobs of Hermes's list (`GET /api/cron/jobs?profile=all`). A row that is not a job is left out. */
export function parseJobs(body: unknown, blueprintTitles: readonly string[] = []): Job[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((entry): Job[] => {
    if (!isRecord(entry) || text(entry.id) === undefined) return [];
    const id = entry.id as string;
    const state = text(entry.state) ?? 'scheduled';
    const enabled = entry.enabled !== false && state !== 'paused';
    const age = entry.scheduler_heartbeat_age_s;
    return [
      {
        id,
        name: text(entry.name) ?? text(entry.prompt)?.slice(0, 50) ?? id,
        profile: text(entry.profile) ?? text(entry.profile_name) ?? 'default',
        type: jobType(entry, blueprintTitles),
        enabled,
        state,
        schedule: scheduleInWords(entry.schedule, text(entry.schedule_display)),
        scheduleExpression: text(entry.schedule_display) ?? (isRecord(entry.schedule) ? (text(entry.schedule.display) ?? '') : ''),
        nextRunAt: enabled ? instant(entry.next_run_at) : undefined,
        lastRunAt: instant(entry.last_run_at),
        lastStatus: text(entry.last_status),
        lastError: text(entry.last_error),
        schedulerAgeS: typeof age === 'number' ? age : undefined,
        config: entry,
      },
    ];
  });
}

/** Whether the scheduler is ticking, as the jobs' heartbeats say. `idle`: no job waits to run, so there is no tick to look for. */
export type SchedulerStatus =
  | { state: 'idle' }
  | { state: 'ok'; ageSeconds: number; waiting: number }
  | { state: 'stale'; ageSeconds: number; waiting: number }
  | { state: 'unknown'; waiting: number };

/** A paused or finished job needs no scheduler. */
export const waitsToRun = (job: Job): boolean => job.enabled && job.state !== 'completed';

/** Each profile has a ticker of its own, and a job carries its profile's heartbeat: the oldest of the jobs that wait is the one that is wrong. */
export function schedulerStatus(jobs: readonly Job[]): SchedulerStatus {
  const waiting = jobs.filter(waitsToRun);
  if (waiting.length === 0) return { state: 'idle' };
  const ages = waiting.flatMap((job) => (job.schedulerAgeS === undefined ? [] : [job.schedulerAgeS]));
  if (ages.length === 0) return { state: 'unknown', waiting: waiting.length };
  const ageSeconds = Math.max(...ages);
  return { state: ageSeconds > SCHEDULER_STALE_AFTER_S ? 'stale' : 'ok', ageSeconds, waiting: waiting.length };
}

/** The scheduler's state in a sentence, for the warning and for a bug report. */
export function schedulerSummary(status: SchedulerStatus): string {
  const jobs = (count: number) => (count === 1 ? '1 job is' : `${count} jobs are`);
  switch (status.state) {
    case 'idle':
      return 'idle; no job is waiting to run, so there is no tick to look for';
    case 'ok':
      return `ticking; the last tick was ${plainDuration(status.ageSeconds)} ago and ${jobs(status.waiting)} waiting to run`;
    case 'stale':
      return `not ticking; the last tick was ${plainDuration(status.ageSeconds)} ago, though it ticks every minute, and ${jobs(status.waiting)} waiting to run`;
    case 'unknown':
      return `no tick recorded yet; ${jobs(status.waiting)} waiting to run`;
  }
}

export const JOB_STATUSES = {
  active: 'Active',
  paused: 'Paused',
  failed: 'Last run failed',
  finished: 'Finished',
} as const;
export type JobStatusFilter = keyof typeof JOB_STATUSES;

/** The list's filters: each is one condition, and every one that is set must hold. */
export interface SchedulesView {
  profile?: string;
  type?: JobType;
  status?: JobStatusFilter;
}

const finished = (job: Job) => job.state === 'completed';

const STATUS_TEST: Record<JobStatusFilter, (job: Job) => boolean> = {
  active: waitsToRun,
  paused: (job) => !job.enabled && !finished(job),
  failed: (job) => job.lastStatus === 'error',
  finished,
};

export function selectJobs(jobs: readonly Job[], view: SchedulesView): Job[] {
  return jobs.filter((job) => (view.profile === undefined || job.profile === view.profile) && (view.type === undefined || job.type === view.type) && (view.status === undefined || STATUS_TEST[view.status](job)));
}

/** The job that fires next first; jobs with nothing due (paused, finished) after them, by name. */
export function sortJobs(jobs: readonly Job[]): Job[] {
  return [...jobs].sort((a, b) => (a.nextRunAt ?? Number.POSITIVE_INFINITY) - (b.nextRunAt ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name));
}

/**
 * The filter as the address holds it. `profile` is the shell's own query parameter (the tab's profile), so the profile a job belongs to
 * is `for`.
 */
export function schedulesSearch(view: SchedulesView): Record<string, string> {
  return { ...(view.profile ? { for: view.profile } : {}), ...(view.type ? { type: view.type } : {}), ...(view.status ? { status: view.status } : {}) };
}

/** The filter in an address; a value that is not one is left out. */
export function readSchedulesView(search: Record<string, unknown>): SchedulesView {
  const { for: profile, type, status } = search;
  return {
    ...(typeof profile === 'string' && profile.trim() !== '' ? { profile } : {}),
    ...(typeof type === 'string' && type in JOB_TYPES ? { type: type as JobType } : {}),
    ...(typeof status === 'string' && status in JOB_STATUSES ? { status: status as JobStatusFilter } : {}),
  };
}

/** How far `at` is from `now` (both milliseconds), as a card says it: "in 5 min", "3 h ago". */
export function relativeTime(at: number, now: number): string {
  const seconds = Math.abs(at - now) / 1000;
  if (seconds < 1) return 'now';
  return at > now ? `in ${plainDuration(seconds)}` : `${plainDuration(seconds)} ago`;
}
