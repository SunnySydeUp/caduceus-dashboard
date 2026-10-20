// This device's appearance in the running page: where it is kept (a local copy, so it applies before any network answer
// and offline, and Caduceus's record of the device), how a change reaches both, and what the page shows of it. What
// is decided (attributes, reconciling the two copies) is pure and lives in `../appearance.ts`.
import { useSyncExternalStore } from 'react';
import { DEFAULT_APPEARANCE, parseAppearance, type Appearance } from '@caduceus/contracts/appearance';
import type { DeviceAppearance } from '@caduceus/contracts/caduceus-api';
import { APPEARANCE_KEY, attributesOf, parseLocal, reconcile, sameAppearance, type LocalAppearance } from '../appearance.ts';
import { settled } from '../settled.ts';
import { noteMeaningfulAction } from './install.ts';

const ROUTE = '/_caduceus/api/preferences/appearance';

/** What the page shows: the choices, and whether Caduceus has them yet (not while offline, say). */
export interface AppearanceState {
  appearance: Appearance;
  /** Chosen here and not yet saved to Caduceus. */
  pending: boolean;
}

function readLocal(): LocalAppearance | undefined {
  try {
    return parseLocal(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    // Storage blocked: the choices last until the page is closed.
    return undefined;
  }
}

let local = readLocal();
let snapshot: AppearanceState = { appearance: local?.appearance ?? DEFAULT_APPEARANCE, pending: local?.pending ?? false };
const listeners = new Set<() => void>();

/** Puts the choices on `<html>`, where tokens.css switches on them. (Before first paint, `index.html`'s own script does this.) */
function applyToDocument(appearance: Appearance): void {
  for (const [name, value] of Object.entries(attributesOf(appearance))) {
    if (value === null) document.documentElement.removeAttribute(name);
    else document.documentElement.setAttribute(name, value);
  }
}

/** Takes `next` as the device's copy: applies it, keeps it in `localStorage`, tells the page. */
function commit(next: LocalAppearance): void {
  local = next;
  snapshot = { appearance: next.appearance, pending: next.pending };
  applyToDocument(next.appearance);
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full: the choice still applies to this page.
  }
  listeners.forEach((notify) => notify());
}

let saving = false;

/** Sends the device's choices to Caduceus until nothing is pending; a failure (offline, signed out) leaves them pending for the next sync. */
async function save(): Promise<void> {
  if (saving) return;
  saving = true;
  try {
    while (local?.pending) {
      const sent = local.appearance;
      const res = await fetch(ROUTE, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appearance: sent }) }).catch(() => undefined);
      if (!res?.ok) return;
      // A choice made while this one was on its way stays pending, and the next round sends it.
      if (local && sameAppearance(sent, local.appearance)) commit({ appearance: sent, pending: false });
    }
  } finally {
    saving = false;
  }
}

/** Makes a choice on this device: it takes effect at once and is kept locally; Caduceus is told afterwards. */
export function chooseAppearance(change: Partial<Appearance>): void {
  commit({ appearance: { ...snapshot.appearance, ...change }, pending: true });
  // Making the app one's own is a sign it is in use: the iOS install guide may follow.
  noteMeaningfulAction();
  void save();
}

/** Asks Caduceus what it stores for this device and brings the two copies together (`reconcile`). Quietly does nothing offline or signed out. */
export async function syncAppearance(): Promise<void> {
  let stored: Appearance | null;
  try {
    const res = await fetch(ROUTE);
    if (!res.ok) return;
    const body = (await res.json()) as DeviceAppearance;
    stored = parseAppearance(body.appearance) ?? null;
  } catch {
    return;
  }
  // Read the local copy only now: the choice may have changed while the answer was on its way.
  const step = reconcile(local, stored);
  if (step.action === 'adopt') commit({ appearance: step.appearance, pending: false });
  else if (step.action === 'save') {
    commit({ appearance: step.appearance, pending: true });
    await save();
  }
}

/**
 * Keeps this page's appearance in step for as long as the signed-in app runs: syncs now and whenever the device is
 * back online, and follows a change another tab of the same browser makes (`localStorage` is shared by them).
 */
export function startAppearanceSync(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_KEY) return;
    const other = parseLocal(event.newValue);
    if (!other) return;
    commit(other);
    // The tab that made the change may have closed before Caduceus heard of it.
    if (other.pending) void save();
  };
  const onOnline = () => void syncAppearance();
  window.addEventListener('storage', onStorage);
  window.addEventListener('online', onOnline);
  // The page already wears this device's look (the inline script in index.html); reconciling it with Caduceus's record can wait for the first screen.
  void settled.then(syncAppearance);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('online', onOnline);
  };
}

/** Calls `notify` whenever this device's appearance changes (a choice, another tab's, or Caduceus's record being adopted). Returns how to stop. */
export const subscribeAppearance = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export function useAppearance(): AppearanceState {
  return useSyncExternalStore(subscribeAppearance, () => snapshot);
}
