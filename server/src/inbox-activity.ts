// The activity feed (M2 #02, R8): the finished runs of the owner's chats, newest first, so that a device that was away can see what happened.
// It is a short memory of what Caduceus saw while it ran, not a copy of Hermes's history (that is the sessions list); a restart empties it.
// `seq` is a time that only goes up, so a device's cursor (the last event it has seen, kept in the store) still means something after a restart.
import type { ActivityEvent } from '@caduceus/contracts/inbox';
import type { LiveSession } from './inbox-requests.ts';

/** How many events the feed keeps. */
const KEPT = 100;

export interface ActivityFeed {
  /** Newest first. */
  events(): ActivityEvent[];
  add(event: Omit<ActivityEvent, 'seq'>): void;
  subscribe(listener: () => void): () => void;
}

export function createActivityFeed(now: () => number): ActivityFeed {
  const listeners = new Set<() => void>();
  let events: ActivityEvent[] = [];
  let last = 0;
  return {
    events: () => events,
    add(event) {
      last = Math.max(last + 1, now());
      events = [{ ...event, seq: last }, ...events].slice(0, KEPT);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Reads who finished from the live sessions each time they are listed: a session that was working (or waiting for the owner) and is idle now has
 * finished a run. A session seen for the first time says nothing: it may have been idle for hours.
 */
export function createRunTracker(feed: ActivityFeed, now: () => number): (sessions: readonly LiveSession[], profileOf: (storedId: string) => Promise<string | undefined>) => Promise<void> {
  const last = new Map<string, string>();
  return async (sessions, profileOf) => {
    for (const session of sessions) {
      const before = last.get(session.id);
      last.set(session.id, session.status);
      if ((before !== 'working' && before !== 'waiting') || session.status !== 'idle') continue;
      feed.add({ at: now(), profile: await profileOf(session.key), storedSessionId: session.key || undefined, title: session.title || session.preview || 'A chat' });
    }
    for (const id of last.keys()) if (!sessions.some((session) => session.id === id)) last.delete(id);
  };
}

