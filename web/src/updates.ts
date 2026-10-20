// How the page reads the updates (M5 #12): Hermes's own check (the proxy forwards it, a read), Caduceus's check and the state of the drain and of the
// operation under way, which Caduceus keeps. A screen that changes an update announces it, so the banners (`shell/update-banners.ts`) ask again.
import type { UpdateCheck, UpdatesState } from '@caduceus/contracts/caduceus-api';

async function read<T>(path: string): Promise<T | undefined> {
  try {
    const res = await fetch(path);
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Hermes's update check (`GET /api/hermes/update/check`); `force` skips Hermes's 24 hour cache. `undefined` when Hermes did not answer. */
export const fetchHermesCheck = (force = false): Promise<UpdateCheck | undefined> => read<UpdateCheck>(`/api/hermes/update/check${force ? '?force=true' : ''}`);

/** Caduceus's check of its own checkout. `undefined` when Caduceus did not answer. */
export const fetchCaduceusCheck = (force = false): Promise<UpdateCheck | undefined> => read<UpdateCheck>(`/_caduceus/api/updates/caduceus${force ? '?force=1' : ''}`);

/** The drain, the operation under way (or the last one) and What's New. */
export const fetchUpdatesState = (): Promise<UpdatesState | undefined> => read<UpdatesState>('/_caduceus/api/updates');

const changed = new EventTarget();
const CHANGED = 'changed';

/** Calls `listener` whenever a screen says an update began or ended on this page; returns what stops it. */
export function onUpdatesChanged(listener: () => void): () => void {
  changed.addEventListener(CHANGED, listener);
  return () => changed.removeEventListener(CHANGED, listener);
}

export const announceUpdatesChanged = (): void => void changed.dispatchEvent(new Event(CHANGED));
