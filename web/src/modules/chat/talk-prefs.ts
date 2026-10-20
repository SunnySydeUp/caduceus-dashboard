// What Talk remembers about this device: whether the Details panel is open beside (or, on a tablet, over) the conversation. It is closed until the owner opens it.
import { useSyncExternalStore } from 'react';
import { detailsLayout } from './talk-details.ts';

const KEY = 'caduceus.talk';

function read(): boolean {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}').detailsOpen === true;
  } catch {
    return false;
  }
}

let current = read();
const listeners = new Set<() => void>();

/** Remembers whether the panel is open on this device; every `useDetailsOpen` re-renders. */
export function setDetailsOpen(open: boolean): void {
  current = open;
  localStorage.setItem(KEY, JSON.stringify({ detailsOpen: open }));
  for (const notify of listeners) notify();
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export function useDetailsOpen(): boolean {
  return useSyncExternalStore(subscribe, () => current);
}

const onResize = (notify: () => void) => {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
};

/** Where Details opens at this window width: a sheet, an overlay or a column. It re-renders only when that changes. */
export function useDetailsLayout(): ReturnType<typeof detailsLayout> {
  return useSyncExternalStore(onResize, () => detailsLayout(window.innerWidth));
}
