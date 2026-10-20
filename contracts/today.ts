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
