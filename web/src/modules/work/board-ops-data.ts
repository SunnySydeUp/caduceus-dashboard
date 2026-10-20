// Reading what the board's operations show, from Hermes, each time and kept nowhere (D1): the side panel's stats, diagnostics and workers, the
// dispatcher's settings and mode, and the profiles a card can be given to. Only GETs live here; changes are `board-actions.ts`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { readBoards, readSettings, readSide, type BoardSide, type BoardSummary, type DispatcherSettings } from './board-ops.ts';
import type { BoardData } from './board-model.ts';

const KANBAN = '/api/plugins/kanban';

async function read(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  return response.json();
}

const withBoard = (path: string, slug: string | undefined) => (slug ? `${path}?board=${encodeURIComponent(slug)}` : path);

export interface SideState {
  phase: 'loading' | 'ready' | 'failed';
  side?: BoardSide;
}

/**
 * The board's stats, diagnostics and active workers. They are read again whenever the board is: every Kanban event (and every write made
 * through Caduceus) makes the live board load again, which hands this a new `board`, so a worker that ends or a task that moves shows here at once.
 */
export function useBoardSide(slug: string | undefined, board: BoardData | undefined): SideState {
  const [state, setState] = useState<SideState>({ phase: 'loading' });
  const asked = useRef(0);
  useEffect(() => {
    if (board === undefined) return;
    const turn = ++asked.current;
    void Promise.all([read(withBoard(`${KANBAN}/stats`, slug)), read(withBoard(`${KANBAN}/diagnostics`, slug)), read(withBoard(`${KANBAN}/workers/active`, slug))]).then(
      ([stats, diagnostics, workers]) => turn === asked.current && setState({ phase: 'ready', side: readSide({ stats, diagnostics, workers }) }),
      () => turn === asked.current && setState((previous) => ({ phase: 'failed', side: previous.side })),
    );
  }, [slug, board]);
  return state;
}

export interface DispatcherState {
  phase: 'loading' | 'ready' | 'failed';
  settings?: DispatcherSettings;
  /** Whether Hermes's gateway, which runs the dispatcher, is up. */
  gatewayRunning?: boolean;
  /** Reads Hermes again (after a save: the page shows what Hermes holds, not what it sent). */
  reload(): Promise<void>;
}

/** The dispatcher's settings and whether its gateway runs, from Hermes's config, orchestration and status endpoints. */
export function useDispatcher(): DispatcherState {
  const [state, setState] = useState<Omit<DispatcherState, 'reload'>>({ phase: 'loading' });
  const reload = useCallback(async () => {
    try {
      const [config, orchestration, status] = await Promise.all([read('/api/config'), read(`${KANBAN}/orchestration`), read('/api/status')]);
      const gateway = typeof status === 'object' && status !== null && 'gateway_running' in status ? status.gateway_running : undefined;
      setState({ phase: 'ready', settings: readSettings(config, orchestration), gatewayRunning: gateway === true });
    } catch {
      setState((previous) => ({ ...previous, phase: 'failed' }));
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  return { ...state, reload };
}

/** The profiles a card can be given to: Hermes's profiles on disk and whoever the board already names, with how many tasks each holds. */
export function useAssignees(slug: string | undefined): { name: string; count: number }[] {
  const [names, setNames] = useState<{ name: string; count: number }[]>([]);
  useEffect(() => {
    let current = true;
    void read(withBoard(`${KANBAN}/assignees`, slug)).then(
      (body) => {
        const listed = typeof body === 'object' && body !== null && 'assignees' in body && Array.isArray(body.assignees) ? body.assignees : [];
        if (!current) return;
        setNames(
          listed.flatMap((item): { name: string; count: number }[] => {
            if (typeof item !== 'object' || item === null || !('name' in item) || typeof item.name !== 'string') return [];
            const counts = 'counts' in item && typeof item.counts === 'object' && item.counts !== null ? Object.values(item.counts).reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0) : 0;
            return [{ name: item.name, count: counts }];
          }),
        );
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [slug]);
  return names;
}

export interface BoardList {
  boards: BoardSummary[];
  /** Reads the list again, after a board was created, renamed, archived or imported. */
  reload(): void;
}

/** Hermes's boards for the switcher. */
export function useBoardList(): BoardList {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    let current = true;
    void read(`${KANBAN}/boards`).then(
      (body) => current && setBoards(readBoards(body).boards),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [turn]);
  return { boards, reload: () => setTurn((previous) => previous + 1) };
}
