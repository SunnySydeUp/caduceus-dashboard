// The owner's chips for the composer (M1 #08): which show and in what order. The server keeps it (`/_caduceus/api/preferences/chat-chips`,
// the owner's, so every device shows the same); this is the page's copy of what it last heard, so the composer and the chips editor
// agree without asking again. Nothing here talks to Hermes.
import { useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_CHIPS, normaliseChipPreference, type ChipPreference } from '@caduceus/contracts/chat-chips';
import type { ChatChipsPreference } from '@caduceus/contracts/caduceus-api';

/** The page's way to call the server; `fetch` in the browser, the test server's in a test. */
export type Request = (method: string, path: string, body?: unknown) => Promise<Response>;

const ROUTE = '/_caduceus/api/preferences/chat-chips';
const browserRequest: Request = (method, path, body) =>
  fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

let current: ChipPreference = DEFAULT_CHIPS;
let asked = false;
const listeners = new Set<() => void>();
const publish = (next: ChipPreference) => {
  current = next;
  listeners.forEach((notify) => notify());
};

/** Asks the server for the chips (once per page unless `again`); the default order when the owner has saved none, or the server does not answer. */
export async function loadChipPreference(request: Request = browserRequest, again = false): Promise<ChipPreference> {
  if (asked && !again) return current;
  asked = true;
  const res = await request('GET', ROUTE).catch(() => undefined);
  if (res?.ok) publish(normaliseChipPreference(((await res.json()) as ChatChipsPreference).chips));
  else asked = false;
  return current;
}

/** Saves the chips for every device. Throws when the server did not take them. */
export async function saveChipPreference(preference: ChipPreference, request: Request = browserRequest): Promise<void> {
  const res = await request('PUT', ROUTE, { chips: preference });
  if (!res.ok) throw new Error(`Caduceus did not save the chips (HTTP ${res.status}).`);
  asked = true;
  publish(normaliseChipPreference(((await res.json()) as ChatChipsPreference).chips));
}

/** The chips to draw: the owner's, once the server has answered, and Caduceus's own order until then. */
export function useChipPreference(): ChipPreference {
  useEffect(() => {
    void loadChipPreference();
  }, []);
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    () => current,
  );
}
