// Today's reminders: the owner's Apple Reminders that have a due date, read from the `remindctl` command. Read-only by construction: the command line is a fixed
// list of arguments (nothing of a request reaches it, and no shell is involved), it is `export`, which only prints, and what comes back is cut down to the six
// things the calendar shows. A reminder's notes, URL and list id never leave this file. Nothing is stored: every ask runs the command (answers that overlap share
// one run), because Reminders is the source of truth and Hermes has no event for it.
import { execFile } from 'node:child_process';
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { Reminder, RemindersFailure, RemindersFailureReason, RemindersState } from '@caduceus/contracts/today';
import type { AuthEnv } from './auth-routes.ts';
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
  return reminders.sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || a.id.localeCompare(b.id)).slice(0, MAX_REMINDERS);
}

interface RunFailure {
  code?: string | number;
  killed?: boolean;
  signal?: string | null;
  stderr?: string;
}

/** Runs the command and resolves with what it printed. Rejects with `RemindersUnavailable`. */
function run(command: string): Promise<string> {
  const done = Promise.withResolvers<string>();
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENV_KEPT) if (process.env[name] !== undefined) env[name] = process.env[name];
  env.PATH = `${env.PATH ?? '/usr/bin:/bin'}:${EXTRA_PATH}`;
  const child = execFile(command, [...ARGUMENTS], { env, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (!error) return done.resolve(stdout);
    const failure = error as RunFailure;
    if (failure.code === 'ENOENT') return done.reject(new RemindersUnavailable('not-installed', 'remindctl is not installed on this Mac. Install it with: brew install steipete/tap/remindctl'));
    if (failure.killed === true || failure.signal === 'SIGTERM') return done.reject(new RemindersUnavailable('timeout', 'remindctl did not answer in time.'));
    // Its first line of complaint says what is wrong (no access to Reminders, say); the rest of its output is not passed on, and the line is cut at a whole word.
    const complaint = clipWords(stderr.split('\n')[0]?.trim() ?? '', 200);
    done.reject(new RemindersUnavailable('failed', complaint ? `remindctl failed: ${complaint}` : 'remindctl failed. Run "remindctl status" on the Mac to check its access to Reminders.'));
  });
  // It is asked for nothing: its input is closed.
  child.stdin?.end();
  return done.promise;
}

export interface RemindersDeps {
  /** The command to run; `remindctl`, found on the PATH, by default. A test gives the path of a stand-in. */
  command?: string;
  now: () => number;
}

export function mountReminders(app: Hono<AuthEnv>, { command = 'remindctl', now }: RemindersDeps): void {
  let running: Promise<string> | undefined;
  app.get('/_caduceus/api/today/reminders', async (c) => {
    // Asks that overlap (two tabs, a reload) share one run of the command.
    const started = (running ??= run(command).finally(() => (running = undefined)));
    try {
      return c.json({ reminders: parseReminders(await started, now()) } satisfies RemindersState);
    } catch (error) {
      if (error instanceof RemindersUnavailable) return c.json({ error: 'reminders-unavailable', reason: error.reason, message: error.message } satisfies RemindersFailure, 503);
      throw error;
    }
  });
}
