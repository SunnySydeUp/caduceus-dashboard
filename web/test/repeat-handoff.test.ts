import { afterEach, describe, expect, test } from 'vitest';
import { forgetRepeat, rememberRepeat, repeatLeftover } from '../src/modules/chat/repeat-handoff.ts';

// What Repeat leaves in the message box, and when the box says so (talk audit #2). No DOM.
afterEach(forgetRepeat);

describe('the words Repeat left in the box', () => {
  test('are a leftover while the box holds exactly them, white space aside, in the chat they came from', () => {
    rememberRepeat('s1', '  Summarise my inbox every Monday ');
    expect(repeatLeftover('s1', 'Summarise my inbox every Monday')).toBe(true);
    expect(repeatLeftover('s1', 'Summarise my inbox every Monday\n')).toBe(true);
  });

  test('are not one once they were edited or merged with other words, so the note never fires on a different message', () => {
    rememberRepeat('s1', 'Summarise my inbox every Monday');
    expect(repeatLeftover('s1', 'Summarise my inbox eSummarise my inbox every Mondayvery Monday')).toBe(false);
    expect(repeatLeftover('s1', 'Something else')).toBe(false);
    expect(repeatLeftover('s1', '')).toBe(false);
  });

  test('belong to one chat: another chat with the same words has no note', () => {
    rememberRepeat('s1', 'Summarise my inbox every Monday');
    expect(repeatLeftover('s2', 'Summarise my inbox every Monday')).toBe(false);
  });

  test('are forgotten once sent or cleared, and nothing is remembered for an empty message', () => {
    rememberRepeat('s1', 'Run the report');
    forgetRepeat();
    expect(repeatLeftover('s1', 'Run the report')).toBe(false);
    rememberRepeat('s1', '   ');
    expect(repeatLeftover('s1', '')).toBe(false);
  });
});
