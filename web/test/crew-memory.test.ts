import { describe, expect, it } from 'vitest';
import { readKnownCrew, readLastScope, rememberCrew, rememberLastScope, skeletonRows, SKELETON_ROWS } from '../src/modules/crew/crew-memory.ts';

function store(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe('crew memory', () => {
  it('gives back the names it was given, and the last scope', () => {
    const kept = store();
    rememberCrew(kept, ['coder', 'writer']);
    rememberLastScope(kept, 'coder');
    expect(readKnownCrew(kept)).toEqual(['coder', 'writer']);
    expect(readLastScope(kept)).toBe('coder');
  });

  it('knows nothing from an empty or damaged store', () => {
    expect(readKnownCrew(store())).toEqual([]);
    expect(readKnownCrew(store({ 'caduceus.crew': '{oops' }))).toEqual([]);
    expect(readKnownCrew(store({ 'caduceus.crew': '[1,"a",""]' }))).toEqual(['a']);
    expect(readLastScope(store())).toBeUndefined();
  });

  it('draws a row for each known name, or the default count of nameless rows', () => {
    expect(skeletonRows(['a', 'b'])).toEqual(['a', 'b']);
    expect(skeletonRows([])).toHaveLength(SKELETON_ROWS);
  });
});
