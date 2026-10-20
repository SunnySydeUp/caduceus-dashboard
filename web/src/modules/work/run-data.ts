// Reading one run for its page (M3 #11): the run, the live figures of its worker, the worker's session in Hermes's store and that session's rows, and the
// worker log's live stream. Only GETs live here; every change goes through `task-actions.ts`. Nothing is kept beyond what the page shows (D1): there is
// no table that links runs and sessions, so the session is looked for in Hermes every time (`pickRunSession`).
import { useEffect, useRef, useState } from 'react';
import type { HistoryRow } from '../chat/history-window.ts';
import { streamHub } from '../../live-stream.ts';
import { emptyBuffer, receive, release, type LogBuffer, type LogUpdate } from '../logs/logs-model.ts';
import { MAX_ROWS, parseInspect, parseRun, parseSessionRows, pickRunSession, ROW_PAGE, rowsPath, SESSION_PAGE, sessionsPath, stepsOf, type RunInfo, type RunStep, type WorkerProcess, type WorkerSession } from './run-model.ts';

const KANBAN = '/api/plugins/kanban';
const boardQuery = (slug: string | undefined) => (slug ? `?board=${encodeURIComponent(slug)}` : '');

async function read(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  return response.json();
}

export const readRun = async (runId: number, slug: string | undefined): Promise<RunInfo> => parseRun(await read(`${KANBAN}/runs/${runId}${boardQuery(slug)}`));

export type RunPhase = 'loading' | 'ready' | 'missing' | 'failed';

/** The run `runId`, read again each time `refresh` changes (the page does when its task changes), and its live worker figures while it goes. */
export function useRun(runId: number, slug: string | undefined, refresh: unknown): { run: RunInfo | undefined; phase: RunPhase; process: WorkerProcess | undefined; reload(): void } {
  const [state, setState] = useState<{ run?: RunInfo; phase: RunPhase }>({ phase: 'loading' });
  const [process, setProcess] = useState<WorkerProcess>();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    setState({ phase: 'loading' });
    setProcess(undefined);
  }, [runId, slug]);
  useEffect(() => {
    let current = true;
    readRun(runId, slug).then(
      (run) => current && setState({ run, phase: 'ready' }),
      (error: unknown) => current && setState((before) => ({ run: before.run, phase: before.run === undefined && error instanceof Error && error.message.endsWith('404') ? 'missing' : 'failed' })),
    );
    return () => void (current = false);
  }, [runId, slug, refresh, nonce]);
  const going = state.run !== undefined && state.run.endedAt === null;
  useEffect(() => {
    if (!going) return setProcess(undefined);
    let current = true;
    read(`${KANBAN}/runs/${runId}/inspect${boardQuery(slug)}`).then(
      (body) => current && setProcess(parseInspect(body)),
      () => current && setProcess(undefined),
    );
    return () => void (current = false);
  }, [going, runId, slug, refresh, nonce]);
  return { run: state.run, phase: state.phase, process, reload: () => setNonce((n) => n + 1) };
}

/** The worker's session: looked for in the run's profile's Kanban sessions, newest first, a page at a time, until one that started with the run or none newer than it. */
async function findSession(run: RunInfo): Promise<WorkerSession | undefined> {
  for (let offset = 0; ; offset += SESSION_PAGE) {
    const page = parseSessionRows(await read(sessionsPath(run, offset)));
    const found = pickRunSession(run, page);
    if (found) return found;
    // Pages are newest first: a page that reaches back before the run has nothing more to find.
    if (page.length < SESSION_PAGE || page.some((session) => session.startedAt < run.startedAt - 60)) return undefined;
  }
}

