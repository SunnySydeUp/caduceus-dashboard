import { useSyncExternalStore } from 'react';

// On a phone the app bar shows the page title only once the page's own heading has scrolled out of view (the "large
// title" pattern). The heading reports its visibility here; the app bar reads it.

let scrolledAway = false;
const listeners = new Set<() => void>();

export function setHeadingScrolledAway(value: boolean): void {
  if (scrolledAway === value) return;
  scrolledAway = value;
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

/** Whether the current page's heading has scrolled up behind the app bar. */
export function useHeadingScrolledAway(): boolean {
  return useSyncExternalStore(subscribe, () => scrolledAway);
}
