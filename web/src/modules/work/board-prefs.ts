// What Work › Board remembers about this device: how a phone lays the board out (a segmented list, or snapping columns).
import { useSyncExternalStore } from 'react';

export type PhoneLayout = 'list' | 'columns';

const KEY = 'caduceus.work.board';

function read(): PhoneLayout {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}').phoneLayout === 'columns' ? 'columns' : 'list';
  } catch {
    return 'list';
  }
}

let current = read();
const listeners = new Set<() => void>();

/** Remembers the phone layout on this device; every `usePhoneLayout` re-renders. */
export function setPhoneLayout(layout: PhoneLayout): void {
  current = layout;
  localStorage.setItem(KEY, JSON.stringify({ phoneLayout: layout }));
  for (const notify of listeners) notify();
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export function usePhoneLayout(): PhoneLayout {
  return useSyncExternalStore(subscribe, () => current);
}
