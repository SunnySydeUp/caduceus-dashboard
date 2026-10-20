// The log relay (M5 #06; architecture §4 "Live relays", R12). Hermes can only be asked for the last lines of a log, never to push
// them, so Caduceus asks once for everyone who watches the same view (the same file, level, component, search, length and profile)
// and tells each watcher what is new. Hermes sees one reader however many tabs are open; the relay stops asking when the last
// watcher of a view leaves. Nothing is kept beyond the last answer of a view that somebody is watching.

/** One view of a log: Hermes's own query parameters for `GET /api/logs`. */
export interface LogQuery {
  file: string;
  /** How many lines Hermes is asked for (at most 500; it caps the answer itself). */
  lines: number;
  level?: string;
  component?: string;
  search?: string;
  profile?: string;
}

/** What Hermes answered: the last lines (without their line ends), or why it could not. `rejected` is a refusal that asking again will not change (an unknown component). */
export type LogAnswer =
  /** `done` says the source is finished and will not grow (a run that has ended): this answer is the last. */
  | { ok: true; lines: string[]; done?: true }
  | { ok: false; rejected: boolean; message: string };

export type LogRead<Q = LogQuery> = (query: Q, signal: AbortSignal) => Promise<LogAnswer>;

/** What a watcher is told: `replace` is the whole view (the first answer, or the log changed under it), `append` the lines that followed. */
export type LogUpdate =
  | { kind: 'replace'; lines: string[] }
  | { kind: 'append'; lines: string[] }
  /** Hermes cannot be read for now. The relay keeps asking, and says `replace` when it can again. */
  | { kind: 'unavailable'; message: string }
  /** Hermes refuses this view for good: the watcher gets no more. */
  | { kind: 'rejected'; message: string }
  /** The source is finished (`done`): the watcher has all of it, and gets no more. */
  | { kind: 'ended' };

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}

export interface LogRelayOptions<Q = LogQuery> {
  read: LogRead<Q>;
  /** What makes two queries the same view: they share one ask. */
  keyOf: (query: Q) => string;
  /** How long after an answer the next ask is made (architecture §4: 1–2 s). */
  intervalMs: number;
  timers?: Timers;
}

export interface LogRelay<Q = LogQuery> {
  /** Watches `query`; the listener is told the view at once if it is known, and then what changes. Returns the way to stop watching. */
  subscribe(query: Q, listener: (update: LogUpdate) => void): () => void;
}

/**
 * What a new answer adds to the lines a watcher already has. The answer is Hermes's last N lines, so what is new is whatever follows
 * the longest end of `previous` that the answer begins with. Lines that share nothing with it mean the log was cleared, rotated or
 * ran on past the window, and the watcher is given the answer whole. Equal consecutive lines can make an overlap ambiguous; the
 * longest one is taken, which never drops a line that was written.
 */
export function newLines(previous: readonly string[], next: readonly string[]): Extract<LogUpdate, { kind: 'append' | 'replace' }> | undefined {
  if (previous.length === 0) return next.length === 0 ? undefined : { kind: 'append', lines: [...next] };
  for (let shared = Math.min(previous.length, next.length); shared > 0; shared--) {
    const from = previous.length - shared;
    let same = true;
    for (let i = 0; i < shared && same; i++) same = previous[from + i] === next[i];
    if (!same) continue;
    if (shared === next.length) return shared === previous.length ? undefined : { kind: 'replace', lines: [...next] };
    return { kind: 'append', lines: next.slice(shared) };
  }
  return { kind: 'replace', lines: [...next] };
}

interface Tail<Q> {
  query: Q;
  listeners: Set<(update: LogUpdate) => void>;
  /** The lines the watchers have; `undefined` until Hermes has answered. */
  last: string[] | undefined;
  /** Hermes could not be read at the last ask: the next answer replaces the view. */
  down: boolean;
  rejected: string | undefined;
  /** The source finished: nothing more will be asked. */
  ended: boolean;
  timer: unknown;
  asking: AbortController | undefined;
}

/** The relay of a view of a log file: views with the same file, level, component, search, length and profile are one. */
export function createLogRelay(options: Omit<LogRelayOptions, 'keyOf'>): LogRelay {
  return createRelay({ ...options, keyOf: (query) => JSON.stringify([query.file, query.lines, query.level ?? '', query.component ?? '', query.search ?? '', query.profile ?? '']) });
}

/** The relay of any view that is asked for as its last lines: the log pages' views, and the worker log of a run. */
export function createRelay<Q>({ read, keyOf, intervalMs, timers = { set: (run, ms) => setTimeout(run, ms), clear: (timer) => clearTimeout(timer as NodeJS.Timeout) } }: LogRelayOptions<Q>): LogRelay<Q> {
  const tails = new Map<string, Tail<Q>>();

  const tell = (tail: Tail<Q>, update: LogUpdate) => {
    for (const listener of [...tail.listeners]) listener(update);
  };

  const poll = async (key: string, tail: Tail<Q>): Promise<void> => {
    const asking = new AbortController();
    tail.asking = asking;
    let answer: LogAnswer;
    try {
      answer = await read(tail.query, asking.signal);
    } catch (error) {
      answer = { ok: false, rejected: false, message: error instanceof Error ? error.message : 'Hermes did not answer.' };
    }
    // Everyone left while Hermes was answering.
    if (tails.get(key) !== tail || asking.signal.aborted) return;
    tail.asking = undefined;
    if (answer.ok) {
      if (tail.last === undefined || tail.down) {
        tail.last = answer.lines;
        tail.down = false;
        tell(tail, { kind: 'replace', lines: answer.lines });
      } else {
        const update = newLines(tail.last, answer.lines);
        tail.last = answer.lines;
        if (update) tell(tail, update);
      }
      if (answer.done) {
        tail.ended = true;
        tell(tail, { kind: 'ended' });
        return;
      }
    } else if (answer.rejected) {
      tail.rejected = answer.message;
      tell(tail, { kind: 'rejected', message: answer.message });
      return;
    } else if (!tail.down) {
      tail.down = true;
      tell(tail, { kind: 'unavailable', message: answer.message });
    }
    tail.timer = timers.set(() => void poll(key, tail), intervalMs);
  };

  return {
    subscribe(query, listener) {
      const key = keyOf(query);
      let tail = tails.get(key);
      if (!tail) {
        tail = { query, listeners: new Set(), last: undefined, down: false, rejected: undefined, ended: false, timer: undefined, asking: undefined };
        tails.set(key, tail);
        void poll(key, tail);
      }
      tail.listeners.add(listener);
      if (tail.rejected !== undefined) listener({ kind: 'rejected', message: tail.rejected });
      else if (tail.last !== undefined) {
        listener({ kind: 'replace', lines: tail.last });
        if (tail.ended) listener({ kind: 'ended' });
      }
      const joined = tail;
      return () => {
        if (!joined.listeners.delete(listener) || joined.listeners.size > 0) return;
        tails.delete(key);
        if (joined.timer !== undefined) timers.clear(joined.timer);
        joined.asking?.abort();
      };
    },
  };
}
