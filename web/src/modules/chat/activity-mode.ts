// The activity mode this device chose (M1 #05). It is the device's: a phone may read Final only while the laptop streams everything, so it is
// kept in the browser's storage, not in Caduceus's or Hermes's. The mode a device has never chosen is the default, and is not sent to Hermes.
import { useSyncExternalStore } from 'react';
import { parseActivityMode, type ActivityMode } from './activity.ts';
import { useChatBehaviour } from './chat-behaviour.ts';

const KEY = 'caduceus.chat.activity-mode';

const read = (): ActivityMode | undefined => {
  try {
    return parseActivityMode(localStorage.getItem(KEY));
  } catch {
    return undefined;
  }
};

let chosen = read();
const listeners = new Set<() => void>();

/** Remembers the device's choice; every `useActivityMode` re-renders. */
export function chooseActivityMode(mode: ActivityMode): void {
  chosen = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Storage is full or refused: the choice lasts until the page closes.
  }
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

/**
 * The mode in force, and whether it was chosen (only a chosen one is sent to Hermes when a chat starts). A device that never chose one uses the owner's default from
 * Settings › Chat, which counts as chosen once it is not the built-in one.
 */
export function useActivityMode(): { mode: ActivityMode; chosen: boolean } {
  const mode = useSyncExternalStore(subscribe, () => chosen);
  const { activityMode } = useChatBehaviour().account;
  return { mode: mode ?? activityMode, chosen: mode !== undefined || activityMode !== 'worklog' };
}
