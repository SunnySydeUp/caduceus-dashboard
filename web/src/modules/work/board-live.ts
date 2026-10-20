// The live board: Hermes's board loaded over REST and kept current by the Kanban events WebSocket (architecture §3). No DOM and
// no React, so a test can run it against a server. Nothing is stored: the board is whatever Hermes last said (D1).
//
// Every event, and every announcement that Hermes was written to through Caduceus, makes the engine load the board again
// (one load at a time, a burst of events one load). The events say only that something changed, which is all the page needs:
// Hermes records no event for a delete, and a reload is what shows one. After a dropped socket, or when the page comes back to
// the foreground, the board is loaded again before the socket is, so a card that changed while the page was away is never stale.
import { isStableOpen, reconnectBackoffDelayMs, type ReconnectBackoffOptions } from '@caduceus/contracts/hermes/shared/reconnect-backoff';
import { parseBoard, type BoardData } from './board-model.ts';

export interface LiveBoardState {
  /** `loading` until the first answer; `failed` while Hermes has given no board (the last good one, if any, is still in `board`). */
  phase: 'loading' | 'ready' | 'failed';
  board?: BoardData;
  /** Why the last load failed. */
  error?: string;
  /** The events socket is open: the board follows Hermes by itself. */
  live: boolean;
}

export interface LiveBoardOptions {
  /** Reads `GET /api/plugins/kanban/board` for the board being shown; rejects when Hermes does not answer. */
  fetchBoard(): Promise<unknown>;
  /** Opens the events socket for the board, from after event `since`. */
  openEvents(since: number): Promise<WebSocket>;
  /** How long after an event the board is loaded again, so that a burst of events is one load. */
  coalesceMs?: number;
  backoff?: ReconnectBackoffOptions;
}

export interface LiveBoard {
  readonly state: LiveBoardState;
  /** Calls `listener` whenever `state` changes; returns how to stop. */
  subscribe(listener: () => void): () => void;
  /** The page is visible and online again: load the board now, and dial the socket if it is down. */
  resume(): void;
  /** Stops everything: the socket, the timers. */
  close(): void;
}

const DEFAULT_COALESCE_MS = 100;

export function createLiveBoard({ fetchBoard, openEvents, coalesceMs = DEFAULT_COALESCE_MS, backoff }: LiveBoardOptions): LiveBoard {
  let state: LiveBoardState = { phase: 'loading', live: false };
  const listeners = new Set<() => void>();
  let socket: WebSocket | undefined;
  let closed = false;
  let loading = false;
  /** Something changed while a load was under way: its answer may predate it. */
  let dirty = false;
  let failures = 0;
  let dialing = false;
  /** A socket has been open before: the next one to open is a return, not the first. */
  let reconnected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: Partial<LiveBoardState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const later = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void load(), ms);
  };

  /** The socket went away (or never opened): load the board, which dials it again, after a backoff. */
  const retryLater = () => later(reconnectBackoffDelayMs(failures++, backoff));

  async function dial(since: number) {
    dialing = true;
    let opened: WebSocket;
    try {
      opened = await openEvents(since);
    } catch {
      retryLater();
      return;
    } finally {
      dialing = false;
    }
    if (closed) {
      opened.close();
      return;
    }
    socket = opened;
    let openedAt: number | null = null;
    const onOpen = () => {
      openedAt = Date.now();
      set({ live: true });
      // A socket that comes back after a drop has missed whatever happened meanwhile, and a delete leaves no event to resume from:
      // the board is loaded again now that nothing can slip between the load and the socket.
      if (reconnected) later(0);
      reconnected = true;
    };
    opened.addEventListener('message', (event) => {
      // Any frame of the stream means the board may have changed: `{ events, cursor }` from Hermes, `{ written }` from Caduceus.
      if (socket !== opened || typeof event.data !== 'string') return;
      if (loading) dirty = true;
      else later(coalesceMs);
    });
    opened.addEventListener('close', () => {
      if (socket !== opened) return;
      socket = undefined;
      if (closed) return;
      // A connection that held for a while was a good one; one that opens and dies at once climbs the ladder like a refusal.
      if (isStableOpen(openedAt)) failures = 0;
      set({ live: false });
      retryLater();
    });
    opened.addEventListener('open', onOpen, { once: true });
    if (opened.readyState === WebSocket.OPEN) onOpen();
  }

  async function load() {
    if (closed) return;
    if (loading) {
      dirty = true;
      return;
    }
    clearTimeout(timer);
    loading = true;
    dirty = false;
    try {
      const board = parseBoard(await fetchBoard());
      if (closed) return;
      set({ phase: 'ready', board, error: undefined });
      // The socket resumes after the last event this board already reflects, so nothing between the load and the dial is lost.
      if (!socket && !dialing) void dial(board.latestEventId);
    } catch (error) {
      if (closed) return;
      set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
      retryLater();
    } finally {
      loading = false;
    }
    if (dirty && !closed) await load();
  }

  void load();

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resume() {
      failures = 0;
      void load();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      listeners.clear();
      const open = socket;
      socket = undefined;
      open?.close();
    },
  };
}
