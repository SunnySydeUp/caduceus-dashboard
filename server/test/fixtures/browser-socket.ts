// Shared helper for tests that open Caduceus's gateway WebSocket the way the browser does: with the session cookie and the
// page's own Origin. A browser cannot set those headers from script, but it sends them itself; Node's WebSocket can be told to.
import { once } from 'node:events';
import http from 'node:http';
import type { Socket } from 'node:net';

export type Frame = Record<string, any>;

export interface BrowserSocket {
  /** The underlying socket, for a test that needs to look at it (its close code, say). */
  readonly ws: WebSocket;
  /** Every frame received so far, in order. */
  readonly frames: readonly Frame[];
  /** Sends one JSON-RPC object as its own text frame. */
  send(frame: Frame): void;
  /** Sends raw text, for the frames a browser should never send. */
  sendText(text: string): void;
  /** Resolves with the first frame, already received or still to come, that `match` accepts; frames before it stay in `frames`. */
  waitFor(match: (frame: Frame) => boolean): Promise<Frame>;
  /** Resolves when the socket closes, with how. */
  readonly closed: Promise<{ code: number; reason: string }>;
  close(): void;
}

export interface BrowserSocketOptions {
  /** The `Cookie` header; a browser sends the session cookie it was given. */
  cookie?: string;
  /** The page's Origin; defaults to the server's own address, as for a page it served. */
  origin?: string;
  /** The route; defaults to the gateway. */
  path?: string;
}

/** A WebSocket as a browser opens it: with the session cookie and the page's own Origin. Node's takes extra handshake headers as an option the standard constructor does not have. */
export function browserWebSocket(serverUrl: string, { cookie, origin = serverUrl, path = '/api/ws' }: BrowserSocketOptions = {}): WebSocket {
  const headers: Record<string, string> = { origin };
  if (cookie) headers.cookie = cookie;
  return new WebSocket(`${serverUrl.replace(/^http/, 'ws')}${path}`, { headers } as never);
}

/** Opens `/api/ws` (or `path`) and resolves once the handshake is accepted; rejects when the server refuses the upgrade. */
export async function connectBrowserSocket(serverUrl: string, options: BrowserSocketOptions = {}): Promise<BrowserSocket> {
  const ws = browserWebSocket(serverUrl, options);
  const frames: Frame[] = [];
  const waiting = new Set<{ match: (frame: Frame) => boolean; resolve: (frame: Frame) => void }>();
  ws.addEventListener('message', (message) => {
    const frame = JSON.parse(String(message.data)) as Frame;
    frames.push(frame);
    for (const waiter of waiting) {
      if (!waiter.match(frame)) continue;
      waiting.delete(waiter);
      waiter.resolve(frame);
    }
  });
  const { promise: closed, resolve: onClosed } = Promise.withResolvers<{ code: number; reason: string }>();
  ws.addEventListener('close', (event) => onClosed({ code: event.code, reason: event.reason }));
  const { promise: opened, resolve: onOpen, reject: onRefused } = Promise.withResolvers<void>();
  ws.addEventListener('open', () => onOpen(), { once: true });
  ws.addEventListener('error', () => onRefused(new Error('the WebSocket upgrade was refused')), { once: true });
  await opened;
  return {
    ws,
    frames,
    send: (frame) => ws.send(JSON.stringify(frame)),
    sendText: (text) => ws.send(text),
    waitFor(match) {
      const seen = frames.find(match);
      if (seen) return Promise.resolve(seen);
      const { promise, resolve } = Promise.withResolvers<Frame>();
      waiting.add({ match, resolve });
      return promise;
    },
    closed,
    close: () => ws.close(),
  };
}

/** Attempts a WebSocket handshake with exactly these headers and returns the HTTP status the server answers it with (101 when it upgrades). */
export async function upgradeStatus(serverUrl: string, headers: Record<string, string>, path = '/api/ws'): Promise<number | undefined> {
  const req = http.request(`${serverUrl}${path}`, {
    headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
  });
  req.end();
  const outcome = await Promise.race([
    once(req, 'response').then(([res]) => ({ status: (res as http.IncomingMessage).statusCode, res: res as http.IncomingMessage })),
    once(req, 'upgrade').then(([res, socket]) => {
      (socket as Socket).destroy();
      return { status: (res as http.IncomingMessage).statusCode, res: undefined };
    }),
  ]);
  outcome.res?.resume();
  return outcome.status;
}
