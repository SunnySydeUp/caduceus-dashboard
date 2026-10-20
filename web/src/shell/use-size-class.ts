import { useSyncExternalStore } from 'react';
import { sizeClassForWidth, type SizeClass } from '../size-class.ts';

const subscribe = (notify: () => void) => {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
};

/** The window's size class; it re-renders only when the class changes, not on every resize. */
export function useSizeClass(): SizeClass {
  return useSyncExternalStore(subscribe, () => sizeClassForWidth(window.innerWidth));
}
