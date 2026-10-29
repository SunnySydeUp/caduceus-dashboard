import { describe, expect, test } from 'vitest';
import { clipWords } from '@caduceus/contracts/clip-words';

// A line of Hermes's or a tool's words, cut for a screen: never in the middle of a word, and it says that it was cut.
describe('clipWords', () => {
  test('leaves words that fit as they are', () => {
    expect(clipWords('Short enough', 40)).toBe('Short enough');
    expect(clipWords('exactly ten', 11)).toBe('exactly ten');
  });

  test('cuts at the last whole word and says so with an ellipsis', () => {
    const clipped = clipWords('osascript -e tell application "Reminders" to get every list failed', 40);
    expect(clipped).toBe('osascript -e tell application…');
    expect(clipped.length).toBeLessThanOrEqual(40);
  });

  test('never leaves a dangling punctuation mark before the ellipsis', () => {
    expect(clipWords('Reminders access denied, run the authorize command again', 26)).toBe('Reminders access denied…');
  });

  test('a single word longer than the limit is cut, because there is no word break to use', () => {
    const clipped = clipWords('x'.repeat(100), 20);
    expect(clipped).toBe(`${'x'.repeat(19)}…`);
  });
});
