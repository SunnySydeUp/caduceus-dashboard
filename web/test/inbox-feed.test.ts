import { describe, expect, test } from 'vitest';
import type { InboxState } from '@caduceus/contracts/inbox';
import type { PageVisibility } from '../src/live-stream.ts';
import { createInboxFeed as makeFeed, type FeedSource } from '../src/modules/inbox/inbox-feed.ts';

const inView: PageVisibility = { visible: () => true, subscribe: () => () => undefined };
const createInboxFeed = (open: () => FeedSource, onActivity?: Parameters<typeof makeFeed>[1]) => makeFeed(open, onActivity, inView);

function fakeVisibility(visible = true) {
  const listeners = new Set<() => void>();
  const signal: PageVisibility & { set(next: boolean): void } = {
    visible: () => visible,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next) {
      visible = next;
      for (const listener of [...listeners]) listener();
    },
  };
  return signal;
}

// The page's one reading of the Inbox stream (M2 #01): it opens the stream when something looks and closes it when nothing does, keeps
// what it last knew while the connection is down, and says so. The stream's own content is `server/test/inbox.test.ts`.
function fakeStream() {
  const listeners: Record<string, ((event: { data: string }) => void)[]> = {};
  const source: FeedSource & { closed: boolean } = {
    closed: false,
    readyState: 0,
    onerror: null,
    addEventListener: (type, listener) => void (listeners[type] ??= []).push(listener),
    close() {
      this.closed = true;
    },
  };
  return {
    source,
    say: (state: Partial<InboxState>) => {
      source.readyState = 1;
      for (const listener of listeners.inbox ?? []) listener({ data: JSON.stringify({ items: [], needsDecision: 0, live: true, ...state }) });
    },
    drop: (final = false) => {
      source.readyState = final ? 2 : 0;
      source.onerror?.();
    },
  };
}
const waiting = (id: string) => ({ id, kind: 'approval', group: 'decision' }) as unknown as InboxState['items'][number];

describe('the Inbox feed', () => {
  test('opens its stream again on a retry, keeping what it knew until the new stream says the list', () => {
    const streams = [fakeStream(), fakeStream()];
    let opened = 0;
    const feed = createInboxFeed(() => streams[opened++]!.source);
    feed.subscribe(() => {});
    streams[0]!.say({ items: [waiting('srq-1')], needsDecision: 1 });
    streams[0]!.drop(true);
    expect(feed.get().status).toBe('offline');

    feed.retry();

    expect(opened).toBe(2);
    expect(streams[0]!.source.closed).toBe(true);
    expect(feed.get()).toMatchObject({ status: 'connecting', needsDecision: 1 });
    streams[1]!.say({ items: [], needsDecision: 0 });
    expect(feed.get()).toMatchObject({ status: 'live', needsDecision: 0 });
  });

  test('carries the runs Hermes is working on for Home, none until the server says', () => {
    const stream = fakeStream();
    const feed = createInboxFeed(() => stream.source);
    feed.subscribe(() => {});
    expect(feed.get().running).toEqual([]);

    const run = { sessionId: 'rt1', storedSessionId: 's1', title: 'Report', profile: 'work', status: 'running' as const, since: 1000 };
    stream.say({ running: [run] });
    expect(feed.get().running).toEqual([run]);
    // A server that says nothing of runs (an older one) is no runs.
    stream.say({});
    expect(feed.get().running).toEqual([]);
  });

  test('opens its stream for the first one who looks, and closes it when the last stops', () => {
    const stream = fakeStream();
    let opened = 0;
    const feed = createInboxFeed(() => {
      opened += 1;
      return stream.source;
    });
    expect(opened).toBe(0);

    const stopA = feed.subscribe(() => {});
    const stopB = feed.subscribe(() => {});
    expect(opened).toBe(1);
    expect(feed.get().status).toBe('connecting');
    stopA();
    expect(stream.source.closed).toBe(false);
    stopB();
    expect(stream.source.closed).toBe(true);
  });

  test('is what the server last said, and the badge counts only what needs a decision', () => {
    const stream = fakeStream();
    const feed = createInboxFeed(() => stream.source);
    const seen: number[] = [];
    feed.subscribe(() => seen.push(feed.badge.count()));

    stream.say({ items: [waiting('srq-1'), waiting('srq-2')], needsDecision: 2 });
    expect(feed.get()).toMatchObject({ status: 'live', hermesUp: true, needsDecision: 2 });
    expect(feed.get().items.map((item) => item.id)).toEqual(['srq-1', 'srq-2']);
    expect(feed.badge.count()).toBe(2);
    expect(feed.badge.label(2)).toBe('2 items need a decision');
    stream.say({ items: [], needsDecision: 0 });
    expect(seen).toEqual([2, 0]);
  });

  test('keeps what it knew while the connection is down, says it is offline, and is live again with the next list', () => {
    const stream = fakeStream();
    const feed = createInboxFeed(() => stream.source);
    feed.subscribe(() => {});
    stream.say({ items: [waiting('srq-1')], needsDecision: 1 });

    stream.drop();
    expect(feed.get()).toMatchObject({ status: 'offline', needsDecision: 1 });
    expect(feed.get().items).toHaveLength(1);

    stream.say({ items: [], needsDecision: 0 });
    expect(feed.get()).toMatchObject({ status: 'live', needsDecision: 0 });
  });

  test('tells a Hermes that cannot be reached apart from a Caduceus that cannot', () => {
    const stream = fakeStream();
    const feed = createInboxFeed(() => stream.source);
    feed.subscribe(() => {});
    stream.say({ live: false });
    expect(feed.get()).toMatchObject({ status: 'live', hermesUp: false });
  });
});

