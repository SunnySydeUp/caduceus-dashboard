// Starting a playbook run and reading runs (M6 #02): `POST /_caduceus/api/work/playbooks/:id/runs` (Tier 1, so the owner confirms first) and
// `GET /_caduceus/api/work/playbook-runs[/:root]`. Caduceus stores no run: the server rebuilds each from Hermes Kanban on every request. The pages
// are told that a task changed by the board's events socket (never a poll) and then read again.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunDetail, RunSummary } from '@caduceus/contracts/playbook-runs';
import type { Playbook } from '@caduceus/contracts/playbooks';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { fetchTiered } from '../../tiered.ts';
import { loadBoardOnce } from './board-data.ts';
import { createLiveBoard } from './board-live.ts';
import { boardsOf, boardSignature, rawRowsOf, readRun, readRuns, rerunConfirmation, type RawTaskRow } from './playbook-runs-model.ts';
import { runConfirmation } from './playbook-model.ts';
import { usePlaybookLibrary } from './template-data.ts';
import { readTask } from './task-data.ts';
import type { PlaybookNames } from './task-playbook.ts';

const PLAYBOOKS = '/_caduceus/api/work/playbooks';
const RUNS = '/_caduceus/api/work/playbook-runs';
const KANBAN = '/api/plugins/kanban';

/** What came of pressing Run: it started (the root task names the run), the owner declined, or the server found problems with the answers. */
export type StartOutcome = { kind: 'started'; root: string; board: string; ref: string } | { kind: 'cancelled' } | { kind: 'problems'; problems: string[] };

/** Starts a run of `playbook` (Tier 1: the dialog names the playbook and the profiles). A failure other than a refused answer throws, in words. */
export async function startRun(playbook: Playbook, inputs: Record<string, string>, runAs?: string): Promise<StartOutcome> {
  let result;
  try {
    result = await fetchTiered({ method: 'POST', path: `${PLAYBOOKS}/${encodeURIComponent(playbook.id)}/runs`, body: { inputs, version: playbook.version, ...(runAs === undefined ? {} : { profile: runAs }) }, confirm: runConfirmation(playbook, runAs) });
  } catch {
    throw new Error('Caduceus did not answer.');
  }
  if (result.kind === 'cancelled') return { kind: 'cancelled' };
  if (result.kind === 'refused') throw new Error(result.refusal.message);
  const body: unknown = await result.response.json().catch(() => undefined);
  if (result.response.status === 400 && isRecord(body) && Array.isArray(body.problems)) return { kind: 'problems', problems: body.problems.filter((problem): problem is string => typeof problem === 'string') };
  if (result.response.status === 404) throw new Error('That playbook version is gone. Reload the page.');
  if (!result.response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : `Caduceus did not start the run (HTTP ${result.response.status}).`);
  if (!isRecord(body) || typeof body.root !== 'string' || typeof body.board !== 'string' || typeof body.ref !== 'string') throw new Error('Caduceus answered with something that is not a run.');
  return { kind: 'started', root: body.root, board: body.board, ref: body.ref };
}

/** What came of pressing Re-run: a new attempt began (`attempt` is its number), the owner declined, or the server found problems with the request. */
export type RerunOutcome = { kind: 'started'; stage: string; attempt: number } | { kind: 'cancelled' } | { kind: 'problems'; problems: string[] };

/** Starts a new attempt of one stage of a run (Tier 1: the dialog names the stage and the run, and says the stages that are done stay as they are). A failure other than a refused request throws, in words. */
export async function rerunStage(run: { root: string; board: string; title: string }, stage: { key: string; title: string }): Promise<RerunOutcome> {
  let result;
  try {
    result = await fetchTiered({ method: 'POST', path: `${RUNS}/${encodeURIComponent(run.root)}/rerun?board=${encodeURIComponent(run.board)}`, body: { stage: stage.key }, confirm: rerunConfirmation(run.title, stage.title) });
  } catch {
    throw new Error('Caduceus did not answer.');
  }
  if (result.kind === 'cancelled') return { kind: 'cancelled' };
  if (result.kind === 'refused') throw new Error(result.refusal.message);
  const body: unknown = await result.response.json().catch(() => undefined);
  if (result.response.status === 400 && isRecord(body) && Array.isArray(body.problems)) return { kind: 'problems', problems: body.problems.filter((problem): problem is string => typeof problem === 'string') };
  if (!result.response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : `Caduceus did not re-run the stage (HTTP ${result.response.status}).`);
  if (!isRecord(body) || typeof body.stage !== 'string' || typeof body.attempt !== 'number') throw new Error('Caduceus answered with something that is not an attempt.');
  return { kind: 'started', stage: body.stage, attempt: body.attempt };
}

/**
 * Calls `onChange` when a task changes on any of `boards`: each board is loaded and then followed over its events socket, and a load that differs from
 * the last (`boardSignature`) is the news. The first load is not news. A tab that comes back to the foreground, or a network that returns, reads again.
 */
