// Reading Hermes's Kanban for Work › Board. Only GETs live here: this ticket's board is read-only (operations come later, through
// `fetchTiered`). Nothing is kept beyond what the page shows (D1): the board comes from Hermes on every load.
import { useEffect, useRef, useState } from 'react';
import { createLiveBoard, type LiveBoard, type LiveBoardState } from './board-live.ts';
import { parseBoard, parsePeek, type BoardData, type TaskPeek } from './board-model.ts';

const KANBAN = '/api/plugins/kanban';

async function read(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  return response.json();
}

/** The query that names a board; without one Hermes uses the board that is current. */
const boardQuery = (slug: string | undefined) => (slug ? `board=${encodeURIComponent(slug)}` : '');

/** The events socket of a board, from after event `since`; the owner's session cookie goes along as it does for every request. */
export async function openEvents(slug: string | undefined, since: number): Promise<WebSocket> {
  const query = [boardQuery(slug), `since=${since}`].filter(Boolean).join('&');
  return new WebSocket(`${location.origin.replace(/^http/, 'ws')}${KANBAN}/events?${query}`);
}

/**
 * The board of `slug` (the current one when `undefined`), loaded and then kept live by the events socket. It is loaded
 * again when the tab comes back to the foreground or the network returns, so a phone that slept shows no stale card.
 */
export function useLiveBoard(slug: string | undefined, hermesFilter = ''): { state: LiveBoardState; retry(): void } {
  const [state, setState] = useState<LiveBoardState>({ phase: 'loading', live: false });
  const engine = useRef<LiveBoard>(undefined);
  const shownSlug = useRef(slug);
  useEffect(() => {
    // Another board is a different page; another filter of the same board keeps what is there until Hermes answers (a list applies every condition again).
    const sameBoard = shownSlug.current === slug;
    shownSlug.current = slug;
    setState((previous) => (sameBoard && previous.board ? { phase: 'ready', board: previous.board, live: false } : { phase: 'loading', live: false }));
    // `hermesFilter` is `?tenant=…` and the like, the conditions Hermes answers itself (`hermesQuery`).
    const query = new URLSearchParams(hermesFilter);
    if (slug) query.set('board', slug);
    const text = query.toString();
    const live = createLiveBoard({
      fetchBoard: () => read(`${KANBAN}/board${text ? `?${text}` : ''}`),
      openEvents: (since) => openEvents(slug, since),
    });
    engine.current = live;
    const stop = live.subscribe(() => setState(live.state));
    const resume = () => {
      if (document.visibilityState === 'visible') live.resume();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      live.close();
    };
  }, [slug, hermesFilter]);
  return { state, retry: () => engine.current?.resume() };
}

/** The board of `slug` as Hermes has it, read once and not followed: what a picker lists the playbooks and projects from while a filter has narrowed the live board. */
export async function loadBoardOnce(slug: string | undefined): Promise<BoardData> {
  return parseBoard(await read(`${KANBAN}/board${slug ? `?${boardQuery(slug)}` : ''}`));
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

/** Hermes's projects by id, for the project filter and the card meta. What Hermes did not answer is empty: the page falls back to the project id. */
export function useProjectNames(): Record<string, string> {
  const [projects, setProjects] = useState<Record<string, string>>({});
  useEffect(() => {
    let current = true;
    void read(`${KANBAN}/projects`).then(
      (body) => {
        const named = record(body).projects;
        if (!current) return;
        setProjects(
          Object.fromEntries(
            (Array.isArray(named) ? named : []).flatMap((item) => {
              const project = record(item);
              return typeof project.id === 'string' && typeof project.name === 'string' ? [[project.id, project.name]] : [];
            }),
          ),
        );
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  return projects;
}

export interface PeekState {
  phase: 'loading' | 'ready' | 'failed';
  peek?: TaskPeek;
}

/** One task for the peek and the task page, read from Hermes each time it is opened. */
export function useTaskPeek(taskId: string, slug: string | undefined): PeekState {
  const [state, setState] = useState<PeekState>({ phase: 'loading' });
  useEffect(() => {
    let current = true;
    setState({ phase: 'loading' });
    const query = boardQuery(slug);
    read(`${KANBAN}/tasks/${encodeURIComponent(taskId)}${query ? `?${query}` : ''}`)
      .then(parsePeek)
      .then(
        (peek) => current && setState({ phase: 'ready', peek }),
        () => current && setState({ phase: 'failed' }),
      );
    return () => {
      current = false;
    };
  }, [taskId, slug]);
  return state;
}
