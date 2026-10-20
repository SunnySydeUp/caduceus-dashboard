import { describe, expect, test } from 'vitest';
import { createStreamHub, type PageVisibility, type StreamListener, type StreamSource } from '../src/live-stream.ts';

// Browsers allow six connections per host over HTTP/1.1, across every tab, and a server-sent stream holds one for as long as it is open. A tab that
// nobody is looking at must hold none, and two readers of one stream in a tab must hold one.
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
  return { signal, watchers: () => listeners.size };
}

function fakeNetwork() {
  const sources: (StreamSource & { url: string; closed: boolean; say(type: string, data: string): void })[] = [];
  const open = (url: string) => {
    const handlers: Record<string, ((event: { data: string }) => void)[]> = {};
    const source = {
      url,
      closed: false,
      readyState: 0,
      onopen: null,
      onerror: null,
      addEventListener: (type: string, listener: (event: { data: string }) => void) => void (handlers[type] ??= []).push(listener),
      close() {
        this.closed = true;
        this.readyState = 2;
      },
      say: (type: string, data: string) => (handlers[type] ?? []).forEach((listener) => listener({ data })),
    } satisfies StreamSource & { url: string; closed: boolean; say(type: string, data: string): void };
    sources.push(source);
    return source;
  };
  return { open, sources, live: () => sources.filter((source) => !source.closed) };
}

function reader(events: readonly string[] = ['line']) {
  const heard: string[] = [];
  const log = { resumed: 0, opened: 0, errors: [] as boolean[] };
  const listener: StreamListener = {
    events,
    onEvent: (type, data) => void heard.push(`${type}:${data}`),
    onOpen: () => void log.opened++,
    onError: (closed) => void log.errors.push(closed),
    onResume: () => void log.resumed++,
  };
  return { listener, heard, log };
}

describe('the stream hub', () => {
  test('opens a stream for a reader, hands it the events it asked for, and closes it with the last reader', () => {
    const net = fakeNetwork();
    const { signal } = fakeVisibility();
    const hub = createStreamHub(net.open, signal);
    const a = reader(['line', 'end']);

    const stop = hub.subscribe('/s', a.listener);
    net.sources[0]!.say('line', '1');
    net.sources[0]!.say('other', 'x');
    net.sources[0]!.say('end', '{}');

    expect(a.heard).toEqual(['line:1', 'end:{}']);
    stop();
    expect(net.live()).toHaveLength(0);
  });

  test('a hidden page holds no stream, and a page that comes back opens it again and says so', () => {
    const net = fakeNetwork();
    const { signal } = fakeVisibility();
    const hub = createStreamHub(net.open, signal);
    const a = reader();
    hub.subscribe('/s', a.listener);

    signal.set(false);
    expect(net.live()).toHaveLength(0);
    expect(a.log.resumed).toBe(0);

    signal.set(true);
    expect(net.live().map((source) => source.url)).toEqual(['/s']);
    expect(a.log.resumed).toBe(1);
    net.live()[0]!.say('line', 'after');
    expect(a.heard).toEqual(['line:after']);
  });

  test('a reader that arrives while the page is hidden waits for the page to be seen', () => {
    const net = fakeNetwork();
    const { signal } = fakeVisibility(false);
    const hub = createStreamHub(net.open, signal);
    const a = reader();

    hub.subscribe('/s', a.listener);
    expect(net.sources).toHaveLength(0);

    signal.set(true);
    expect(net.live()).toHaveLength(1);
  });

  test('two readers of one address share one stream, and each hears the view from its start', () => {
    const net = fakeNetwork();
    const { signal } = fakeVisibility();
    const hub = createStreamHub(net.open, signal);
    const a = reader();
    const b = reader(['line', 'extra']);

    const stopA = hub.subscribe('/s', a.listener);
    const stopB = hub.subscribe('/s', b.listener);

    // The server says the view whole to a new connection: the newcomer must hear that, so the stream is opened again for both.
    expect(net.live()).toHaveLength(1);
    expect(net.sources).toHaveLength(2);
    net.live()[0]!.say('line', '1');
    net.live()[0]!.say('extra', 'e');
    expect(a.heard).toEqual(['line:1']);
    expect(b.heard).toEqual(['line:1', 'extra:e']);

    stopA();
    expect(net.live()).toHaveLength(1);
    stopB();
    expect(net.live()).toHaveLength(0);
  });

  test('streams of different addresses are separate, and all of them close while hidden', () => {
    const net = fakeNetwork();
    const { signal } = fakeVisibility();
    const hub = createStreamHub(net.open, signal);
    hub.subscribe('/a', reader().listener);
    hub.subscribe('/b', reader().listener);
    expect(net.live()).toHaveLength(2);

    signal.set(false);
    expect(net.live()).toHaveLength(0);
    signal.set(true);
    expect(net.live().map((source) => source.url).sort()).toEqual(['/a', '/b']);
  });

  test('a reader that has gone is not woken, and the hub stops watching the page when it has no stream', () => {
    const net = fakeNetwork();
    const { signal, watchers } = fakeVisibility();
    const hub = createStreamHub(net.open, signal);
    const a = reader();
    const stop = hub.subscribe('/s', a.listener);
    expect(watchers()).toBe(1);

    stop();
    signal.set(false);
    signal.set(true);

    expect(a.log.resumed).toBe(0);
    expect(net.live()).toHaveLength(0);
    expect(watchers()).toBe(0);
  });

  test('passes on a connection that opened and one that broke, saying whether the browser has given up', () => {
    const net = fakeNetwork();
    const { signal } = fakeVisibility();
    const hub = createStreamHub(net.open, signal);
    const a = reader();
    hub.subscribe('/s', a.listener);
    const source = net.sources[0]!;

    source.onopen?.();
    source.readyState = 0;
    source.onerror?.();
    source.readyState = 2;
    source.onerror?.();

    expect(a.log.opened).toBe(1);
    expect(a.log.errors).toEqual([false, true]);
  });

  test('a stream the browser gave up on is opened afresh when the page is seen again', () => {
    const net = fakeNetwork();
    const { signal } = fakeVisibility();
    const hub = createStreamHub(net.open, signal);
    hub.subscribe('/s', reader().listener);

    signal.set(false);
    signal.set(true);
    signal.set(true);

    expect(net.sources).toHaveLength(2);
  });
});
