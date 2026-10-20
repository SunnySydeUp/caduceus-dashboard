import { describe, expect, test } from 'vitest';
import { MAX_SELECTION, REFINEMENTS, quoteSelection, refinePrompt, replyWithSelection, selectedText } from '../src/modules/chat/selection-actions.ts';

// What the owner can do with text selected in a reply (M1 #09): quote it into the composer, or ask Hermes to refine it. Free of the DOM.
describe('the selection', () => {
  test('is the selected words with the whitespace around them taken off, and nothing when there are none', () => {
    expect(selectedText('  some words \n')).toBe('some words');
    expect(selectedText('   ')).toBeUndefined();
    expect(selectedText('')).toBeUndefined();
  });

  test('keeps interior lines and spacing, and is cut at a limit with a mark that it was', () => {
    expect(selectedText('one\n\n  two')).toBe('one\n\n  two');
    const long = 'x'.repeat(MAX_SELECTION + 50);
    const cut = selectedText(long)!;
    expect(cut.length).toBe(MAX_SELECTION + 1);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('quoting it', () => {
  test('every line becomes a quoted line, and a blank line follows so that the owner writes beneath it', () => {
    expect(quoteSelection('first\nsecond')).toBe('> first\n> second\n\n');
    expect(quoteSelection('one\n\ntwo')).toBe('> one\n>\n> two\n\n');
  });

  test('reply with selection puts the quote after what is already in the box, apart from it by a blank line', () => {
    expect(replyWithSelection('', 'a line')).toBe('> a line\n\n');
    expect(replyWithSelection('Thinking about this', 'a line')).toBe('Thinking about this\n\n> a line\n\n');
    expect(replyWithSelection('Thinking\n\n', 'a line')).toBe('Thinking\n\n> a line\n\n');
  });
});

describe('the refine chips', () => {
  test('are the follow-ups Hermes can act on: shorter, simpler, more detail, an example and why', () => {
    expect(REFINEMENTS.map((chip) => chip.label)).toEqual(['Shorter', 'Simpler', 'More detail', 'Give an example', 'Explain why']);
  });

  test('each sends a follow-up about the selection: the ask, then the quote', () => {
    const shorter = REFINEMENTS.find((chip) => chip.id === 'shorter')!;
    expect(refinePrompt(shorter, 'a long\nthought')).toBe('Make this shorter:\n\n> a long\n> thought');
    const detail = REFINEMENTS.find((chip) => chip.id === 'detail')!;
    expect(refinePrompt(detail, 'brief')).toBe('Give more detail on this:\n\n> brief');
  });
});
