// A value loaded once per key, with its three states and a retry. The skills screens use it for what a sheet reads when it opens.
import { useEffect, useState } from 'react';

export type Loaded<Value> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; value: Value };

/** Loads once per `key`; the screen mounts one per thing it shows. */
export function useLoaded<Value>(load: () => Promise<Value>, key: string): { loaded: Loaded<Value>; retry(): void } {
  const [loaded, setLoaded] = useState<Loaded<Value>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoaded({ state: 'loading' });
    load().then(
      (value) => current && setLoaded({ state: 'ready', value }),
      () => current && setLoaded({ state: 'failed' }),
    );
    return () => {
      current = false;
    };
    // `load` is rebuilt on every render from `key`, which names what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  return { loaded, retry: () => setAttempt((count) => count + 1) };
}
