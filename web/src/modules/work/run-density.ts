// The density this device chose for the run view (M3 #11): Stream, Worklog or Raw, kept in the browser's storage like Chat's activity mode (a phone may read
// Worklog while the laptop streams everything); it is the device's, not Caduceus's or Hermes's.
import { useSyncExternalStore } from 'react';
import { DEFAULT_DENSITY, parseDensity, type RunDensity } from './run-model.ts';

const KEY = 'caduceus.work.run-density';

const read = (): RunDensity | undefined => {
  try {
    return parseDensity(localStorage.getItem(KEY));
  } catch {
    return undefined;
  }
};

let chosen = read();
const listeners = new Set<() => void>();

/** Remembers the device's choice; every `useRunDensity` re-renders. */
export function chooseRunDensity(density: RunDensity): void {
  chosen = density;
  try {
    localStorage.setItem(KEY, density);
  } catch {
    // Storage is full or refused: the choice lasts until the page closes.
  }
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export const useRunDensity = (): RunDensity => useSyncExternalStore(subscribe, () => chosen) ?? DEFAULT_DENSITY;
