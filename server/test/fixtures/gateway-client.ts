// Shared helper for tests that run the web app's gateway connection (`web/src/gateway-connection.ts`) against a Caduceus
// server: the same controller and the same shared Hermes client the page runs, over a WebSocket that sends the owner's cookie.
import { createGatewayConnection, diagnoseBackend, type GatewayConnection, type GatewayConnectionOptions, type GatewayReady, type GatewayStatus } from '../../../web/src/gateway-connection.ts';
import { gatewayUrl, tabId } from '../../../web/src/tab-id.ts';
import { browserWebSocket } from './browser-socket.ts';

export interface TestGatewayConnection {
  connection: GatewayConnection;
  /** Every status the connection has been in, in order. */
  statuses: GatewayStatus[];
  /** Every `gateway.ready` it has seen, in order. */
  readies: GatewayReady[];
  /**
   * Resolves with the first status that `match` accepts, among those already reached and those still to come. Each call
   * picks up after the status the one before it matched, so awaiting `connected`, then `reconnecting`, then `connected`
   * follows one connection through a drop and back, and the second `connected` is not the first.
   */
  until(match: (status: GatewayStatus) => boolean): Promise<GatewayStatus>;
  /**
   * Resolves when Hermes has released the session after the last turn that completed on this connection (see the comment in `openGatewayConnection`):
   * from then on a command that is refused mid-turn goes through. Await it after `message.complete` and before such a command.
   */
  settled(): Promise<void>;
  /** Reads a JSON path of Hermes's REST API through the server, as the page's `fetch` does (the chat engine's `history` option). */
  rest(path: string): Promise<unknown>;
}

/** Retries come fast, so that a test waits for Hermes rather than for a backoff. */
const FAST_BACKOFF = { baseDelayMs: 5, capMs: 50 };

/** A tab's storage that is only this test's: the page's `sessionStorage`, as far as the tab id needs it. */
export function tabStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const kept = new Map<string, string>();
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => void kept.set(key, value) };
}

/**
 * Connects the way the page does. `options` replaces any of what the page passes. `tab` is the tab's storage: a test that
 * closes a page and opens another in the same tab (a reload) passes the same one to both; each call otherwise is a tab of its own.
 */
export function openGatewayConnection(serverUrl: string, cookie: string, options: Partial<GatewayConnectionOptions> = {}, tab: Pick<Storage, 'getItem' | 'setItem'> = tabStorage()): TestGatewayConnection {
  const get = (route: string) => fetch(`${serverUrl}${route}`, { headers: { cookie } });
  const connection = createGatewayConnection({
    url: gatewayUrl(new URL(serverUrl), tabId(tab)),
    socketFactory: (url) => {
      const { pathname, search } = new URL(url);
      return browserWebSocket(serverUrl, { cookie, path: `${pathname}${search}` });
    },
    diagnose: () => diagnoseBackend(get),
    backoff: FAST_BACKOFF,
    ...options,
  });
  const statuses: GatewayStatus[] = [connection.status];
  let consumed = 0;
  const readies: GatewayReady[] = [];
  const waiting = new Set<{ match: (status: GatewayStatus) => boolean; resolve: (status: GatewayStatus) => void }>();
  connection.subscribe(() => {
    const status = connection.status;
    // The listener is also told when the backend view changes; `statuses` is only the statuses.
    if (status === statuses.at(-1)) return;
    statuses.push(status);
    for (const waiter of waiting) {
      if (!waiter.match(status)) continue;
      waiting.delete(waiter);
      consumed = statuses.length;
      waiter.resolve(status);
    }
  });
  connection.onReady((ready) => readies.push(ready));
  // Hermes ends a turn with `message.complete` and releases the session after it: until then `running` is true, and Hermes refuses what it
  // does not do mid-turn (`/retry`, `/undo`, `session.cwd.set`: "session busy"). The release is announced by the `session.info` that says
  // `running: false`, which is the last thing of the turn: a test that goes on from `message.complete` races it, and loses on a busy machine.
  let completed = 0;
  let released = 0;
  const releasing = new Set<() => void>();
  connection.client.on('message.complete', () => void (completed += 1));
  connection.client.on('session.info', (event) => {
    if ((event.payload as { running?: unknown } | undefined)?.running !== false) return;
    released = completed;
    for (const resolve of releasing) resolve();
    releasing.clear();
  });
  return {
    connection,
    statuses,
    readies,
    async rest(path) {
      const response = await get(path);
      if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
      return response.json();
    },
    settled() {
      if (released === completed) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      releasing.add(resolve);
      return promise;
    },
    until(match) {
      const at = statuses.findIndex((status, index) => index >= consumed && match(status));
      if (at >= 0) {
        consumed = at + 1;
        return Promise.resolve(statuses[at]);
      }
      const { promise, resolve } = Promise.withResolvers<GatewayStatus>();
      waiting.add({ match, resolve });
      return promise;
    },
  };
}
