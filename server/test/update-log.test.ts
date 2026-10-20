import { describe, expect, test } from 'vitest';
import { linesAfter } from '../src/update-log.ts';

// The window Hermes tells the update log in (the last lines it printed), turned into each line once.
describe('what a window of the update log has that was not shown yet', () => {
  test('everything, when nothing was shown', () => {
    expect(linesAfter([], ['a', 'b'])).toEqual(['a', 'b']);
  });

  test('only the lines added at the end of a window that grew', () => {
    expect(linesAfter(['a', 'b'], ['a', 'b', 'c', 'd'])).toEqual(['c', 'd']);
  });

  test('nothing, when the window is the one that was shown', () => {
    expect(linesAfter(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  test('only the lines after the end of what was shown, when the window slid on and dropped its first lines', () => {
    expect(linesAfter(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['d']);
  });

  test('the whole window, when it shares nothing with what was shown (the log began again)', () => {
    expect(linesAfter(['a', 'b'], ['x', 'y'])).toEqual(['x', 'y']);
  });
});
