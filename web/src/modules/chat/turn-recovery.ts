// Turns that did not finish (M1 #12): pure. Hermes keeps the evidence in its own transcript, and this reads it:
//  - a turn that failed ends with a note Hermes writes in place of a reply (`agent/turn_failure_copy.py`), which the page shows as a failed-turn bubble;
//  - a turn killed with its backend is picked up again by Hermes, which says so in a user-role note (`display_kind: auto_continue`);
//  - a transcript that stops on a message of the owner's (no reply), or on the agent's tool calls, is what Hermes itself calls an interrupted session.
// A reply the owner stopped looks like any other reply in Hermes's rows, so the page keeps which ones it stopped (in the browser's storage, by row id).
import type { QueueStorage } from './queue.ts';

/** Hermes's words for the end of a turn that failed with nothing run, and with some actions possibly run. Exact: they are Hermes's, and the page must not take a reply that merely sounds like them. */
export const FAILED_TURN_NOTICES: readonly string[] = [
  'Your request was not processed. Send it again if you still want me to carry it out.',
  'This turn did not complete. Some actions may already have run; verify their effects before resending.',
];

/** The note that closes a turn Hermes failed, as a reply of the assistant. */
export const isFailedTurnNotice = (text: string): boolean => FAILED_TURN_NOTICES.includes(text.trim());

/** Where Hermes's crash-recovery note starts (`tui_gateway/session_history.py`): it matches the prefix for rows written before they were typed. */
const AUTO_CONTINUE_PREFIX = '[System note: Your previous turn was interrupted mid-run';

/** A user-role row that Hermes wrote when it picked a killed turn up again: not something the owner said. */
export const isAutoContinueNote = (row: { display_kind?: unknown }, text: string): boolean => row.display_kind === 'auto_continue' || text.trimStart().startsWith(AUTO_CONTINUE_PREFIX);

/** What the end of a transcript says about a turn nobody finished: the owner stopped it, Hermes never answered the last message, or it stopped after the agent's tool work. */
export type Interruption = 'stopped' | 'unanswered' | 'cut-off';

/** The part of a chat's state that tells whether its last turn was interrupted. */
export interface InterruptionFacts {
  messages: readonly { role: 'user' | 'assistant'; activity?: unknown; stopped?: true; failed?: unknown; note?: string }[];
  turn: unknown;
  running: boolean;
  syncing: boolean;
  hasNewer: boolean;
}

/**
 * Whether the chat's last turn was interrupted, judged from what Hermes holds: nothing is running or being read, the window ends at the newest message, and the
 * transcript stops on a message of the owner's without a reply (`unanswered`), on agent activity with no words after it (`cut-off`), or on a reply the owner stopped.
 * A failed turn has its own bubble; a turn Hermes picked up again is not interrupted any more.
 */
export function interruptionOf({ messages, turn, running, syncing, hasNewer }: InterruptionFacts): Interruption | undefined {
  if (turn !== undefined || running || syncing || hasNewer) return undefined;
  const last = messages.at(-1);
  if (!last || last.failed || last.note !== undefined) return undefined;
  if (last.activity) return 'cut-off';
  if (last.role === 'user') return 'unanswered';
  return last.stopped ? 'stopped' : undefined;
}

const stoppedKey = (profile: string | undefined, storedId: string) => `caduceus.chat.stopped.${profile ?? 'default'}.${storedId}`;
const MAX_STOPPED = 50;

/** The replies of a session the owner stopped (Hermes's row ids), as the storage holds them. */
export function readStopped(storage: QueueStorage | undefined, profile: string | undefined, storedId: string | undefined): Set<number> {
  if (!storage || storedId === undefined) return new Set();
  try {
    const saved = JSON.parse(storage.getItem(stoppedKey(profile, storedId)) ?? '[]') as unknown;
    return new Set(Array.isArray(saved) ? saved.filter((id): id is number => typeof id === 'number') : []);
  } catch {
    return new Set();
  }
}

/** Keeps the stopped replies of a session (the newest few). */
export function writeStopped(storage: QueueStorage | undefined, profile: string | undefined, storedId: string | undefined, ids: ReadonlySet<number>): void {
  if (!storage || storedId === undefined) return;
  try {
    storage.setItem(stoppedKey(profile, storedId), JSON.stringify([...ids].slice(-MAX_STOPPED)));
  } catch {
    // Storage is full or refused: the mark lasts until the page closes.
  }
}
