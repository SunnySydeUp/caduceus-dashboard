// What the Diagnostics screen reads (M5 #13): the install facts, and the live output of one of Hermes's diagnostic actions (Caduceus relays Hermes's log of
// its latest run as server-sent events). Nothing is kept between visits.
import { useCallback, useEffect, useReducer, useState } from 'react';
import type { InstallFacts } from '@caduceus/contracts/caduceus-api';
import { streamHub } from '../../live-stream.ts';
import { foldAction, startAction, type ActionOutput } from './diagnostics-model.ts';

export interface FactsState {
  facts?: InstallFacts;
  failed: boolean;
  reload(): Promise<void>;
}

export function useInstallFacts(): FactsState {
  const [state, setState] = useState<{ facts?: InstallFacts; failed: boolean }>({ failed: false });
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/_caduceus/api/maintenance/facts');
      if (!res.ok) throw new Error(String(res.status));
      setState({ facts: (await res.json()) as InstallFacts, failed: false });
    } catch {
      setState((before) => ({ ...before, failed: true }));
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  return { ...state, reload };
}

type Action = { event: string; data: unknown } | 'open';
const reduce = (state: ActionOutput, action: Action): ActionOutput => (action === 'open' ? startAction() : foldAction(state, action));

/** Follows the output of the latest run of `name` until it ends, and closes the stream then. `run` changes when a new run starts, so the output is followed afresh. */
export function useActionOutput(name: string, run: number): ActionOutput {
  const [state, dispatch] = useReducer(reduce, undefined, startAction);
  useEffect(() => {
    // A connection that came back is told the whole run again: start from nothing, or its lines would be shown twice. The hub closes the stream
    // while the tab is hidden and opens it again on return, which is the same.
    const stop = streamHub().subscribe(`/_caduceus/api/maintenance/actions/${encodeURIComponent(name)}/stream`, {
      events: ['line', 'end'],
      onOpen: () => dispatch('open'),
      onEvent: (event, data) => {
        dispatch({ event, data: JSON.parse(data) });
        if (event === 'end') stop();
      },
      onError: (final) => {
        if (final) dispatch({ event: 'dropped', data: undefined });
      },
    });
    return stop;
  }, [name, run]);
  return state;
}