/** The rows of the session, oldest first: `MAX_ROWS` at most (a longer transcript is for Chat). */
async function readRows(session: WorkerSession, profile: string | null): Promise<{ rows: HistoryRow[]; truncated: boolean }> {
  const rows: HistoryRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += ROW_PAGE) {
    const body = await read(rowsPath(session.id, profile, offset));
    const page: HistoryRow[] = typeof body === 'object' && body !== null && 'messages' in body && Array.isArray(body.messages) ? (body.messages as HistoryRow[]) : [];
    rows.push(...page);
    if (page.length < ROW_PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export interface SessionState {
  phase: 'looking' | 'none' | 'ready' | 'failed';
  session?: WorkerSession;
  steps: RunStep[];
  /** The transcript is longer than the page reads. */
  truncated: boolean;
}

/**
 * The run's session and its steps. They are read when the run changes and again each time `activity` changes: the worker log's stream says the worker
 * did something (the page raises it, a few seconds apart at most), which is as live as Hermes lets a worker's session be, since it keeps no stream of it.
 */
export function useRunSession(run: RunInfo | undefined, activity: number): SessionState {
  const [state, setState] = useState<SessionState>({ phase: 'looking', steps: [], truncated: false });
  const known = useRef<{ runId: number; session: WorkerSession } | undefined>(undefined);
  const finished = run !== undefined && run.endedAt !== null;
  const runId = run?.id;
  const profile = run?.profile ?? null;
  useEffect(() => {
    if (!run) return;
    let current = true;
    (async () => {
      let session = known.current?.runId === run.id ? known.current.session : undefined;
      session ??= await findSession(run);
      if (!current) return;
      if (!session) {
        setState((before) => (before.phase === 'ready' ? before : { phase: 'none', steps: [], truncated: false }));
        return;
      }
      known.current = { runId: run.id, session };
      const { rows, truncated } = await readRows(session, profile);
      if (current) setState({ phase: 'ready', session, steps: stepsOf(rows, { finished }), truncated });
    })().catch(() => current && setState((before) => ({ ...before, phase: before.phase === 'ready' ? 'ready' : 'failed' })));
    return () => void (current = false);
    // `run` is read for what the lookup needs; a new object of the same run is not a reason to ask again.
  }, [runId, finished, activity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    known.current = undefined;
    setState({ phase: 'looking', steps: [], truncated: false });
  }, [runId]);
  return state;
}

// ── The worker log ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RunLogState {
  buffer: LogBuffer;
  /** The run ended and the log holds everything: the stream is closed. */
  ended: boolean;
  /** The reader is at the end (or has not scrolled away): lines go straight on screen. */
  following: boolean;
  setFollowing(following: boolean): void;
  /** Takes what waited for the reader onto the screen. */
  catchUp(): void;
}

/**
 * The worker log of a run as Caduceus relays it (`server/src/run-log.ts`): one `EventSource` while the page is open. A dropped connection is reconnected by
 * the browser, and the server then says the log whole. When the run ends the server says `ended` and the stream is closed here: that is the end of the tail.
 * `onLines` is told when the log grew, so the page can read the worker's steps again.
 */
export function useRunLog(runId: number, slug: string | undefined, onLines: () => void): RunLogState {
  const [buffer, setBuffer] = useState<LogBuffer>(emptyBuffer);
  const [ended, setEnded] = useState(false);
  const [following, setFollowingState] = useState(true);
  const holding = useRef(false);
  const heard = useRef(onLines);
  heard.current = onLines;
  holding.current = !following;

  useEffect(() => {
    setBuffer(emptyBuffer);
    setEnded(false);
    setFollowingState(true);
    // The hub closes the stream while the tab is hidden and opens it again on return; the server then says the log whole.
    const stop = streamHub().subscribe(`/_caduceus/api/work/runs/${runId}/log/stream${boardQuery(slug)}`, {
      events: ['replace', 'append', 'unavailable', 'rejected', 'ended'],
      onEvent: (kind, data) => {
        if (kind === 'ended') {
          setEnded(true);
          stop();
          return;
        }
        const update = JSON.parse(data) as LogUpdate;
        setBuffer((before) => receive(before, update, holding.current));
        if (update.kind === 'replace' || update.kind === 'append') heard.current();
        // A refusal is final; left open, the browser would ask again and hear the same refusal.
        if (kind === 'rejected') stop();
      },
      onError: (final) => {
        if (final) setBuffer((before) => ({ ...before, phase: 'unavailable', message: 'Caduceus closed the log stream. Sign in again, or reload the page.' }));
        else setBuffer((before) => ({ ...before, phase: 'unavailable', message: 'The connection to Caduceus dropped. Reconnecting…' }));
      },
    });
    return stop;
  }, [runId, slug]);

  return {
    buffer,
    ended,
    following,
    setFollowing: (next) => {
      setFollowingState(next);
      if (next) setBuffer((before) => release(before));
    },
    catchUp: () => {
      setFollowingState(true);
      setBuffer((before) => release(before));
    },
  };
}
