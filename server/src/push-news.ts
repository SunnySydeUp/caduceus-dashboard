// What the push watcher tells a device of that is news and not a state to deal with: a reminder an agent set that has just come due (a Hermes one-time job that
// ran), and a Kanban task that reached Done. Neither is an Inbox item: a reminder that ran needs nothing, and a done task is offered on Today's Ready for review.
// Nothing is read here: the cron and Work sources of the Inbox hand on what they read (`onJobs`, `onBoards`), so this adds no ask of Hermes but the one for a
// reminder's words, once for each run. Nothing is kept either: what was sent is the push log's to remember (`push-watcher.ts`).
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { PushCategory } from '@caduceus/contracts/push';
import { isOneTimeJob } from '@caduceus/contracts/scheduler';
import type { HermesBackend } from './hermes-backend.ts';
import { taskCandidates, type BoardTasks } from './today-review.ts';

/** How old a finished task may be and still be sent: past it, it is no longer news. Well inside the push log's 30 days, so nothing is ever sent twice. */
export const NEWS_WINDOW_MS = 24 * 3_600_000;
/**
 * How late a reminder may be sent: as long as the push service keeps an urgent message for a device that is off. A reminder held back longer (a page in view, quiet
 * hours) would wake the owner for something already past, so it is not sent at all.
 */
export const REMINDER_WINDOW_MS = 3_600_000;
/** How long after Hermes failed to give a reminder's words they are asked for again. */
const RETRY_MS = 60_000;

/** One piece of news, as the watcher sends it. `to` is where a tap goes, from the page's root. */
export interface NewsItem {
  key: string;
  /** The source's own switch in a device's settings: `cron:<profile>:<job>` or `task:<board>:<id>`. */
  ref: string;
  category: Extract<PushCategory, 'reminders' | 'tasks'>;
  /** When it happened (ms since the epoch). */
  at: number;
  title: string;
  body: string;
  to: string;
  /** A reminder is due now: the device is woken for it, and it never waits for a digest. */
  urgent: boolean;
}

export interface PushNews {
  items(): NewsItem[];
  subscribe(listener: () => void): () => void;
  /** Hermes's list of jobs, as the cron source read it. */
  jobs(list: unknown): void;
  /** Every board and its tasks, as the Work source read them. */
  boards(list: readonly BoardTasks[]): void;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
const clip = (value: string, length: number): string => {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

/** A one-time job's run: the reminder came due. */
interface ReminderRun {
  key: string;
  profile: string;
  id: string;
  name: string;
  at: number;
  failed: string | undefined;
}

/** The reminders (one-time jobs) in Hermes's list that have run, one for each run. Pure. */
export function reminderRuns(jobs: unknown): ReminderRun[] {
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((job): ReminderRun[] => {
    if (!isRecord(job) || !isOneTimeJob(job)) return [];
    const id = text(job.id);
    const ranAt = text(job.last_run_at);
    const at = ranAt === undefined ? Number.NaN : Date.parse(ranAt);
    if (id === undefined || Number.isNaN(at)) return [];
    const profile = text(job.profile) ?? text(job.profile_name) ?? 'default';
    const failed = text(job.last_status) === 'error' ? (text(job.last_error) ?? 'it did not finish') : undefined;
    return [{ key: `reminder:${profile}:${id}|${ranAt}`, profile, id, name: text(job.name) ?? clip(text(job.prompt) ?? id, 60), at, failed }];
  });
}

/** The tasks that reached Done, as news. Pure. */
export function doneTaskNews(boards: readonly BoardTasks[]): NewsItem[] {
  return taskCandidates(boards).map((item) => ({ key: `done:${item.id}|${item.stamp}`, ref: item.id, category: 'tasks', at: item.at, title: clip(`Done: ${item.title}`, 100), body: clip(item.summary ?? item.profile ?? '', 300), to: item.to, urgent: false }));
}

/** What the agent said when the reminder ran, and its session: the last reply of the job's newest run (`GET /api/cron/jobs/{id}/runs`, then its messages). */
async function reminderWords(backend: HermesBackend, run: ReminderRun): Promise<{ words: string | undefined; session: string | undefined }> {
  const profile = `profile=${encodeURIComponent(run.profile)}`;
  const read = async (path: string): Promise<unknown> => {
    const res = await backend.fetch(path);
    if (!res.ok) throw new Error(`Hermes answered HTTP ${res.status}`);
    return res.json();
  };
  // Hermes lists a job's runs newest first.
  const runs = await read(`/api/cron/jobs/${encodeURIComponent(run.id)}/runs?${profile}&limit=1`);
  const [newest] = isRecord(runs) && Array.isArray(runs.runs) ? runs.runs : [];
  const session = isRecord(newest) ? text(newest.id) : undefined;
  // A script run has no session (its id names an output file): its job's name is the reminder.
  if (session === undefined || session.startsWith('cron_output:')) return { words: undefined, session: undefined };
  const body = await read(`/api/sessions/${encodeURIComponent(session)}/messages?${profile}`);
  const messages = isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
  const last = messages.findLast((message) => isRecord(message) && message.role === 'assistant' && text(message.content) !== undefined);
  return { words: isRecord(last) ? text(last.content) : undefined, session };
}

export function createPushNews({ backend, now }: { backend: HermesBackend; now: () => number }): PushNews {
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of listeners) listener();
  };
  /** The reminders whose words have been read, by run; `null` for one the agent kept silent. */
  const reminders = new Map<string, NewsItem | null>();
  const reading = new Set<string>();
  /** When reading a run's words last failed: it is tried again after `RETRY_MS`, not on every read of the jobs. */
  const failedAt = new Map<string, number>();
  let tasks: NewsItem[] = [];

  const read = async (run: ReminderRun): Promise<void> => {
    reading.add(run.key);
    let item: NewsItem | null;
    try {
      const { words, session } = await reminderWords(backend, run);
      const to = session === undefined ? '/today' : `/chat/${encodeURIComponent(session)}?${new URLSearchParams({ profile: run.profile })}`;
      // `[SILENT]` is the agent saying there is nothing to tell (Hermes's cron contract): nothing is sent.
      item = words?.trim() === '[SILENT]' ? null : { key: run.key, ref: `cron:${run.profile}:${run.id}`, category: 'reminders', at: run.at, title: clip(run.name, 100), body: clip(run.failed ? `${run.profile} could not finish it: ${run.failed}` : (words ?? run.name), 300), to, urgent: true };
    } catch {
      failedAt.set(run.key, now());
      return;
    } finally {
      reading.delete(run.key);
    }
    failedAt.delete(run.key);
    reminders.set(run.key, item);
    if (item) tell();
  };

  return {
    items: () => [...[...reminders.values()].filter((item): item is NewsItem => item !== null && item.at >= now() - REMINDER_WINDOW_MS), ...tasks.filter((item) => item.at >= now() - NEWS_WINDOW_MS)],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    jobs(list) {
      const runs = reminderRuns(list).filter((run) => run.at >= now() - REMINDER_WINDOW_MS);
      const current = new Set(runs.map((run) => run.key));
      for (const key of reminders.keys()) if (!current.has(key)) reminders.delete(key);
      for (const key of failedAt.keys()) if (!current.has(key)) failedAt.delete(key);
      for (const run of runs) {
        if (reminders.has(run.key) || reading.has(run.key) || now() - (failedAt.get(run.key) ?? -Infinity) < RETRY_MS) continue;
        void read(run);
      }
    },
    boards(list) {
      tasks = doneTaskNews(list).filter((item) => item.at >= now() - NEWS_WINDOW_MS);
      tell();
    },
  };
}
