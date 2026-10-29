import { describe, expect, test } from 'vitest';
import { INTENTS, INTENT_META, intentAfter, intentChip, intentHint, planDraft, type Intent } from '../src/modules/chat/composer-intent.ts';

// What each intent of the composer does with a draft, the hint that says so, and when the intent goes back to Ask (M8 #06). No DOM.

describe('what each intent does with a draft', () => {
  test('there are three intents, Ask first', () => {
    expect(INTENTS).toEqual(['ask', 'delegate', 'repeat']);
  });

  test('an empty draft does nothing under any intent, and so does one of only white space', () => {
    for (const intent of INTENTS) {
      expect(planDraft({ intent, text: '', attachments: 0 })).toEqual({ kind: 'nothing' });
      expect(planDraft({ intent, text: ' \n\t ', attachments: 0 })).toEqual({ kind: 'nothing' });
    }
  });

  test('Ask leaves the draft to the chat as it always has: a message, a command, or a message with attachments', () => {
    expect(planDraft({ intent: 'ask', text: 'Fix the build', attachments: 0 })).toEqual({ kind: 'ask' });
    expect(planDraft({ intent: 'ask', text: '/retry', attachments: 0 })).toEqual({ kind: 'ask' });
    expect(planDraft({ intent: 'ask', text: '', attachments: 2 })).toEqual({ kind: 'ask' });
  });

  test('Delegate and Repeat take the trimmed words of a message', () => {
    expect(planDraft({ intent: 'delegate', text: '  Summarise the week \n', attachments: 0 })).toEqual({ kind: 'delegate', text: 'Summarise the week' });
    expect(planDraft({ intent: 'repeat', text: '  Summarise the week \n', attachments: 0 })).toEqual({ kind: 'repeat', text: 'Summarise the week' });
  });

  test('a slash command is refused by Delegate and Repeat, which would otherwise hand Hermes a command as a task', () => {
    for (const intent of ['delegate', 'repeat'] as const) {
      const plan = planDraft({ intent, text: '/background do it', attachments: 0 });
      expect(plan).toMatchObject({ kind: 'refuse', reason: 'command' });
      expect(plan.kind === 'refuse' && plan.message).toContain('Ask');
    }
    expect(planDraft({ intent: 'delegate', text: '  /title New name', attachments: 0 })).toMatchObject({ kind: 'refuse', reason: 'command' });
  });

  test('attachments are refused by Delegate and Repeat, which carry words only, even when there are no words', () => {
    for (const intent of ['delegate', 'repeat'] as const) {
      expect(planDraft({ intent, text: 'Look at this', attachments: 1 })).toMatchObject({ kind: 'refuse', reason: 'attachments' });
      expect(planDraft({ intent, text: '', attachments: 1 })).toMatchObject({ kind: 'refuse', reason: 'attachments' });
    }
  });

  test('a path that only starts with a slash is a message, not a command', () => {
    expect(planDraft({ intent: 'delegate', text: '/Users/me/notes.md needs a summary', attachments: 0 })).toEqual({ kind: 'delegate', text: '/Users/me/notes.md needs a summary' });
  });
});

describe('the hint under the composer', () => {
  test('each intent says what it does, and Ask names the agent', () => {
    expect(intentHint('ask', 'coder')).toBe('coder answers here, and you can follow along.');
    expect(intentHint('delegate', 'coder')).toBe('Runs in the background. You are told only when it needs you or finishes.');
    expect(intentHint('repeat', 'coder')).toBe('Pick when it should run again. It shows up under Work. Your words stay in this box.');
  });

  test('the three hints differ', () => {
    const hints = new Set(INTENTS.map((intent: Intent) => intentHint(intent, 'coder')));
    expect(hints.size).toBe(3);
  });
});

describe('when the intent goes back to Ask', () => {
  test('after a draft was taken, whatever the intent was', () => {
    expect(intentAfter('delegate', { kind: 'delegate', text: 'x' })).toBe('ask');
    expect(intentAfter('repeat', { kind: 'repeat', text: 'x' })).toBe('ask');
    expect(intentAfter('ask', { kind: 'ask' })).toBe('ask');
  });

  test('a refused or empty draft was not sent, so the intent stays', () => {
    expect(intentAfter('delegate', { kind: 'refuse', reason: 'command', message: 'm' })).toBe('delegate');
    expect(intentAfter('repeat', { kind: 'nothing' })).toBe('repeat');
  });
});

describe('the chip above the field', () => {
  test('Ask has none, and the others name themselves and what they do, so the choice is not forgotten', () => {
    expect(intentChip('ask')).toBeUndefined();
    for (const intent of ['delegate', 'repeat'] as const) {
      const text = intentChip(intent);
      expect(text).toContain(INTENT_META[intent].label);
      expect(text?.length).toBeGreaterThan(INTENT_META[intent].label.length);
    }
  });

  test('the two chips differ', () => {
    expect(intentChip('delegate')).not.toBe(intentChip('repeat'));
  });
});
