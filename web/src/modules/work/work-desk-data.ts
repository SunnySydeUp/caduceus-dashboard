// Reading everything Work's landing view groups, kept live. The tasks of every Hermes board (the board list, then one live board each: the REST board
// and the Kanban events socket the Board uses), the schedules (`useJobs`) and the runs (`useInbox`) come from their own readers; nothing is kept here (D1).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { openEvents } from './board-data.ts';
import { readBoards } from './board-ops.ts';
import type { BoardTask } from './board-model.ts';
import { createLiveBoard, type LiveBoard, type LiveBoardState } from './board-live.ts';

const KANBAN = '/api/plugins/kanban';

async function read(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  return response.json();
}

export interface AllBoards {
  /** The tasks of each board that has answered, with the board's slug. */
  boards: { slug: string; tasks: BoardTask[] }[];
  /** No board has answered yet, so there is nothing to show. */
  loading: boolean;
  /** The list of boards, or a board, did not answer: what is in `boards` may be out of date or incomplete. */
  failed: boolean;
  /** Asks again now: the list of boards, and every board. */
  retry(): void;
}

/**
 * Every board of Hermes, each loaded and kept current by its events socket, and loaded again when the tab comes back to the foreground or the network
 * returns (a phone that slept shows no stale card). The list of boards is read again then too, which is how a board made elsewhere joins.
 */
export function useAllBoards(): AllBoards {
  const [slugs, setSlugs] = useState<string[]>();
  const [listFailed, setListFailed] = useState(false);
  const [states, setStates] = useState<Record<string, LiveBoardState>>({});
  const [engines, setEngines] = useState<Record<string, LiveBoard>>({});

  const loadList = useCallback(async () => {
    try {
      const { boards } = readBoards(await read(`${KANBAN}/boards`));
      // The list changing is the only reason to rebuild the boards: the same slugs keep the sockets they have.
      setSlugs((previous) => (previous && previous.join('\n') === boards.map((board) => board.slug).join('\n') ? previous : boards.map((board) => board.slug)));
      setListFailed(false);
    } catch {
      setListFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadList();
    const resume = () => {
      if (document.visibilityState === 'visible') void loadList();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [loadList]);

  useEffect(() => {
    if (!slugs) return;
    const made = Object.fromEntries(
      slugs.map((slug) => [slug, createLiveBoard({ fetchBoard: () => read(`${KANBAN}/board?board=${encodeURIComponent(slug)}`), openEvents: (since) => openEvents(slug, since) })]),
    );
    setEngines(made);
    setStates(Object.fromEntries(Object.entries(made).map(([slug, engine]) => [slug, engine.state])));
    const stops = Object.entries(made).map(([slug, engine]) => engine.subscribe(() => setStates((previous) => ({ ...previous, [slug]: engine.state }))));
    const resume = () => {
      if (document.visibilityState === 'visible') for (const engine of Object.values(made)) engine.resume();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      for (const stop of stops) stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      for (const engine of Object.values(made)) engine.close();
    };
  }, [slugs]);

  const retry = useCallback(() => {
    void loadList();
    for (const engine of Object.values(engines)) engine.resume();
  }, [loadList, engines]);

  return useMemo(() => {
    const answered = (slugs ?? []).flatMap((slug) => {
      const board = states[slug]?.board;
      return board ? [{ slug, tasks: board.tasks }] : [];
    });
    const someFailed = (slugs ?? []).some((slug) => states[slug]?.phase === 'failed');
    const settledAll = slugs !== undefined && slugs.every((slug) => states[slug]?.phase === 'ready' || states[slug]?.phase === 'failed');
    return { boards: answered, loading: !listFailed && !settledAll, failed: listFailed || someFailed, retry };
  }, [slugs, states, listFailed, retry]);
}
