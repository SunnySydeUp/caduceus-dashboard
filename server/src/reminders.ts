// Today's reminders: the owner's Apple Reminders that have a due date, read from the `remindctl` command, and the reminders an agent set (Hermes's one-time jobs).
// Every command line is a fixed list of arguments (no shell is involved): `export`, which only prints, and, when the owner marks Overdue reminders done from Today,
// `complete` and its undo `edit --incomplete`, which name only reminders `export` has just listed. What comes back is cut down to the six things the calendar shows: a
// reminder's notes, URL and list id, and a job's prompt, never leave this file. Nothing is stored: every ask runs the command and reads Hermes's jobs (answers that
// overlap share one run), because Reminders and Hermes are the sources of truth.
import { execFile } from 'node:child_process';
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { Reminder, RemindersFailure, RemindersFailureReason, RemindersState } from '@caduceus/contracts/today';
import { isOneTimeJob } from '@caduceus/contracts/scheduler';
import type { HermesBackend } from './hermes-backend.ts';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { AuditLog } from './audit-log.ts';
import { gateRequest } from './policy-gate.ts';
import type { RestPolicy } from './policy.ts';
import { clipWords } from '@caduceus/contracts/clip-words';

/** What is run: `remindctl export --json`, which includes completed reminders. Fixed on purpose. */
const ARGUMENTS = ['export', '--json', '--no-input', '--no-color'] as const;
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 16 * 1024 * 1024;
/** How long a completed reminder stays on the calendar; an open one stays however late it is. */
const COMPLETED_KEPT_MS = 90 * 24 * 60 * 60 * 1000;
/** The most reminders sent to the page. */
const MAX_REMINDERS = 2000;
/** The command is found on the PATH, and where Homebrew puts it, because the background service starts with a short PATH. */
const EXTRA_PATH = '/opt/homebrew/bin:/usr/local/bin';
/** The environment the command gets: enough to find its way and to name days in the Mac's time zone; none of Caduceus's own. */
const ENV_KEPT = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ'] as const;