export function useBoardChanges(boards: readonly string[], onChange: () => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  const key = boards.join('\n');
  useEffect(() => {
    const stops = key.split('\n').flatMap((slug) => {
      if (slug === '') return [];
      const query = `board=${encodeURIComponent(slug)}`;
      let seen: string | undefined;
      const live = createLiveBoard({
        fetchBoard: async () => {
          const response = await fetch(`${KANBAN}/board?${query}`);
          if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
          return response.json();
        },
        openEvents: async (since) => new WebSocket(`${location.origin.replace(/^http/, 'ws')}${KANBAN}/events?${query}&since=${since}`),
      });
      const stop = live.subscribe(() => {
        const board = live.state.board;
        if (!board) return;
        const signature = boardSignature(board);
        if (seen !== undefined && signature !== seen) latest.current();
        seen = signature;
      });
      const resume = () => {
        if (document.visibilityState === 'visible') live.resume();
      };
      document.addEventListener('visibilitychange', resume);
      window.addEventListener('online', resume);
      return [
        () => {
          stop();
          document.removeEventListener('visibilitychange', resume);
          window.removeEventListener('online', resume);
          live.close();
        },
      ];
    });
    return () => stops.forEach((stop) => stop());
  }, [key]);
}

/** The library's playbook names by id, for the Playbook filter and the labels that say which playbook a task came from. Empty until the library answers; a filter then shows ids. */
export function usePlaybookNames(): PlaybookNames {
  const { library } = usePlaybookLibrary();
  return useMemo(() => Object.fromEntries([...(library?.seeds ?? []), ...(library?.templates ?? [])].map((playbook) => [playbook.id, playbook.name])), [library]);
}

export type RunsState = { status: 'loading' } | { status: 'failed'; error: string } | { status: 'ready'; runs: RunSummary[] };

/** The server's own words for a read that failed, else a plain sentence. */
async function readFailure(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  return isRecord(body) && typeof body.message === 'string' ? body.message : `Caduceus answered HTTP ${response.status}.`;
}

/** Every run, read again when a task changes on a board that has runs (or the default board, where a new run starts). */
export function useRuns(): RunsState & { reload(): void } {
  const [state, setState] = useState<RunsState>({ status: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(RUNS, { signal: controller.signal }).then(
      async (response) => {
        if (controller.signal.aborted) return;
        setState(response.ok ? { status: 'ready', runs: readRuns(await response.json().catch(() => undefined)) } : { status: 'failed', error: await readFailure(response) });
      },
      () => !controller.signal.aborted && setState((previous) => (previous.status === 'ready' ? previous : { status: 'failed', error: 'Caduceus did not answer.' })),
    );
    return () => controller.abort();
  }, [round]);
  const reload = useCallback(() => setRound((previous) => previous + 1), []);
  useBoardChanges(state.status === 'ready' ? [...new Set(['default', ...boardsOf(state.runs)])] : [], reload);
  return { ...state, reload };
}

export type RunState = { status: 'loading' } | { status: 'missing' } | { status: 'failed'; error: string } | { status: 'ready'; run: RunDetail };

/** One run with its timeline, read again when a task changes on its board. */
export function useRun(root: string, board: string): RunState & { reload(): void } {
  const key = `${board}/${root}`;
  const [loaded, setLoaded] = useState<{ key: string; state: RunState }>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const done = (state: RunState) => !controller.signal.aborted && setLoaded({ key, state });
    fetch(`${RUNS}/${encodeURIComponent(root)}?board=${encodeURIComponent(board)}`, { signal: controller.signal }).then(
      async (response) => {
        if (response.status === 404) return done({ status: 'missing' });
        if (!response.ok) return done({ status: 'failed', error: await readFailure(response) });
        const run = readRun(await response.json().catch(() => undefined));
        done(run ? { status: 'ready', run } : { status: 'failed', error: 'Caduceus answered with something that is not a run.' });
      },
      // A failed reload keeps the run on screen; only a first read that fails is an error.
      () => !controller.signal.aborted && setLoaded((previous) => (previous?.key === key && previous.state.status === 'ready' ? previous : { key, state: { status: 'failed', error: 'Caduceus did not answer.' } })),
    );
    return () => controller.abort();
  }, [root, board, key, round]);
  const reload = useCallback(() => setRound((previous) => previous + 1), []);
  useBoardChanges([board], reload);
  return { ...(loaded?.key === key ? loaded.state : ({ status: 'loading' } as const)), reload };
}

/** A task of the run as the Raw view shows it: the board's fields and its Kanban links; `links` is missing when Hermes would not answer for this task. */
export interface RawTask extends RawTaskRow {
  links?: { parents: string[]; children: string[] };
}

export type RawState = { status: 'loading' } | { status: 'failed'; error: string } | { status: 'ready'; tasks: RawTask[] };

/**
 * The tasks behind a run, read from Hermes as they are: the board (`workflow_template_id`, `current_step_key`, `idempotency_key`, status) and each task's own
 * links (`GET /api/plugins/kanban/tasks/:id`, a plain read). It reads when the Raw view opens, and again whenever the run was read again.
 */
export function useRunRaw(run: Pick<RunDetail, 'root' | 'board' | 'timeline' | 'playbook'>): RawState & { retry(): void } {
  const [state, setState] = useState<RawState>({ status: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const board = await loadBoardOnce(run.board);
        const tasks = await Promise.all(
          rawRowsOf(run, board.tasks).map(async (row): Promise<RawTask> => {
            const detail = await readTask(row.id, run.board).catch(() => undefined);
            return detail ? { ...row, links: detail.links } : row;
          }),
        );
        if (current) setState({ status: 'ready', tasks });
      } catch (error) {
        if (current) setState((previous) => (previous.status === 'ready' ? previous : { status: 'failed', error: error instanceof Error ? error.message : 'Hermes did not answer.' }));
      }
    })();
    return () => {
      current = false;
    };
  }, [run, round]);
  const retry = useCallback(() => {
    setState((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }));
    setRound((previous) => previous + 1);
  }, []);
  return { ...state, retry };
}
