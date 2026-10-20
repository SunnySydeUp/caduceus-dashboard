// The worker log of a run (M3 #11; architecture §4 "Live relays"): `GET /_caduceus/api/work/runs/:runId/log/stream?board=` pushes what a worker
// writes while its run is going, as server-sent events. Hermes keeps one log per task (`GET /api/plugins/kanban/tasks/{id}/log`) and can only be
// asked for its last bytes, so Caduceus asks once for everyone who watches a run (`log-relay.ts`) and tells each watcher what is new. Before every ask
// of the log it asks Hermes for the run, and a run that has ended is the last answer: the lines that came with the end, and then `ended`.
// Nothing is kept beyond the last answer of a run somebody is watching (D1).
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { createRelay, type LogAnswer } from './log-relay.ts';
import { createRelayStreams, type RelayStreams } from './relay-stream.ts';

/** How much of the end of a task's log is asked for: Hermes rotates the file at 2 MiB, and its own cap on a read is 2,000,000 bytes. */
const TAIL_BYTES = 256_000;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RUN_ID = /^[1-9][0-9]{0,15}$/;

interface RunQuery {
  runId: number;
  /** The board the run is on; the current one when left out. */
  board?: string;
}

export interface RunLogDeps {
  backend: HermesBackend;
  /** How long after an answer the log is asked for again. */
  pollMs: number;
}

/** Hermes's lines of a log's tail: the last line's end is not a line, and when the window starts mid-file its first line may be cut. */
function linesOf(content: string, truncated: boolean): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return truncated && lines.length > 0 ? lines.slice(1) : lines;
}

/** Asks Hermes for the run (does it exist, has it ended, which task is it of), and then for the end of its task's worker log. */
function hermesRead(backend: HermesBackend) {
  return async (query: RunQuery, signal: AbortSignal): Promise<LogAnswer> => {
    if (backend.status.state !== 'ready') return { ok: false, rejected: false, message: 'Hermes is not running.' };
    const scope = query.board ? `?board=${encodeURIComponent(query.board)}` : '';
    const within = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    const runRes = await backend.fetch(`/api/plugins/kanban/runs/${query.runId}${scope}`, { signal: within });
    const run: unknown = await runRes.json().catch(() => undefined);
    if (!runRes.ok || !isRecord(run) || !isRecord(run.run) || typeof run.run.task_id !== 'string') {
      // A 4xx is Hermes saying the run itself is wrong (it has none by that number): asking again would only hear it again.
      return { ok: false, rejected: runRes.status >= 400 && runRes.status < 500, message: runRes.status === 404 ? `Hermes has no run ${query.runId}.` : `Hermes answered HTTP ${runRes.status}.` };
    }
    // The run is read before its log: a run seen ended has written everything its log will hold.
    const done = run.run.ended_at !== null && run.run.ended_at !== undefined;
    const logRes = await backend.fetch(`/api/plugins/kanban/tasks/${encodeURIComponent(run.run.task_id)}/log?tail=${TAIL_BYTES}${query.board ? `&board=${encodeURIComponent(query.board)}` : ''}`, { signal: within });
    const log: unknown = await logRes.json().catch(() => undefined);
    if (!logRes.ok || !isRecord(log) || typeof log.content !== 'string') return { ok: false, rejected: logRes.status >= 400 && logRes.status < 500, message: `Hermes answered HTTP ${logRes.status}.` };
    return { ok: true, lines: linesOf(log.content, log.truncated === true), ...(done ? { done: true as const } : {}) };
  };
}

/** The view a stream request names, or `undefined` when it is not a run of a board. */
function queryOf(runId: string, params: URLSearchParams): RunQuery | undefined {
  const board = params.get('board')?.trim() || undefined;
  if (!RUN_ID.test(runId) || (board !== undefined && !SLUG.test(board))) return undefined;
  return { runId: Number(runId), ...(board ? { board } : {}) };
}

export function mountRunLog(app: Hono<AuthEnv>, { backend, pollMs }: RunLogDeps): RelayStreams {
  const relay = createRelay<RunQuery>({ read: hermesRead(backend), keyOf: (query) => `${query.board ?? ''}:${query.runId}`, intervalMs: pollMs });
  const streams = createRelayStreams();

  app.get('/_caduceus/api/work/runs/:runId/log/stream', (c) => {
    const query = queryOf(c.req.param('runId'), new URL(c.req.url).searchParams);
    if (!query) return c.json({ error: 'bad-request' }, 400);
    return streams.respond(c.get('session')!.id, (listener) => relay.subscribe(query, listener));
  });

  return streams;
}
