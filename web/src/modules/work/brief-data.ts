// Reading Hermes for the Brief editor: the profiles a task can be given to, and one task to edit or copy. Only GETs live here; saving goes through
// `brief-actions.ts`. Nothing is kept: Hermes is asked when a screen opens (D1).
import { useCallback, useEffect, useState } from 'react';
import { parseProfileHomes } from './job-form.ts';
import { parseTaskDetail, type TaskDetail } from './task-model.ts';

async function read(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  return response.json();
}

export interface Loaded<Value> {
  /** `loading` until Hermes has answered; `failed` when it did not. */
  status: 'loading' | 'ready' | 'failed';
  value: Value | undefined;
  reload(): void;
}

function useRead<Value>(load: () => Promise<Value>, key: string): Loaded<Value> {
  const [state, setState] = useState<{ status: Loaded<Value>['status']; value: Value | undefined }>({ status: 'loading', value: undefined });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setState((previous) => ({ ...previous, status: 'loading' }));
    void load().then(
      (value) => current && setState({ status: 'ready', value }),
      () => current && setState((previous) => ({ ...previous, status: 'failed' })),
    );
    return () => {
      current = false;
    };
    // `key` stands for what `load` closes over.
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: useCallback(() => setAttempt((count) => count + 1), []) };
}

/** Hermes's profiles: their names, and the home of each (a Create-task job's script goes in the `scripts/` folder of one). */
export interface Profiles {
  names: string[];
  homes: Record<string, string>;
}

export const useProfiles = (): Loaded<Profiles> =>
  useRead(async () => {
    const homes = parseProfileHomes(await read('/api/profiles'));
    return { names: Object.keys(homes), homes };
  }, 'profiles');

/** One task, as its page reads it, for the editor to edit or copy. */
export const useTaskToEdit = (taskId: string | undefined, board: string | undefined): Loaded<TaskDetail | null> =>
  useRead(async () => (taskId === undefined ? null : parseTaskDetail(await read(`/api/plugins/kanban/tasks/${encodeURIComponent(taskId)}${board ? `?board=${encodeURIComponent(board)}` : ''}`))), `${taskId}|${board}`);
