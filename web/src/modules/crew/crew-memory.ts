// What this device remembers of the crew between loads, so the first screen has something true to draw while Hermes is slow: the agents' names (a sigil is drawn from
// its name alone, so the name is its hue and pattern) and the name of the scope the head showed last. No state, no lines, nothing secret.

/** The storage the crew's memory needs. */
export type MemoryStore = Pick<Storage, 'getItem' | 'setItem'>;

const CREW_KEY = 'caduceus.crew';
const SCOPE_KEY = 'caduceus.last-scope';

/** How many rows a skeleton shows when no crew is known yet. */
export const SKELETON_ROWS = 3;
/** The most names kept. */
const KEEP_MAX = 24;

/** The names of the crew as it was when the page last read it; empty when none is kept (or the kept text is not a list of names). */
export function readKnownCrew(store: MemoryStore): string[] {
  try {
    const kept: unknown = JSON.parse(store.getItem(CREW_KEY) ?? '[]');
    return Array.isArray(kept) ? kept.filter((name): name is string => typeof name === 'string' && name !== '').slice(0, KEEP_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberCrew(store: MemoryStore, names: readonly string[]): void {
  store.setItem(CREW_KEY, JSON.stringify(names.slice(0, KEEP_MAX)));
}

/** The scope name the head showed at the last load, if any. */
export function readLastScope(store: MemoryStore): string | undefined {
  return store.getItem(SCOPE_KEY) ?? undefined;
}

export function rememberLastScope(store: MemoryStore, name: string): void {
  store.setItem(SCOPE_KEY, name);
}

/** The rows a skeleton draws: one per known name, else `SKELETON_ROWS` nameless ones. */
export function skeletonRows(known: readonly string[]): (string | undefined)[] {
  return known.length > 0 ? [...known] : Array.from({ length: SKELETON_ROWS }, () => undefined);
}
