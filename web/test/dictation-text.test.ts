import { describe, expect, test } from 'vitest';
import { dictate } from '../src/modules/voice/dictation-text.ts';

// Where dictated words go in the message box (M7 #07): at the caret, as words in a sentence, for the owner to read before sending.
describe('dictated words in the message box', () => {
  test('into an empty box, as they are', () => {
    expect(dictate('', { start: 0, end: 0 }, 'What is in the build folder?')).toEqual({ text: 'What is in the build folder?', caret: 28 });
  });

  test('after what is typed, with one space between', () => {
    expect(dictate('Please check', { start: 12, end: 12 }, 'the logs')).toEqual({ text: 'Please check the logs', caret: 21 });
    expect(dictate('Please check ', { start: 13, end: 13 }, 'the logs')).toEqual({ text: 'Please check the logs', caret: 21 });
  });

  test('in the middle of a message, spaced on both sides, and over a selection', () => {
    expect(dictate('Fix the bug today', { start: 7, end: 7 }, 'login')).toEqual({ text: 'Fix the login bug today', caret: 13 + 0 });
    expect(dictate('Fix the old bug', { start: 8, end: 11 }, 'new')).toEqual({ text: 'Fix the new bug', caret: 11 });
  });

  test('a newline before is as good as a space, and what was said is trimmed', () => {
    expect(dictate('Notes:\n', { start: 7, end: 7 }, '  first point  ')).toEqual({ text: 'Notes:\nfirst point', caret: 18 });
  });
});
