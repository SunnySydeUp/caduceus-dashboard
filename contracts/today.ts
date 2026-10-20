// Today's API (`/_caduceus/api/today`), shared by the Caduceus server and the web app (M8 #03). Hermes says what finished; Caduceus owns the one concept Hermes
// lacks, "ready for review": work that is done and has not been opened since. The server derives the list on every ask and stores only which items were opened.

/** What an item that is ready for review is: a Kanban task that reached Done, or a chat run that finished. */
export type ReadyKind = 'task' | 'run';

/** One finished piece of work waiting for the owner's look. Nothing here is stored; it is read from Hermes each time. */
export interface ReadyItem {
  /** What the owner's opening is kept against: `task:<board>:<task id>` or `run:<stored session id>`. */
  id: string;
  /** Changes when the finish changes again (a task done a second time, a chat that answered again), so an item that was opened comes back as new work. */
  stamp: string;
  kind: ReadyKind;
  title: string;
  /** What Hermes says of the result, in a line or two. */
  summary: string | undefined;
  /** The profile it belongs to; `undefined` when Hermes names none. */
  profile: string | undefined;
  /** When it finished (ms since the epoch). */
  at: number;
  /** Where in Caduceus it opens. */
  to: string;
}

/** `GET /_caduceus/api/today/ready`: what is ready for review, newest first. */
export interface ReadyState {
  items: ReadyItem[];
}

/** The body of `POST /_caduceus/api/today/ready/opened`: the owner opened this item as it stood at `stamp`. */
export interface ReadyOpened {
  id: string;
  stamp: string;
}

/**
 * `POST /_caduceus/api/today/visit`: the owner opened Today. `since` is when they last opened it before this time they were away (`null` on the first visit);
 * opening it again soon after is the same visit, so a reload does not empty "While you were away". `at` is this visit's time.
 */
export interface TodayVisit {
  since: number | null;
  at: number;
}

/** One Apple Reminder that has a due date, as `remindctl` reports it. Read-only: Caduceus never adds, completes or deletes a reminder. */
export interface Reminder {
  /** Reminders's own id for it. */
  id: string;
  title: string;
  /** The Reminders list it belongs to. */
  list: string;
  /** When it is due (an ISO 8601 instant). A reminder with a time is placed on the day that instant falls on where the page is read. */
  due: string;
  /** Due on a day and not at a time of it. */
  allDay: boolean;
  /** For an all-day reminder: the calendar day it is due (`YYYY-MM-DD`), as the Mac that reads Reminders names it, so that a device in another time zone does not move it to the day before or after. */
  day: string | undefined;
  completed: boolean;
}

/** `GET /_caduceus/api/today/reminders`: the owner's dated reminders, soonest first. Open ones are all there; completed ones only from the last 90 days. */
export interface RemindersState {
  reminders: Reminder[];
}

/** Why the reminders could not be read; the answer is HTTP 503 with this, and never carries more of `remindctl` than its first line of complaint. */
export type RemindersFailureReason = 'not-installed' | 'timeout' | 'failed' | 'unreadable';

export interface RemindersFailure {
  error: 'reminders-unavailable';
  reason: RemindersFailureReason;
  message: string;
}
