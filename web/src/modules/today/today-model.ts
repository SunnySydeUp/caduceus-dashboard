// What Today makes of what Hermes and Caduceus already say (M8 #03): the day's schedule from Hermes's cron jobs, the away list from the activity feed and the
// jobs' last runs, the ready list, the decisions and the empty states. Today is always every profile's, so nothing here filters by profile. Pure: no DOM, no React
// and nothing kept (D1).
import type { ActivityEvent, InboxItem } from '@caduceus/contracts/inbox';
import type { ReadyItem } from '@caduceus/contracts/today';
import { sigilFor } from '../../shell/sigil-model.ts';
import { relativeTime, type Job } from '../work/schedules-model.ts';

/** How a run stands on the schedule: still to come, run, or run and failed. The bar draws each with a shape of its own, and the list says it in words. */
export type RunKind = 'next' | 'ran' | 'failed';

/** One mark on the bar: where in the day (0 to 1), how it stands and the hue of its profile's sigil (1 to 7). */
export interface BarMarker {
  id: string;
  at: number;
  kind: RunKind;
  hue: number;
}

/** One line under the bar. */
export interface DayRow {
  id: string;
  /** When it runs or ran (ms since the epoch). */
  when: number;
  kind: RunKind;
  name: string;
  profile: string;
  line: string;
}

export interface ScheduleView {
  /** Where the day has got to, 0 at midnight and 1 at the next midnight. */
  now: number;
  markers: BarMarker[];
  rows: DayRow[];
  /** The soonest run still to come, on any day, so that a day with no runs can say what is next; `undefined` when no routine is scheduled. */
  nextRoutine: { name: string; profile: string; when: number } | undefined;
}

/** The device's own midnight before `time` and the one after it (a day is 23 or 25 hours long where the clocks change). */
function dayAround(time: number): { start: number; end: number } {
  const start = new Date(time);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

const short = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= 80 ? flat : `${flat.slice(0, 79).trimEnd()}…`;
};

/**
 * The day around `now` as a 24-hour bar and a list: each job's last run and its next run, where they fall today. Hermes keeps one of each on the job, so a
 * routine that fires many times a day shows its latest and its coming one. Runs still to come are listed first (soonest first), then those that ran (latest first).
 */
export function scheduleDay(jobs: readonly Job[], now: number): ScheduleView {
  const { start, end } = dayAround(now);
  const place = (time: number) => (time - start) / (end - start);
  const today = (time: number | undefined): time is number => time !== undefined && time >= start && time < end;
  const markers: BarMarker[] = [];
  const rows: DayRow[] = [];
  for (const job of jobs) {
    const hue = sigilFor(job.profile).hue;
    const key = `${job.profile}:${job.id}`;
    if (today(job.lastRunAt)) {
      const kind: RunKind = job.lastStatus === 'error' ? 'failed' : 'ran';
      markers.push({ id: `${key}:ran`, at: place(job.lastRunAt), kind, hue });
      rows.push({ id: `${key}:ran`, when: job.lastRunAt, kind, name: job.name, profile: job.profile, line: kind === 'failed' ? `Failed: ${short(job.lastError ?? 'it did not finish')}` : 'Ran' });
    }
    if (job.enabled && today(job.nextRunAt)) {
      markers.push({ id: `${key}:next`, at: place(job.nextRunAt), kind: 'next', hue });
      rows.push({ id: `${key}:next`, when: job.nextRunAt, kind: 'next', name: job.name, profile: job.profile, line: `Next run ${relativeTime(job.nextRunAt, now)}` });
    }
  }
  const coming = rows.filter((row) => row.kind === 'next').sort((a, b) => a.when - b.when);
  const past = rows.filter((row) => row.kind !== 'next').sort((a, b) => b.when - a.when);
  // The soonest run still to come on any day: what an empty day can say is next.
  const [soonest] = jobs.filter((job) => job.enabled && job.nextRunAt !== undefined && job.nextRunAt > now).sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0));
  const nextRoutine = soonest?.nextRunAt === undefined ? undefined : { name: soonest.name, profile: soonest.profile, when: soonest.nextRunAt };
  return { now: place(now), markers: markers.sort((a, b) => a.at - b.at), rows: [...coming, ...past], nextRoutine };
}

