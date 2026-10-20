// The messages a chat's owner queued for after the running turn (M1 #07). Hermes's gateway has a queue of its own, but it cannot be listed,
// edited or cancelled, so the queue is the page's: it is kept in the browser's storage under the session, which is what lets it survive a
// reload while the turn is still running. No DOM and no React: storage is passed in.

/** A message waiting for the turn that is running. */
export interface QueuedMessage {
  id: string;
  text: string;
}

/** A queue as it is kept: what waits, and whether it is held (a turn that was stopped or failed does not start the next message on its own). */
export interface SavedQueue {
  queue: QueuedMessage[];
  paused: boolean;
}

/** The part of the browser's storage the queue needs. */
export type QueueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The device's storage, or nothing where it is not there (or refused). */
export function deviceStorage(): QueueStorage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

const keyOf = (profile: string | undefined, storedId: string) => `caduceus.chat.queue.${profile ?? 'default'}.${storedId}`;

const isQueued = (value: unknown): value is QueuedMessage => typeof value === 'object' && value !== null && typeof (value as QueuedMessage).id === 'string' && typeof (value as QueuedMessage).text === 'string';

/** What the storage holds for a session's queue; an empty queue when it holds nothing, or nothing that reads. */
export function readQueue(storage: QueueStorage | undefined, profile: string | undefined, storedId: string | undefined): SavedQueue {
  const empty: SavedQueue = { queue: [], paused: false };
  if (!storage || storedId === undefined) return empty;
  try {
    const saved = JSON.parse(storage.getItem(keyOf(profile, storedId)) ?? 'null') as { queue?: unknown; paused?: unknown } | null;
    const queue = Array.isArray(saved?.queue) ? saved.queue.filter(isQueued).map(({ id, text }) => ({ id, text })) : [];
    return queue.length === 0 ? empty : { queue, paused: saved?.paused === true };
  } catch {
    return empty;
  }
}

/** Keeps a session's queue (an empty one is forgotten). */
export function writeQueue(storage: QueueStorage | undefined, profile: string | undefined, storedId: string | undefined, { queue, paused }: SavedQueue): void {
  if (!storage || storedId === undefined) return;
  try {
    if (queue.length === 0) storage.removeItem(keyOf(profile, storedId));
    else storage.setItem(keyOf(profile, storedId), JSON.stringify({ queue, paused }));
  } catch {
    // Storage is full or refused: the queue lasts until the page closes.
  }
}
