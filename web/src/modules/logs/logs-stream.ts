// The live tail as the page reads it: Caduceus's server-sent events for one view (`server/src/log-routes.ts`), one `EventSource` while
// the screen is open. The server keeps one ask to Hermes for everyone watching the same view; this only listens. A dropped connection
// is reconnected by the browser, and the server then says the view whole, so nothing is counted twice.
import { useEffect, useRef } from 'react';
import { streamHub } from '../../live-stream.ts';
import type { LogUpdate } from './logs-model.ts';

const KINDS = ['replace', 'append', 'unavailable', 'rejected'] as const;

/**
 * Listens to the stream at `path` (`streamPath` in the model) and hands every update to `onUpdate`. A new `path` is a new view: the old
 * stream is closed first. `onClosed` is told when the browser gives up on the stream (Caduceus answered with an error, such as being
 * signed out), as opposed to a drop it reconnects from, which `onUpdate` hears of as `unavailable`.
 */
export function useLogStream(path: string, onUpdate: (update: LogUpdate) => void, onClosed: () => void): void {
  const update = useRef(onUpdate);
  const closed = useRef(onClosed);
  update.current = onUpdate;
  closed.current = onClosed;

  useEffect(() => {
    // The hub closes the stream while the tab is hidden and opens it again on return; the server then says the view whole.
    const stop = streamHub().subscribe(path, {
      events: KINDS,
      onEvent: (kind, data) => {
        const body: unknown = JSON.parse(data);
        update.current(body as LogUpdate);
        // A refusal is final; left open, the browser would ask for the same view again and hear the same refusal.
        if (kind === 'rejected') stop();
      },
      onError: (final) => {
        if (final) closed.current();
        else update.current({ kind: 'unavailable', message: 'The connection to Caduceus dropped. Reconnecting…' });
      },
    });
    return stop;
  }, [path]);
}
