// The page's one reading of the Inbox (M2 #01): Caduceus's server-sent stream (`server/src/inbox.ts`), opened when anything on the page
// looks at it (the nav badge always does) and closed when nothing does, or while the tab is hidden (a stream holds one of the browser's six
// connections per host over HTTP/1.1, across all tabs; `live-stream.ts`). The server says the whole list on every change, so a stream that
// the browser reconnected, or that was opened on return to the tab, is right again with its next event, whatever it missed. While the
// connection is down the list is what was last known, and `status` says so.
import { useSyncExternalStore } from 'react';
import type { ActivityEvent, LiveRun, InboxItem, InboxSnoozed, InboxState } from '@caduceus/contracts/inbox';
import { pageVisibility, type PageVisibility } from '../../live-stream.ts';
import type { NavBadge } from '../../module-registry.ts';
import { afterPaint } from '../../settled.ts';
import { toast } from '../../shell/toasts.ts';
import { badgeLabel, newActivity } from './inbox-model.ts';

/** The part of `EventSource` the feed uses, so a test can stand in for the browser's. */
export interface FeedSource {
  readyState: number;
  onerror: (() => void) | null;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

export interface InboxView {
  /** `connecting` before the first list, `live` while the stream is up, `offline` while Caduceus cannot be reached (the list is then the last known). */
  status: 'connecting' | 'live' | 'offline';
  items: readonly InboxItem[];
  needsDecision: number;
  /** What this device has snoozed. */
  snoozed: readonly InboxSnoozed[];
  /** The activity feed, newest first, and how many of its events this device has not seen. */
  activity: readonly ActivityEvent[];
  unseen: number;
  /** The chat runs Hermes is working on, across profiles: what Work's running rows and the crew's states read. */
  running: readonly LiveRun[];
  /** Caduceus cannot reach Hermes: the list is what it last knew, which may be out of date. */
  hermesUp: boolean;
}

export interface InboxFeed {
  get(): InboxView;
  subscribe(listener: () => void): () => void;
  /** The nav badge: the number of items that need a decision. */
  readonly badge: NavBadge;
  /** Opens the stream again, for a page whose reading of it failed (a block's Retry); what was known stays until the server says the list again. */
  retry(): void;
}

const EMPTY: InboxView = { status: 'connecting', items: [], needsDecision: 0, snoozed: [], activity: [], unseen: 0, running: [], hermesUp: true };

/**
 * `onActivity` hears the events that arrive after the first list: a run that finished while the page was open, or while its tab was hidden. What the
 * first list holds is what happened before, and is not news. `visibility` says when the tab is in view: the stream is open only then.
 */
export function createInboxFeed(open: () => FeedSource, onActivity: ((events: ActivityEvent[]) => void) | undefined, visibility: PageVisibility): InboxFeed {
  const listeners = new Set<() => void>();
  let view = EMPTY;
  let source: FeedSource | undefined;
  /** The newest activity event this page has heard of; `undefined` until the first list. */
  let heard: number | undefined;

  const set = (next: InboxView) => {
    view = next;
    for (const listener of [...listeners]) listener();
  };

  const start = () => {
    const opened = open();
    source = opened;
    opened.addEventListener('inbox', (event) => {
      const state = JSON.parse(event.data) as InboxState;
      const activity = state.activity ?? [];
      if (heard !== undefined) {
        const fresh = newActivity(activity, heard);
        if (fresh.length > 0) onActivity?.(fresh);
      }
      heard = Math.max(heard ?? 0, ...activity.map((event) => event.seq));
      set({ status: 'live', items: state.items, needsDecision: state.needsDecision, snoozed: state.snoozed ?? [], activity, unseen: state.unseen ?? 0, running: state.running ?? [], hermesUp: state.live });
    });
    // The browser reconnects a stream that dropped by itself; one it has given up on (Caduceus answered with an error: signed out) stays down.
    opened.onerror = () => set({ ...view, status: 'offline' });
  };

  /** Stops watching the page; set while something looks at the feed. */
  let unwatch: (() => void) | undefined;

  // A tab nobody is looking at holds no stream. What it misses is not lost: the badge and push are the server's, and the stream's first event on return is the whole list.
  const follow = () => {
    if (!visibility.visible()) {
      source?.close();
      source = undefined;
    } else if (!source) {
      start();
      if (view.status !== 'connecting') set({ ...view, status: 'connecting' });
    }
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!unwatch) {
      unwatch = visibility.subscribe(follow);
      if (visibility.visible()) start();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      unwatch?.();
      unwatch = undefined;
      source?.close();
      source = undefined;
      heard = undefined;
      view = EMPTY;
    };
  };

  const retry = () => {
    if (!source) return;
    source.close();
    start();
    set({ ...view, status: 'connecting' });
  };

  return { get: () => view, subscribe, retry, badge: { subscribe, count: () => view.needsDecision, label: badgeLabel } };
}

/** A toast for each run that finished while the page is in view, unless the owner is looking at that very chat. */
function toastFinished(events: ActivityEvent[]): void {
  if (document.visibilityState !== 'visible') return;
  for (const event of events) {
    if (event.storedSessionId !== undefined && location.pathname.includes(encodeURIComponent(event.storedSessionId))) continue;
    toast(`Finished: ${event.title}`, { tone: 'success', detail: event.profile });
  }
}

let shared: InboxFeed | undefined;

/**
 * The page counts as in view for the feed from its first paint on: the stream is asked for after what is on the first screen has been painted, not in
 * the render that makes the nav badge look at it (the blocks that wait for the feed say they are loading until then).
 */
const inViewAfterFirstPaint: PageVisibility = (() => {
  let painted = false;
  let waiting = false;
  const listeners = new Set<() => void>();
  return {
    visible: () => painted && pageVisibility.visible(),
    subscribe: (listener) => {
      listeners.add(listener);
      // The first look at the feed is made by the render that is about to paint: the paint is what is waited for.
      if (!waiting) {
        waiting = true;
        void afterPaint().then(() => {
          painted = true;
          for (const notify of [...listeners]) notify();
        });
      }
      const unwatch = pageVisibility.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unwatch();
      };
    },
  };
})();

/** The page's feed, over the real `EventSource`; made when it is first wanted. */
export function inboxFeed(): InboxFeed {
  shared ??= createInboxFeed(() => new EventSource('/_caduceus/api/inbox/stream') as unknown as FeedSource, toastFinished, inViewAfterFirstPaint);
  return shared;
}

/** The Inbox as the page knows it now, kept current. */
export function useInbox(): InboxView {
  const feed = inboxFeed();
  return useSyncExternalStore(feed.subscribe, feed.get);
}

/** The nav badge on the Inbox's entry: the feed's count, which opens the stream the first time anything looks at it. */
export const inboxBadge: NavBadge = { subscribe: (listener) => inboxFeed().subscribe(listener), count: () => inboxFeed().get().needsDecision, label: badgeLabel };