describe('the activity feed in the page', () => {
  const event = (seq: number) => ({ seq, at: 1, profile: 'work', storedSessionId: 's', title: `run ${seq}` });

  test('a run that finishes after the first list is news; what the first list holds is not', () => {
    const stream = fakeStream();
    const news: string[][] = [];
    const feed = createInboxFeed(() => stream.source, (events) => news.push(events.map((e) => e.title)));
    feed.subscribe(() => {});

    stream.say({ activity: [event(10)], unseen: 1 });
    expect(news).toEqual([]);
    expect(feed.get()).toMatchObject({ unseen: 1 });
    stream.say({ activity: [event(20), event(10)], unseen: 2 });
    stream.say({ activity: [event(20), event(10)], unseen: 2 });

    expect(news).toEqual([['run 20']]);
  });
});

describe('the Inbox feed in a tab nobody is looking at', () => {
  // Over HTTP/1.1 a browser allows six connections per host across all tabs: a hidden tab must not hold the stream open.
  test('closes the stream while hidden, keeps what it knew, and reads the list again on return', () => {
    const streams = [fakeStream(), fakeStream()];
    let opened = 0;
    const view = fakeVisibility();
    const feed = makeFeed(() => streams[opened++]!.source, undefined, view);
    feed.subscribe(() => {});
    streams[0]!.say({ items: [waiting('srq-1')], needsDecision: 1 });

    view.set(false);
    expect(streams[0]!.source.closed).toBe(true);
    expect(feed.badge.count()).toBe(1);

    view.set(true);
    expect(opened).toBe(2);
    expect(feed.get()).toMatchObject({ status: 'connecting', needsDecision: 1 });
    streams[1]!.say({ items: [], needsDecision: 0 });
    expect(feed.get()).toMatchObject({ status: 'live', needsDecision: 0 });
  });

  test('a run that finished while hidden is news on return, and one the page already knew is not', () => {
    const streams = [fakeStream(), fakeStream()];
    let opened = 0;
    const view = fakeVisibility();
    const news: string[][] = [];
    const event = (seq: number) => ({ seq, at: 1, profile: 'work', storedSessionId: 's', title: `run ${seq}` });
    const feed = makeFeed(() => streams[opened++]!.source, (events) => news.push(events.map((e) => e.title)), view);
    feed.subscribe(() => {});
    streams[0]!.say({ activity: [event(10)] });

    view.set(false);
    view.set(true);
    streams[1]!.say({ activity: [event(20), event(10)] });

    expect(news).toEqual([['run 20']]);
  });

  test('opens nothing for a tab that is hidden when something first looks, until it is seen', () => {
    const stream = fakeStream();
    let opened = 0;
    const view = fakeVisibility(false);
    const feed = makeFeed(() => {
      opened += 1;
      return stream.source;
    }, undefined, view);
    feed.subscribe(() => {});
    expect(opened).toBe(0);

    view.set(true);
    expect(opened).toBe(1);
  });

  test('stops watching the page when nothing looks at the feed any more', () => {
    const stream = fakeStream();
    const view = fakeVisibility();
    let opened = 0;
    const feed = makeFeed(() => {
      opened += 1;
      return stream.source;
    }, undefined, view);
    const stop = feed.subscribe(() => {});
    stop();

    view.set(false);
    view.set(true);

    expect(opened).toBe(1);
  });
});
