// "Ready for review" as the page keeps it for the readers that only need to know what is waiting: the crew's Finished state (the green ring on an agent's
// sigil). One copy for the page, read from Caduceus (`GET /_caduceus/api/today/ready`) when something may have finished or been opened, never on a timer.
// Today's own block and Work read the list for themselves; opening an item anywhere goes through `markOpened` here, so the ring follows at once.
import { useSyncExternalStore } from 'react';
import type { ReadyItem, ReadyOpened } from '@caduceus/contracts/today';
import { gatewayConnection } from '../../gateway.ts';
import { settled } from '../../settled.ts';
import { inboxFeed } from '../inbox/inbox-feed.ts';
import { readReady } from './today-data.ts';

const NONE: readonly ReadyItem[] = [];
let items = NONE;
const listeners = new Set<() => void>();
let started = false;
/** Which ask is the latest: an answer that arrives late must not replace a newer one. */
let asked = 0;

/** Reads the list again. A failed read keeps what was known: the ring is a hint, and Today and Work say themselves when the list cannot be read. */
export async function refreshReady(): Promise<void> {
  if (!started) return;
  const ask = ++asked;
  try {
    const next = await readReady();
    if (ask !== asked) return;
    items = next;
    for (const listener of listeners) listener();
  } catch {
    // Kept as it was; see above.
  }
}

/**
 * Starts once, after the first screen is done: Today's first paint waits on its own read of the same list, and the server answers one thing at a time. From then
 * on the list is read again when a run finishes (the Inbox's activity feed moves), when Hermes says its sessions changed (a scheduled job's run ended), at every
 * gateway ready (events are not replayed), and when the tab comes back.
 */
function start(): void {
  if (started) return;
  started = true;
  void settled.then(() => {
    void refreshReady();
    const feed = inboxFeed();
    let head = feed.get().activity[0]?.seq;
    feed.subscribe(() => {
      const now = feed.get().activity[0]?.seq;
      if (now === head) return;
      head = now;
      void refreshReady();
    });
    const gateway = gatewayConnection();
    gateway.client.on('sessions.changed', () => void refreshReady());
    gateway.onReady(() => void refreshReady());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refreshReady());
  });
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What is ready for review now, newest first; empty until the first read has answered. */
export function useReadyItems(): readonly ReadyItem[] {
  return useSyncExternalStore(subscribe, () => items);
}

/**
 * Says the owner opened this item, then reads the list again. It is sent with `keepalive`, so it still goes when the page is leaving to show the item; if it does
 * not reach Caduceus the item stays ready, which is the safe way to be wrong.
 */
export async function markOpened(item: ReadyOpened): Promise<void> {
  await fetch('/_caduceus/api/today/ready/opened', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id, stamp: item.stamp }), keepalive: true }).catch(() => undefined);
  await refreshReady();
}
