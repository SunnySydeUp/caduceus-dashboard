import { describe, expect, it } from 'vitest';
import { asOfWords, cannotCheckWords, clockWords, FIRST_LINK, nextLinkMemory } from '../src/shell/link-memory.ts';

const NOON = new Date(2026, 9, 5, 12, 0).getTime();
const NINE_FOURTEEN = new Date(2026, 9, 5, 9, 14).getTime();
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

describe('link memory', () => {
  it('stamps the moment the link drops and keeps it until the link is back', () => {
    const dropped = nextLinkMemory(FIRST_LINK, false, NINE_FOURTEEN);
    expect(dropped.memory).toEqual({ healthy: false, lastHealthyAt: NINE_FOURTEEN });
    expect(dropped.recovered).toBe(false);
    expect(nextLinkMemory(dropped.memory, false, NOON).memory).toBe(dropped.memory);
  });

  it('reports a recovery once, and nothing for a link that was never down', () => {
    const dropped = nextLinkMemory(FIRST_LINK, false, NINE_FOURTEEN).memory;
    expect(nextLinkMemory(dropped, true, NOON).recovered).toBe(true);
    expect(nextLinkMemory(FIRST_LINK, true, NOON)).toEqual({ memory: FIRST_LINK, recovered: false });
  });

  it('says when a line was last true, or that it cannot say', () => {
    expect(asOfWords(NINE_FOURTEEN, NOON)).toBe(`As of ${time(NINE_FOURTEEN)}`);
    expect(asOfWords(undefined, NOON)).toBe('Can’t check right now');
    expect(cannotCheckWords(NINE_FOURTEEN, NOON)).toBe(`Can’t check right now. Last checked at ${time(NINE_FOURTEEN)}.`);
    expect(cannotCheckWords(undefined, NOON)).toBe('Can’t check right now.');
  });

  it('names the weekday when the time is not today', () => {
    const yesterday = NINE_FOURTEEN - 24 * 60 * 60 * 1000;
    expect(clockWords(yesterday, NOON)).toContain(time(yesterday));
    expect(clockWords(yesterday, NOON)).not.toBe(time(yesterday));
  });
});
