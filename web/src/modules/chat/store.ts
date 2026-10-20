// A minimal observable value, the shape `useSyncExternalStore` reads: the state is replaced (never mutated) and every
// listener is told. No React and no DOM, so the chat engine runs under test.
export interface Store<State> {
  readonly state: State;
  /** Calls `listener` after every change. Returns how to stop. */
  subscribe(listener: () => void): () => void;
  /** Resolves with the first state, now or later, that `match` accepts. */
  until(match: (state: State) => boolean): Promise<State>;
}

export function createStore<State>(initial: State): Store<State> & { set(patch: Partial<State> | ((state: State) => Partial<State>)): void } {
  let state = initial;
  const listeners = new Set<() => void>();
  const waiting = new Set<{ match: (state: State) => boolean; resolve: (state: State) => void }>();
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    until(match) {
      if (match(state)) return Promise.resolve(state);
      const { promise, resolve } = Promise.withResolvers<State>();
      waiting.add({ match, resolve });
      return promise;
    },
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      for (const waiter of waiting) {
        if (!waiter.match(state)) continue;
        waiting.delete(waiter);
        waiter.resolve(state);
      }
      listeners.forEach((listener) => listener());
    },
  };
}