/** The reminders could not be read: why, and the words for the owner. */
export class RemindersUnavailable extends Error {
  readonly reason: RemindersFailureReason;
  constructor(reason: RemindersFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** The calendar day (`YYYY-MM-DD`) a time falls on in this machine's time zone. */
function localDay(time: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${time.getFullYear()}-${two(time.getMonth() + 1)}-${two(time.getDate())}`;
}

/**
 * Turns what `remindctl export --json` printed into the list the page shows: reminders with a due date, soonest first, without notes or anything else.
 * An entry it cannot make sense of is left out and does not spoil the rest. Throws `RemindersUnavailable('unreadable')` when the output is not a list.
 */
export function parseReminders(stdout: string, now: number): Reminder[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new RemindersUnavailable('unreadable', 'remindctl did not print a list of reminders.');
  }
  if (!Array.isArray(parsed)) throw new RemindersUnavailable('unreadable', 'remindctl did not print a list of reminders.');
  const reminders: Reminder[] = [];
  for (const raw of parsed as unknown[]) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '' || typeof raw.title !== 'string' || typeof raw.dueDate !== 'string') continue;
    const due = new Date(raw.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    const completed = raw.isCompleted === true;
    if (completed && due.getTime() < now - COMPLETED_KEPT_MS) continue;
    const allDay = raw.dueDateIsAllDay === true;
    reminders.push({ id: raw.id, title: raw.title, list: typeof raw.listName === 'string' ? raw.listName : '', due: raw.dueDate, allDay, day: allDay ? localDay(due) : undefined, completed });
  }
  return soonestFirst(reminders);
}

const soonestFirst = (reminders: Reminder[]): Reminder[] => reminders.sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || a.id.localeCompare(b.id)).slice(0, MAX_REMINDERS);

/**
 * The reminders an agent set: Hermes's one-time jobs (`GET /api/cron/jobs?profile=all`), due when the job is to run, done once it has run, under the agent's name.
 * Only the name and the time leave this file: never the prompt. A routine (a job that repeats) is not a reminder.
 */
export function agentReminders(jobs: unknown, now: number): Reminder[] {
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((job): Reminder[] => {
    if (!isRecord(job) || !isOneTimeJob(job) || !isRecord(job.schedule) || typeof job.id !== 'string' || job.id === '') return [];
    const due = [job.schedule.run_at, job.next_run_at, job.last_run_at].find((value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
    if (due === undefined) return [];
    // A reminder the owner paused is not due; one that ran is done (Hermes then marks it off: `enabled` false, `state` completed).
    if (job.state === 'paused') return [];
    const completed = typeof job.last_run_at === 'string' || job.state === 'completed';
    if (completed && Date.parse(due) < now - COMPLETED_KEPT_MS) return [];
    const agent = typeof job.profile === 'string' && job.profile !== '' ? job.profile : 'default';
    const title = typeof job.name === 'string' && job.name.trim() !== '' ? job.name : 'A reminder';
    return [{ id: `hermes:${agent}:${job.id}`, title, list: agent, agent, due, allDay: false, day: undefined, completed }];
  });
}

interface RunFailure {
  code?: string | number;
  killed?: boolean;
  signal?: string | null;
  stderr?: string;
}

/** Runs the command with `args` and resolves with what it printed. Rejects with `RemindersUnavailable`. */
function run(command: string, args: readonly string[] = ARGUMENTS): Promise<string> {
  const done = Promise.withResolvers<string>();
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENV_KEPT) if (process.env[name] !== undefined) env[name] = process.env[name];
  env.PATH = `${env.PATH ?? '/usr/bin:/bin'}:${EXTRA_PATH}`;
  const child = execFile(command, [...args], { env, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (!error) return done.resolve(stdout);
    const failure = error as RunFailure;
    if (failure.code === 'ENOENT') return done.reject(new RemindersUnavailable('not-installed', 'remindctl is not installed on this Mac. Install it with: brew install steipete/tap/remindctl'));
    if (failure.killed === true || failure.signal === 'SIGTERM') return done.reject(new RemindersUnavailable('timeout', 'remindctl did not answer in time.'));
    // Its first line of complaint says what is wrong; the rest of its output is not passed on, and the line is cut at a whole word. A denial of access is said in Caduceus's own
    // words, with the step that allows it, because remindctl's own words for it run long and are cut before their end.
    const first = stderr.split('\n')[0]?.trim() ?? '';
    if (/access denied|not authori[sz]ed/i.test(first)) {
      return done.reject(new RemindersUnavailable('denied', 'This Mac has not allowed Caduceus to read Reminders. Allow it in System Settings › Privacy & Security › Reminders, or run “remindctl authorize” on the Mac.'));
    }
    const complaint = clipWords(first, 200);
    done.reject(new RemindersUnavailable('failed', complaint ? `remindctl failed: ${complaint}` : 'remindctl failed. Run "remindctl status" on the Mac to check its access to Reminders.'));
  });
  // It is asked for nothing: its input is closed.
  child.stdin?.end();
  return done.promise;
}

export interface RemindersDeps {
  /** The command to run; `remindctl`, found on the PATH, by default. A test gives the path of a stand-in. */
  command?: string;
  /** Hermes, whose one-time jobs are the reminders an agent set. */
  backend: HermesBackend;
  /** Judges and audits marking reminders done and undoing it (`contracts/policy/owned.ts`). */
  policy: RestPolicy;
  audit: AuditLog;
  now: () => number;
}

/** The most reminders one change names (all of Overdue at once). */
const MAX_CHANGED = 100;
const MAX_CHANGE_BODY = 16 * 1024;
/** The fixed part of each change; the ids go last, after every option. `edit` takes one reminder at a time. */
const COMPLETE = ['complete', '--no-input', '--no-color'] as const;
const REOPEN = ['edit', '--incomplete', '--no-input', '--no-color'] as const;

/**
 * The ids of a change's body: Apple Reminders ids only (an agent's reminder is a Hermes job, done when it runs), never one that could read as an option or, all
 * digits, as remindctl's index of a row instead of an id.
 */
function changedIds(body: unknown): string[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_CHANGED) return undefined;
  const ids = body.ids.filter((id): id is string => typeof id === 'string' && id !== '' && id.length <= 256 && !id.startsWith('-') && !/^\d+$/.test(id) && !id.startsWith('hermes:'));
  return ids.length === body.ids.length ? [...new Set(ids)] : undefined;
}

/** The ids of every reminder Reminders holds, open or done, as `remindctl export` lists them. */
function exportedIds(stdout: string): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new RemindersUnavailable('unreadable', 'remindctl did not print a list of reminders.');
  }
  if (!Array.isArray(parsed)) throw new RemindersUnavailable('unreadable', 'remindctl did not print a list of reminders.');
  return new Set(parsed.flatMap((raw) => (isRecord(raw) && typeof raw.id === 'string' ? [raw.id] : [])));
}

/** Hermes's list of jobs. Throws when Hermes does not answer. */
async function readJobs(backend: HermesBackend): Promise<unknown> {
  const res = await backend.fetch('/api/cron/jobs?profile=all');
  if (!res.ok) throw new Error(`Hermes answered HTTP ${res.status}`);
  return res.json();
}

export function mountReminders(app: Hono<AuthEnv>, { command = 'remindctl', backend, policy, audit, now }: RemindersDeps): void {
  let running: Promise<string> | undefined;
  const exported = () => (running ??= run(command).finally(() => (running = undefined)));

  /**
   * Marks reminders done (`complete`) or not done again (`reopen`, the undo). Each id is checked against what Reminders holds now, so the command is only ever told of
   * a reminder that exists, by its whole id, after its fixed options.
   */
  const change = (route: 'complete' | 'reopen') =>
    app.post(`/_caduceus/api/today/reminders/${route}`, async (c) => {
      const gated = await gateRequest(policy, c, 'POST', MAX_CHANGE_BODY);
      if ('refusal' in gated) return gated.refusal;
      const ids = changedIds(gated.body);
      if (!ids) return c.json({ error: 'bad-request' }, 400);
      try {
        const known = exportedIds(await exported());
        if (ids.some((id) => !known.has(id))) return c.json({ error: 'not-found', message: 'Reminders has no such reminder. It may have been deleted on another device.' }, 404);
        // A T0 is not audited by the policy; a change to the owner's own Reminders is, by how many and never by what (no ids, no titles).
        audit.record({ actor: 'owner', action: `today.reminders-${route}`, target: `${ids.length} reminder${ids.length === 1 ? '' : 's'}`, source: authClient(c).source, tier: 'T0' });
        if (route === 'complete') await run(command, [...COMPLETE, ...ids]);
        else for (const id of ids) await run(command, [...REOPEN, id]);
      } catch (error) {
        if (error instanceof RemindersUnavailable) return c.json({ error: 'reminders-unavailable', reason: error.reason, message: error.message } satisfies RemindersFailure, 503);
        throw error;
      }
      return c.json({ ok: true });
    });
  change('complete');
  change('reopen');

  app.get('/_caduceus/api/today/reminders', async (c) => {
    // Asks that overlap (two tabs, a reload) share one run of the command.
    const started = exported();
    const jobs = readJobs(backend).then(
      (list) => agentReminders(list, now()),
      // Hermes not answering is said by Today's Hermes blocks and its banner; the Apple Reminders, read from this Mac, are still worth showing.
      (): Reminder[] => [],
    );
    try {
      return c.json({ reminders: soonestFirst([...parseReminders(await started, now()), ...(await jobs)]) } satisfies RemindersState);
    } catch (error) {
      if (error instanceof RemindersUnavailable) return c.json({ error: 'reminders-unavailable', reason: error.reason, message: error.message } satisfies RemindersFailure, 503);
      throw error;
    }
  });
}
