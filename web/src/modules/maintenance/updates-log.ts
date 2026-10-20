// The live log of an update as the page reads it: Caduceus's server-sent events for one operation (`server/src/update-routes.ts`), folded into a state by
// `foldUpdate`. The server replays everything a late tab missed, so a reconnect starts the state afresh.
import { useEffect, useReducer } from 'react';
import { streamHub } from '../../live-stream.ts';
import { foldUpdate, startUpdate, type UpdateState } from './updates-model.ts';

type Action = { event: string; data: unknown } | 'open';

const reduce = (state: UpdateState, action: Action): UpdateState => (action === 'open' ? startUpdate() : foldUpdate(state, action));

/** Follows the log of operation `id` until it ends, and closes the stream then. */
export function useUpdateLog(id: string): UpdateState {
  const [state, dispatch] = useReducer(reduce, undefined, startUpdate);
  useEffect(() => {
    // A connection that came back is told the whole log again: start from nothing, or its lines would be shown twice. The hub closes the stream
    // while the tab is hidden and opens it again on return, which is the same.
    const stop = streamHub().subscribe(`/_caduceus/api/updates/operations/${encodeURIComponent(id)}/stream`, {
      events: ['phase', 'line', 'end'],
      onOpen: () => dispatch('open'),
      onEvent: (event, data) => {
        dispatch({ event, data: JSON.parse(data) });
        if (event === 'end') stop();
      },
      // Closed by the server with an answer (an unknown operation after Caduceus restarted, or signed out) is final; a drop is reconnected by the browser.
      onError: (final) => {
        if (final) dispatch({ event: 'dropped', data: undefined });
      },
    });
    return stop;
  }, [id]);
  return state;
}
