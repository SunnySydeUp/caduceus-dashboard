import { useSyncExternalStore } from 'react';

/** What the shell remembers about this device's layout. */
export interface ShellPrefs {
  /** The large layout's sidebar is collapsed to the rail. */
  sidebarCollapsed: boolean;
}

const KEY = 'caduceus.shell';
const DEFAULTS: ShellPrefs = { sidebarCollapsed: false };

function read(): ShellPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

/** Changes the remembered layout; every `useShellPrefs` re-renders. */
export function updateShellPrefs(change: Partial<ShellPrefs>): void {
  current = { ...current, ...change };
  localStorage.setItem(KEY, JSON.stringify(current));
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export function useShellPrefs(): ShellPrefs {
  return useSyncExternalStore(subscribe, () => current);
}
