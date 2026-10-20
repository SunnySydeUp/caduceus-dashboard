// The Inbox's API (`/_caduceus/api/inbox`), shared by the Caduceus server, which derives the items from what Hermes is waiting
// on, and the web app, which shows them (M2). An item is a view of one Hermes state and is never stored.

/** How an item is grouped: it needs an answer, something failed, or it is for information. Only `decision` counts on the badge. */
export type InboxGroup = 'decision' | 'failed' | 'fyi';

/** What an item is about, for the category filter. A module that adds a source adds its category here. */
export type InboxCategory = 'approvals' | 'questions' | 'pairing' | 'automation' | 'work' | 'system' | 'budget';

/** The categories as the filter names them, in the order it lists them. */
export const INBOX_CATEGORIES: Readonly<Record<InboxCategory, string>> = {
  approvals: 'Approvals',
  questions: 'Questions',
  pairing: 'Pairing',
  automation: 'Automation',
  work: 'Work',
  system: 'System',
  budget: 'Budget',
};

/** What Hermes lets the owner answer to a tool approval. */
export type InboxApprovalChoice = 'once' | 'session' | 'always' | 'deny';

/** One question of a clarify request; `qid` (`q0`, `q1`, …) is what the answers are keyed by. */
export interface InboxQuestion {
  qid: string;
  question: string;
  /** What the agent offers to pick from; none for an open question. */
  choices: string[];
  multiSelect: boolean;
}

/** What every item says, whatever it is about. */
interface InboxItemCore {
  /** Stable while the Hermes state it shows lasts, and what `/inbox/:id` names. */
  id: string;
  /** The Hermes thing the item is about (`cron:work:abc123`): what a snooze or a dismissal is kept against. */
  ref: string;
  /** Changes when the Hermes state of `ref` changes again (a job's next failure has a new one): a dismissed item comes back with it. */
  stamp: string;
  group: InboxGroup;
  category: InboxCategory;
  /** The profile it belongs to; `undefined` when it has none or Caduceus could not tell. */
  profile: string | undefined;
  /** When Caduceus first saw it (ms since the epoch). */
  at: number;
}

/** What an item of a live chat adds. */
interface InboxItemBase extends InboxItemCore {
  /** The runtime id of the live session that is waiting. */
  sessionId: string;
  /** The stored id of that session (`/chat/:id`), when Hermes names it. */
  storedSessionId: string | undefined;
  /** The session's title, or its first words. */
  sessionTitle: string;
}

/** A tool approval Hermes holds: the exact command, and the answers it offers. */
export interface InboxApproval extends InboxItemBase {
  kind: 'approval';
  group: 'decision';
  /** The tool the model called, when Hermes names it. */
  tool: string | undefined;
  command: string;
  description: string;
  choices: InboxApprovalChoice[];
}

/** A question the agent asked (`clarify`). */
export interface InboxClarify extends InboxItemBase {
  kind: 'clarify';
  group: 'decision';
  /** One to five questions, answered together; a single question is a list of one. */
  questions: InboxQuestion[];
  /** When Hermes stops waiting for an answer (ms since the epoch), or `undefined` when it waits for ever. */
  expiresAt: number | undefined;
}

/** A thing the owner can do about a notice with one tap: a call to Hermes, which the page makes through the policy proxy so it carries the route's tier. */
export interface InboxAction {
  id: string;
  label: string;
  request: { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: Record<string, unknown> };
  /** What the confirmation dialog says, for a route that has one (T1 and above). */
  confirm?: { title: string; text?: string; object?: string; confirmLabel?: string };
  /** The one the card leads with. */
  primary?: boolean;
  /** Words the owner writes first (a rejection's note, an answer, a profile): the page asks for them, in a sheet that sits above the soft keyboard, and sends them as `body[field]`. */
  input?: { field: string; label: string; required: boolean };
}

/** Something Hermes or Caduceus says that is not a live chat's request: a failed job, a pairing request, a gateway that is down. */
export interface InboxNotice extends InboxItemCore {
  kind: 'notice';
  title: string;
  detail: string | undefined;
  actions: InboxAction[];
  /** Where in Caduceus to look, when that is not one of the actions. */
  link: { label: string; to: string } | undefined;
}

export type InboxItem = InboxApproval | InboxClarify | InboxNotice;

/** One finished run, a line of the activity feed. `seq` grows with every event, and a device's cursor is the last one it has seen. */
export interface ActivityEvent {
  seq: number;
  /** When the run finished (ms since the epoch). */
  at: number;
  profile: string | undefined;
  /** The stored id of the session (`/chat/:id`). */
  storedSessionId: string | undefined;
  title: string;
}

/** One live chat run: a turn Hermes is working on, or one stopped on a question or an approval for the owner. Work and the crew read them. */
export interface LiveRun {
  /** The runtime id of the live session: what Hermes's own session calls take. */
  sessionId: string;
  /** The stored id of the session (`/chat/:id`), when Hermes names it. */
  storedSessionId: string | undefined;
  title: string;
  /** The profile that owns the session; `undefined` when Caduceus could not tell. */
  profile: string | undefined;
  /** `waiting`: the run is stopped on a decision of the owner's (it is in the Inbox as well). */
  status: 'running' | 'waiting';
  /** When the turn started (ms since the epoch): Hermes stamps a session when a turn begins and leaves it until the next. */
  since: number;
  /** A background run Hermes started on its own agent (the composer's Delegate, `/background`): it has no live session to steer or stop, and its stored id is the run's own. */
  background?: true;
}

/** An item this device has put aside, with when it comes back (`until`: a snooze); a dismissed item is not listed. */
export interface InboxSnoozed {
  item: InboxItem;
  until: number;
}

/** `GET /_caduceus/api/inbox`, and every `inbox` event of `GET /_caduceus/api/inbox/stream`: what this device's Inbox is now. */
export interface InboxState {
  /** The items this device has not put aside, newest first. */
  items: InboxItem[];
  /** How many of them need a decision: what the badges show. */
  needsDecision: number;
  /** What this device has snoozed, and when each comes back. */
  snoozed: InboxSnoozed[];
  /** The activity feed, newest first, and how many of its events this device has not seen. */
  activity: ActivityEvent[];
  unseen: number;
  /** The chat runs Hermes is working on now, across profiles. Asked of Hermes again on every look, never stored. */
  running: LiveRun[];
  /** `false` while Caduceus cannot reach Hermes: the list is then what it last knew, which may be out of date. */
  live: boolean;
}

/** The body of `POST /_caduceus/api/inbox/{id}/decision`: an approval's choice (a deny may say why), or a clarify's answers by question id, as Hermes takes them. */
export type InboxDecision = { choice: InboxApprovalChoice; reason?: string } | { result: { answers: Record<string, string> } };

/** What a decision did: Hermes took it, or the request was already closed (answered elsewhere, withdrawn or expired). */
export interface InboxDecisionResult {
  status: 'resolved' | 'already-answered';
}

/** The body of `POST /_caduceus/api/inbox/hide`: put an item aside on this device, until `until` (a snooze) or until its Hermes state changes (a dismissal). */
export interface InboxHide {
  ref: string;
  stamp: string;
  until?: number;
}
