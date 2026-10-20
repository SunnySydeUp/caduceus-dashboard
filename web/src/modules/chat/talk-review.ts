// What opening a session in Talk does to Today's "Ready for review" (M8 #05): a finished run that waits for review leaves the list once the owner opens its
// chat. Pure; the server keeps which items were opened and derives the list (`server/src/today-review.ts`).
import type { ActivityEvent } from '@caduceus/contracts/inbox';
import type { ReadyItem, ReadyOpened } from '@caduceus/contracts/today';

/** The item to tell Caduceus was opened, at the finish the owner is shown: the run that finished in the open session, if it is waiting for review. A new chat, a session that is not waiting, and a task are not. */
export function readyToOpen(storedId: string | undefined, ready: readonly ReadyItem[]): ReadyOpened | undefined {
  if (storedId === undefined) return undefined;
  const item = ready.find((candidate) => candidate.kind === 'run' && candidate.id === `run:${storedId}`);
  return item && { id: item.id, stamp: item.stamp };
}

/**
 * The activity feed's newest finish in the open session (`activity` is newest first), or `undefined` for a new chat and for a session that has none. A run that finishes while its chat
 * is open is a new finish, so this changes; each change is when to look at Ready for review again, because the chat is already open and nothing else would mark that run opened.
 */
export function finishSeqIn(storedId: string | undefined, activity: readonly ActivityEvent[]): number | undefined {
  return storedId === undefined ? undefined : activity.find((event) => event.storedSessionId === storedId)?.seq;
}
