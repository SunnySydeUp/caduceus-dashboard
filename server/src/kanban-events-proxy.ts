// The browser's live view of a Kanban board: a WebSocket from the browser to Caduceus, and one upstream WebSocket per browser
// socket to the Kanban plugin's events stream in the private Hermes backend (architecture §3). Hermes tails its own
// `task_events` table; Caduceus only relays what it says and keeps nothing (D1).
//
// Hermes records no event when a task is deleted (`delete_task` removes the task's events with it), so a page could never learn
// of a delete from the stream. A write that passes through Caduceus is therefore announced to every page watching a board with
// a `{ "written": true }` frame (`announceWrite`): the page loads the board again.
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { GATEWAY_CLOSE } from '@caduceus/contracts/caduceus-api';
import { WebSocket, WebSocketServer } from 'ws';
import type { HermesBackend } from './hermes-backend.ts';
import { refuseUpgrade, type UpgradeContext } from './websocket-routes.ts';
import type { CloseReason } from './gateway-proxy.ts';

export interface KanbanEventsProxyOptions {
  backend: HermesBackend;
  /** How long Hermes has to accept the upstream connection before the browser's handshake is refused. */
  openTimeoutMs?: number;
  /** How often a browser socket is pinged; one that has not answered the last ping by the next is dropped. */
  keepaliveMs?: number;
}

export interface KanbanEventsProxy {
  /** Serves a Kanban events upgrade that passed the gate. */
  accept(req: http.IncomingMessage, socket: Duplex, head: Buffer, context: UpgradeContext): void;
  /** Tells every page watching a board that Hermes was written to through Caduceus, so it loads the board again. */
  announceWrite(): void;
  /** Closes every live connection of one session of the owner. */
  closeSession(sessionId: string, why: CloseReason): void;
  /** Closes every live connection. */
  closeAll(why: CloseReason): void;
}

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const DEFAULT_KEEPALIVE_MS = 30_000;
const UNSUPPORTED_DATA = 1003;

/** A board's slug as Hermes writes them (`kanban_db._normalize_board_slug`): lowercase letters, digits, hyphens and underscores. */
const BOARD_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EVENT_ID = /^\d{1,15}$/;

export function createKanbanEventsProxy({ backend, openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS, keepaliveMs = DEFAULT_KEEPALIVE_MS }: KanbanEventsProxyOptions): KanbanEventsProxy {
  const browsers = new WebSocketServer({ noServer: true });
  /** Every open pair, by the owner's session: a browser socket and the upstream it is joined to. */
  const live = new Map<string, Set<{ browser: WebSocket; upstream: WebSocket }>>();

  const track = (sessionId: string, pair: { browser: WebSocket; upstream: WebSocket }) => {
    const pairs = live.get(sessionId) ?? new Set();
    live.set(sessionId, pairs.add(pair));
    return () => {
      pairs.delete(pair);
      if (pairs.size === 0) live.delete(sessionId);
    };
  };

  return {
    accept(req, socket, head, { session }) {
      if (backend.status.state !== 'ready') return refuseUpgrade(socket, 503);
      // Only the board and the cursor are passed on, each checked: the rest of the query, a `?token=` included, never reaches Hermes.
      const query = new URL(req.url ?? '/', 'http://caduceus').searchParams;
      const board = query.get('board') ?? undefined;
      const since = query.get('since') ?? '0';
      if ((board !== undefined && !BOARD_SLUG.test(board)) || !EVENT_ID.test(since)) return refuseUpgrade(socket, 400);

      void (async () => {
        const upstream = await backend.openKanbanEvents({ board, since: Number(since), handshakeTimeoutMs: openTimeoutMs });
        const { promise: opened, resolve, reject } = Promise.withResolvers<void>();
        upstream.addEventListener('open', () => resolve(), { once: true });
        upstream.addEventListener('close', () => reject(new Error('Hermes closed the Kanban events before they opened')), { once: true });
        // A browser that leaves while Hermes is still being asked takes the upstream with it.
        socket.once('close', () => upstream.close());
        await opened;
        browsers.handleUpgrade(req, socket, head, (browser) => {
          const pair = { browser, upstream };
          const untrack = track(session.id, pair);
          let answered = true;
          browser.on('pong', () => {
            answered = true;
          });
          // A phone that loses its connection says no goodbye: a socket that misses a ping is dropped, and its upstream with it.
          const keepAlive = setInterval(() => {
            if (!answered) return browser.terminate();
            answered = false;
            browser.ping();
          }, keepaliveMs);
          upstream.addEventListener('message', (event) => {
            if (typeof event.data !== 'string') browser.close(UNSUPPORTED_DATA, 'Hermes sent a frame that is not text');
            else if (browser.readyState === WebSocket.OPEN) browser.send(backend.redact(event.data));
          });
          upstream.addEventListener('close', () => browser.close(GATEWAY_CLOSE.hermesClosed.code, GATEWAY_CLOSE.hermesClosed.reason));
          // The stream is one way: whatever the browser sends is not for Hermes.
          browser.on('message', () => {});
          browser.once('close', () => {
            clearInterval(keepAlive);
            untrack();
            upstream.close();
          });
          if (upstream.readyState !== WebSocket.OPEN) browser.close(GATEWAY_CLOSE.hermesClosed.code, GATEWAY_CLOSE.hermesClosed.reason);
        });
      })().catch(() => refuseUpgrade(socket, 502));
    },

    announceWrite() {
      for (const pairs of live.values()) for (const { browser } of pairs) if (browser.readyState === WebSocket.OPEN) browser.send('{"written":true}');
    },

    closeSession(sessionId, why) {
      for (const { browser } of live.get(sessionId) ?? []) browser.close(why.code, why.reason);
    },

    closeAll(why) {
      for (const pairs of live.values()) for (const { browser } of pairs) browser.close(why.code, why.reason);
    },
  };
}
