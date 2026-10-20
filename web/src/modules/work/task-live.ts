// The open task page's live view: one task loaded over REST and kept current by the Kanban events socket (architecture §3). No DOM
// and no React, so a test can run it against a stub. Nothing is stored: the task is whatever Hermes last said (D1).
//
// An event of this task, or an announcement that Hermes was written to through Caduceus (a delete leaves no event), makes the
// engine read the task again: one read at a time, a burst of events one read. After a dropped socket the task is read before the
// socket is dialled again, so a change made while the page was away is never missed.
import { isStableOpen, reconnectBackoffDelayMs, type ReconnectBackoffOptions } from '@caduceus/contracts/hermes/shared/reconnect-backoff';
import { parseTaskDetail, type TaskDetail } from './task-model.ts';

export interface LiveTaskState {
  /** `loading` until the first answer; `failed` while Hermes has given no task (the last good one, if any, is still in `detail`). */
  phase: 'loading' | 'ready' | 'failed';
  detail?: TaskDetail;
  /** Why the last read failed. */
  error?: string;
  /** The events socket is open: the page follows Hermes by itself. */
  live: boolean;
}

export interface LiveTaskOptions {
  /** Reads `GET /api/plugins/kanban/tasks/{id}`; rejects when Hermes does not answer. */
  fetchTask(): Promise<unknown>;
  /** Opens the events socket of the board, from after event `since`. */
  openEvents(since: number): Promise<WebSocket>;
  /** How long after an event the task is read again, so that a burst of events is one read. */
  coalesceMs?: number;
  backoff?: ReconnectBackoffOptions;
}

export interface LiveTask {
  readonly state: LiveTaskState;
  /** Calls `listener` whenever `state` changes; returns how to stop. */
  subscribe(listener: () => void): () => void;
  /** The page is visible and online again: read the task now, and dial the socket if it is down. */
  resume(): void;
  /** Stops everything: the socket, the timers. */
  close(): void;
}

const DEFAULT_COALESCE_MS = 100;
const SOCKET_OPEN = 1;

/** Whether a frame of the events stream is news for this task. A frame that is not JSON is taken as news: reading again is cheap. */
function concerns(taskId: string | undefined, data: string): boolean {
  let frame: unknown;
  try {
    frame = JSON.parse(data);
  } catch {
    return true;
  }
  if (typeof frame !== 'object' || frame === null) return true;
  if ('written' in frame) return true;
  if (!('events' in frame) || !Array.isArray(frame.events)) return true;
  return taskId === undefined || frame.events.some((event: unknown) => typeof event === 'object' && event !== null && 'task_id' in event && event.task_id === taskId);
}

export function createLiveTask({ fetchTask, openEvents, coalesceMs = DEFAULT_COALESCE_MS, backoff }: LiveTaskOptions): LiveTask {
  let state: LiveTaskState = { phase: 'loading', live: false };
  const listeners = new Set<() => void>();
  let socket: WebSocket | undefined;
  let closed = false;
  let loading = false;
  /** Something changed while a read was under way: its answer may predate it. */
  let dirty = false;
  let failures = 0;
  let dialing = false;
  /** A socket has been open before: the next one to open is a return, not the first. */
  let reconnected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: Partial<LiveTaskState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const later = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void load(), ms);
  };

  /** The socket went away (or never opened): read the task, which dials it again, after a backoff. */
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
      // A socket that comes back after a drop has missed whatever happened meanwhile: read the task now that nothing can slip between.
      if (reconnected) later(0);
      reconnected = true;
    };
    opened.addEventListener('message', (event) => {
      if (socket !== opened || typeof event.data !== 'string' || !concerns(state.detail?.task.id, event.data)) return;
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
    if (opened.readyState === SOCKET_OPEN) onOpen();
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
      const detail = parseTaskDetail(await fetchTask());
      if (closed) return;
      set({ phase: 'ready', detail, error: undefined });
      // The socket resumes after the last event this task already reflects, so nothing between the read and the dial is lost.
      if (!socket && !dialing) void dial(detail.latestEventId);
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
