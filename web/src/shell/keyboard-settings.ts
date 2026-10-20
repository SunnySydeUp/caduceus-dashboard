import { useSyncExternalStore } from 'react';
import { parseKeyboardSettings, type KeyboardSettings } from '../shortcuts.ts';

/**
 * Where this device keeps its keyboard settings (the single-key switch and the remapped shortcuts). They are per
 * device on purpose: a hardware keyboard, a screen reader and a phone differ from one device to the next, so the
 * choice is not shared through Caduceus.
 */
const KEY = 'caduceus.keyboard';

function read(): KeyboardSettings {
  try {
    return parseKeyboardSettings(localStorage.getItem(KEY));
  } catch {
    // Storage blocked: the defaults apply, and a change lasts until the page is closed.
    return parseKeyboardSettings(null);
  }
}

let current = read();
const listeners = new Set<() => void>();

/** Saves new settings on this device; every `useKeyboardSettings` re-renders. */
export function saveKeyboardSettings(next: KeyboardSettings): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full: the change still applies for this page.
  }
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export function useKeyboardSettings(): KeyboardSettings {
  return useSyncExternalStore(subscribe, () => current);
}
