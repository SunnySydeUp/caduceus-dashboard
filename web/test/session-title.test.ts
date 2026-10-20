import { describe, expect, test } from 'vitest';
import { cleanTitle, titleInput } from '../src/modules/chat/session-title.ts';

// What goes to Hermes's title model and what comes back (M1 #12).
describe('the title model\'s input', () => {
  test('is the owner\'s own words of the first message, without attachment lines, cut to what a title needs', () => {
    expect(titleInput('Plan a trip\n[User attached file: /tmp/a.md]\n@image:/tmp/b.png')).toBe('Plan a trip');
    expect(titleInput('x'.repeat(5000))).toHaveLength(1000);
  });
});

describe('the title out of the model\'s answer', () => {
  test.each([
    ['Lisbon trip plan', 'Lisbon trip plan'],
    ['"Lisbon trip plan"', 'Lisbon trip plan'],
    ['**Lisbon trip plan.**', 'Lisbon trip plan'],
    ['Title: Lisbon trip plan', 'Lisbon trip plan'],
    ['\n\n  Lisbon   trip plan\nA second line of chatter', 'Lisbon trip plan'],
  ])('%j becomes %j', (answer, title) => {
    expect(cleanTitle(answer)).toBe(title);
  });

  test('is nothing for an empty answer, or one so long that it answers the message instead of naming it', () => {
    expect(cleanTitle('')).toBeUndefined();
    expect(cleanTitle('  \n  ')).toBeUndefined();
    expect(cleanTitle('I do not have enough context to know what you mean by that, could you tell me more about it please')).toBeUndefined();
  });
});