/** What an empty schedule says when routines exist but none runs today: which one is next. `undefined` when there is none to name, and the usual words stand. */
export function scheduleEmptyText(view: ScheduleView, now: number): string | undefined {
  return view.nextRoutine && `No routines run today. Next: ${view.nextRoutine.name}, ${relativeTime(view.nextRoutine.when, now)}.`;
}

/** One line of "While you were away": a run that finished, or a routine that ran. `to` is where a run's chat opens. */
export interface AwayRow {
  id: string;
  /** When it finished (ms since the epoch). */
  at: number;
  kind: 'run' | 'routine';
  profile: string | undefined;
  title: string;
  line: string;
  /** A failed routine says so in words and is marked, so no screen tells it by colour alone. */
  failed: boolean;
  to: string | undefined;
}

/** What the block shows: nothing to be away from yet (the first visit), nothing happened, or the newest rows and how many more there are. */
export type AwayView = { kind: 'first-visit' } | { kind: 'quiet' } | { kind: 'rows'; rows: AwayRow[]; more: number };

/** How many rows the block shows before it says how many more there are. */
export const AWAY_SHOWN = 6;

export interface AwayInput {
  /** When the owner last opened Today before this time (`null` on the first visit). */
  since: number | null;
  now: number;
  /** The runs that finished, from the Inbox's activity feed. */
  activity: readonly ActivityEvent[];
  /** Hermes's cron jobs. Each says when it last ran and how it went. */
  jobs: readonly Job[];
}

/** What happened since the owner last opened Today, newest first: the runs that finished (the activity feed) and the routines that ran (Hermes's cron). Nothing else. */
export function awayView({ since, now, activity, jobs }: AwayInput): AwayView {
  if (since === null) return { kind: 'first-visit' };
  const runs = activity
    .filter((event) => event.at > since && event.at <= now)
    .map((event): AwayRow => ({ id: `run:${event.seq}`, at: event.at, kind: 'run', profile: event.profile, title: event.title, line: 'Finished', failed: false, to: event.storedSessionId === undefined ? undefined : `/chat/${encodeURIComponent(event.storedSessionId)}${event.profile === undefined ? '' : `?${new URLSearchParams({ profile: event.profile })}`}` }));
  const routines = jobs.flatMap((job): AwayRow[] => {
    if (job.lastRunAt === undefined || job.lastRunAt <= since || job.lastRunAt > now) return [];
    const failed = job.lastStatus === 'error';
    return [{ id: `routine:${job.profile}:${job.id}`, at: job.lastRunAt, kind: 'routine', profile: job.profile, title: job.name, line: failed ? `Failed: ${short(job.lastError ?? 'it did not finish')}` : 'Ran', failed, to: undefined }];
  });
  const rows = [...runs, ...routines].sort((a, b) => b.at - a.at);
  return rows.length === 0 ? { kind: 'quiet' } : { kind: 'rows', rows: rows.slice(0, AWAY_SHOWN), more: Math.max(0, rows.length - AWAY_SHOWN) };
}

/** One row of "Ready for review": what Hermes says of the result, in a line, and where it opens. */
export interface ReadyRow {
  id: string;
  stamp: string;
  kind: ReadyItem['kind'];
  title: string;
  line: string;
  profile: string | undefined;
  at: number;
  to: string;
}

/** The ready items of every profile, as rows. The server has put them newest first. */
export function readyRows(items: readonly ReadyItem[]): ReadyRow[] {
  return items.map(({ id, stamp, kind, title, summary, profile, at, to }) => ({ id, stamp, kind, title, line: summary ?? (kind === 'task' ? 'Task finished' : 'Run finished'), profile, at, to }));
}

