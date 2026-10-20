// Caduceus's own standing connection to Hermes's gateway (`/api/ws`), the observer connection (architecture §3, §4; M2 #01). It is
// what the server asks Hermes with when no browser is involved (which sessions are waiting on the owner, and for what) and what
// hears the global change broadcasts (`sessions.changed`, `cron.changed`, `pairing.changed`, `platforms.changed`) that every
// live socket gets.
//
// It never answers a server request. It does not say `client.capabilities {server_requests: true}`, so Hermes does not count
// it among the clients that answer, and it attaches to no session (`session.activate` / `session.resume`), so no request is
// ever sent to it (verified in `server/test/inbox.test.ts`). A session it merely reads stays as hosted, and as answerable by
// its own clients, as it was.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { WebSocket } from 'ws';
import type { HermesBackend } from './hermes-backend.ts';

/** How long Hermes has to answer one call before the connection is given up on and opened again. */
const CALL_TIMEOUT_MS = 15_000;
const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000];

export interface GatewayObserver {
  /** Whether the connection is open and Hermes has said it is ready. */
  readonly up: boolean;
  /** Calls a gateway method and resolves with its `result`; rejects with Hermes's error message, or when the connection is down. */
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Hears every event Hermes broadcasts that is not tied to a session or is, by `type` (`cron.changed`). Returns how to stop. */
  onEvent(listener: (type: string, payload: unknown, sessionId: string | undefined) => void): () => void;
  /** Hears the connection come up and go down. Returns how to stop. */
  onStatus(listener: (up: boolean) => void): () => void;
  close(): void;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** Opens the observer connection and keeps it open for as long as Hermes runs: it is opened again, with a short backoff, whenever it closes. */
export function createGatewayObserver(backend: HermesBackend): GatewayObserver {
  const eventListeners = new Set<(type: string, payload: unknown, sessionId: string | undefined) => void>();
  const statusListeners = new Set<(up: boolean) => void>();
  const pending = new Map<number, Pending>();
  let socket: WebSocket | undefined;
  let up = false;
  let closed = false;
  let nextId = 1;
  let failures = 0;
  let retry: NodeJS.Timeout | undefined;

  const setUp = (value: boolean) => {
    if (up === value) return;
    up = value;
    for (const listener of statusListeners) listener(value);
  };

  const failAll = (reason: string) => {
    for (const [id, call] of pending) {
      clearTimeout(call.timer);
      call.reject(new Error(reason));
      pending.delete(id);
    }
  };

  const open = async () => {
    if (closed) return;
    let opened: WebSocket;
    try {
      opened = await backend.openGateway();
    } catch {
      return scheduleRetry();
    }
    if (closed) {
      opened.close();
      return;
    }
    socket = opened;
    opened.on('message', (data) => {
      const text = backend.redact(data.toString());
      let frame: unknown;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }
      if (!isRecord(frame)) return;
      if (frame.method === 'event' && isRecord(frame.params)) {
        const { type, payload, session_id: sessionId } = frame.params;
        if (typeof type !== 'string') return;
        if (type === 'gateway.ready') {
          failures = 0;
          setUp(true);
        }
        for (const listener of eventListeners) listener(type, payload, typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined);
        return;
      }
      // A request from Hermes (an approval, say) reaches the observer only if a session sent it one, which none does; if one ever
      // does, it is left unanswered, which is what the observer is for.
      if (typeof frame.id !== 'number') return;
      const call = pending.get(frame.id);
      if (!call) return;
      pending.delete(frame.id);
      clearTimeout(call.timer);
      if (isRecord(frame.error)) call.reject(new Error(typeof frame.error.message === 'string' ? frame.error.message : 'Hermes refused the call.'));
      else call.resolve(frame.result);
    });
    opened.on('close', () => {
      if (socket === opened) socket = undefined;
      setUp(false);
      failAll('The connection to Hermes closed.');
      scheduleRetry();
    });
  };

  const scheduleRetry = () => {
    if (closed || retry) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)]!;
    failures += 1;
    retry = setTimeout(() => {
      retry = undefined;
      void open();
    }, delay);
    retry.unref();
  };

  // While Hermes is not ready, `openGateway` waits for it; the first open is made now and every one after a close is scheduled.
  void open();
  // A new Hermes (after a restart) closes the old socket, which schedules the next open; one that was stopped for good is retried like any other.

  return {
    get up() {
      return up;
    },
    request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      const current = socket;
      if (!up || !current || current.readyState !== current.OPEN) return Promise.reject(new Error('The connection to Hermes is down.'));
      const id = nextId++;
      const { promise, resolve, reject } = Promise.withResolvers<unknown>();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Hermes did not answer ${method}.`));
        // A connection that answers nothing is not one to wait on: it is opened again.
        current.terminate();
      }, CALL_TIMEOUT_MS);
      timer.unref();
      pending.set(id, { resolve, reject, timer });
      current.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      });
      return promise as Promise<T>;
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    close() {
      closed = true;
      clearTimeout(retry);
      failAll('Caduceus is stopping.');
      socket?.close();
    },
  };
}
