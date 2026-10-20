import { useSyncExternalStore } from 'react';
import type { Store } from './store.ts';

const noop = () => () => {};

/** Reads a store of the chat module's engines; `initial` while the engine is not there yet. */
export function useStore<State>(store: Store<State> | undefined, initial: State): State {
  return useSyncExternalStore(store?.subscribe ?? noop, () => store?.state ?? initial);
}
