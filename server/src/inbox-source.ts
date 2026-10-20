// What a source of the Inbox is (M2 #02), and the one way most of them are made. A source knows its own items and says when they change;
// the Inbox (`inbox.ts`) joins them and knows nothing else about them. A later module (Work in M3 #09, budgets in M5) adds a source by
// giving the server one more of these, and the page shows its items with no change: an item carries its own words and its own actions.
import type { InboxItem, InboxNotice } from '@caduceus/contracts/inbox';

export interface InboxSource {
  /** The items now. */
  items(): InboxItem[];
  /** Hears every change to the items. Returns how to stop. */
  subscribe(listener: () => void): () => void;
  close(): void;
}

/** A source that can also be told to read now, by whoever knows what it reads has changed (a budget that was just made). */
export interface PolledSource extends InboxSource {
  refresh(): void;
}

/** A notice as a source reads it from Hermes: the time it first appeared is the Inbox's to say. */
export type NoticeDraft = Omit<InboxNotice, 'at' | 'kind'> & { at?: number };

export interface PolledSourceOptions {
  /** Reads Hermes and says what is wrong now. A read that fails leaves the items as they were. */
  read(): Promise<NoticeDraft[]>;
  now: () => number;
  /** How often to read again: the state of some things changes with the time alone (a job that is overdue). */
  pollMs: number;
  /** How long after the source starts it first reads (5 s, or `pollMs` if that is shorter): a Hermes that has only just started is busy with its first requests, and the Inbox can wait. */
  firstReadMs?: number;
  /** Reads again when something says Hermes's state moved (an event on the observer connection); returns how to stop listening. */
  wake?(refresh: () => void): () => void;
}

/**
 * A source that reads Hermes now and then, and again when told Hermes's state moved. An item keeps the time it first appeared while its
 * id lasts, and goes the moment a read no longer finds it: nothing about it is kept.
 */
export function createPolledSource({ read, now, pollMs, firstReadMs = 5_000, wake }: PolledSourceOptions): PolledSource {
  const listeners = new Set<() => void>();
  const firstSeen = new Map<string, number>();
  let items: InboxItem[] = [];
  let stopped = false;
  let running: Promise<void> | undefined;
  let again = false;
  let timer: NodeJS.Timeout | undefined;

  const look = async () => {
    const drafts = await read().catch(() => undefined);
    if (drafts === undefined || stopped) return;
    const found = drafts.map((draft): InboxItem => {
      const at = draft.at ?? firstSeen.get(draft.id) ?? now();
      firstSeen.set(draft.id, at);
      return { ...draft, kind: 'notice', at };
    });
    for (const id of firstSeen.keys()) if (!found.some((item) => item.id === id)) firstSeen.delete(id);
    const changed = found.length !== items.length || found.some((item, index) => JSON.stringify(item) !== JSON.stringify(items[index]));
    items = found;
    if (changed) for (const listener of [...listeners]) listener();
  };

  /** One read at a time; a wake-up that comes while one is under way asks for another straight after it, so the last word is never an older read. */
  const refresh = (): void => {
    if (running) {
      again = true;
      return;
    }
    running = look().finally(() => {
      running = undefined;
      if (again && !stopped) {
        again = false;
        refresh();
      }
    });
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      refresh();
      schedule();
    }, pollMs);
    timer.unref();
  };
  const first = setTimeout(refresh, Math.min(firstReadMs, pollMs));
  first.unref();
  schedule();
  const stopWaking = wake?.(refresh);

  return {
    items: () => items,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(first);
      stopWaking?.();
      listeners.clear();
    },
  };
}