/** Every item that needs a decision, in every profile, the longest wait first. */
export function decisionsFor(items: readonly InboxItem[]): InboxItem[] {
  return items.filter((item) => item.group === 'decision').sort((a, b) => a.at - b.at);
}

/** Who asks and what for, as the head of a card says it: "coder wants to run a command". */
export function askedBy(item: InboxItem): { who: string; what: string } {
  const who = item.profile ?? 'An agent';
  if (item.kind === 'approval') return { who, what: 'wants to run a command' };
  if (item.kind === 'clarify') return { who, what: item.questions.length === 1 && (item.questions[0]?.choices.length ?? 0) > 0 ? 'needs a choice' : 'is asking' };
  return { who, what: 'needs a decision' };
}

export type EmptyBlock = 'needs' | 'ready' | 'schedule' | 'away-first' | 'away-quiet' | 'crew';

/** The module an empty block's action opens, and the part of its address after the module's own (`/new`: the create screen, not the list). */
interface EmptyAction {
  label: string;
  module: 'chat' | 'tasks' | 'schedules' | 'profiles';
  suffix?: string;
}

/** What an empty block says and the one action that fills it. A label that promises to do something opens the screen where it is done. */
export const EMPTY: Record<EmptyBlock, { text: string; action: EmptyAction }> = {
  needs: { text: 'Nothing needs you right now. When an agent needs a decision, it shows here.', action: { label: 'Talk to an agent', module: 'chat' } },
  ready: { text: 'Nothing is waiting for your review. Finished tasks, runs and routines show here until you open them.', action: { label: 'Give the crew work', module: 'tasks', suffix: '/new' } },
  schedule: { text: 'No routines run today. A routine you schedule shows here, with when it runs next.', action: { label: 'Schedule a routine', module: 'schedules', suffix: '/new' } },
  'away-first': { text: 'This is your first visit to Today. Runs and routines that finish while you are away show here.', action: { label: 'See the schedule', module: 'schedules' } },
  'away-quiet': { text: 'Nothing happened while you were away.', action: { label: 'Schedule a routine', module: 'schedules', suffix: '/new' } },
  crew: { text: 'No agents yet. Each Hermes profile is an agent of your crew.', action: { label: 'Add a profile', module: 'profiles' } },
};

/** Where an empty block's action leads: its module's address, read from the registry by `pathOf`, then the screen the label promises. */
export function emptyTarget(which: EmptyBlock, pathOf: (module: EmptyAction['module']) => string | undefined): string {
  const { module, suffix = '' } = EMPTY[which].action;
  const path = pathOf(module);
  return path === undefined ? '/' : `${path}${suffix}`;
}

/** How many failures Today lists before it says how many more there are: a bad night must not push the decisions off the screen. */
export const LOOK_SHOWN = 3;

/** One failure that needs a look: what failed, why in a line, and where it can be dealt with. */
export interface LookRow {
  id: string;
  title: string;
  line: string | undefined;
  profile: string | undefined;
  at: number;
  /** Where it opens: the task or the job, else Notices. */
  to: string;
}

/** The failed work and jobs (a task that gave up, a run that stopped, a routine that failed), newest first. A decision or a piece of news is not a failure. */
export function needsALook(items: readonly InboxItem[]): { rows: LookRow[]; more: number } {
  const failures = items.flatMap((item): LookRow[] => (item.kind === 'notice' && item.group === 'failed' ? [{ id: item.id, title: item.title, line: item.detail, profile: item.profile, at: item.at, to: item.link?.to ?? '/notices' }] : []));
  failures.sort((a, b) => b.at - a.at);
  return { rows: failures.slice(0, LOOK_SHOWN), more: Math.max(0, failures.length - LOOK_SHOWN) };
}
