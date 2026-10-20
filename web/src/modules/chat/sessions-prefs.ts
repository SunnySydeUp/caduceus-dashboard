// What the sessions list remembers about this device: how dense its rows are.
import { useSyncExternalStore } from 'react';

export type Density = 'comfortable' | 'compact';

const KEY = 'caduceus.chat.sessions';

function read(): Density {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}').density === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

let current = read();
const listeners = new Set<() => void>();

/** Remembers the density on this device; every `useDensity` re-renders. */
export function setDensity(density: Density): void {
  current = density;
  localStorage.setItem(KEY, JSON.stringify({ density }));
  for (const notify of listeners) notify();
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export function useDensity(): Density {
  return useSyncExternalStore(subscribe, () => current);
}
