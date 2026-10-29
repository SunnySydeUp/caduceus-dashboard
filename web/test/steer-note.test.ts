import { describe, expect, test } from 'vitest';
import { entriesOf, splitCronPrompt, steerWords } from '../src/modules/chat/activity.ts';
import { denyNote, steerNote } from '../src/modules/chat/requests.ts';

// A denied approval with a reason, and any mid-turn steer, reach Hermes's history as a user row that wraps the words in a marker. The transcript shows what the owner
// did, never the marker (talk audit #11).
const MARKER_OPEN = '[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]';
const wrapped = (words: string) => `\n\n${MARKER_OPEN}\n${words}\n[/OUT-OF-BAND USER MESSAGE]`;

describe('the words inside a steer row', () => {
  test('are the owner’s words, without Hermes’s marker', () => {
    expect(steerWords(wrapped('Use the other folder'))).toBe('Use the other folder');
    expect(steerWords(wrapped('line one\nline two'))).toBe('line one\nline two');
  });

  test('are the row as it is when it has no marker, and what follows the marker when it is never closed', () => {
    expect(steerWords('  plain words ')).toBe('plain words');
    expect(steerWords(`${MARKER_OPEN}\nunclosed`)).toBe('unclosed');
  });
});

describe('a steer row of the history', () => {
  test('becomes a note with the owner’s words, with no marker in its text', () => {
    const [entry] = entriesOf([{ id: 7, role: 'user', content: wrapped(denyNote('too risky')), timestamp: 5 }]);
    expect(entry).toEqual({ kind: 'bubble', id: 7, role: 'user', text: 'I denied that action. My reason: too risky', at: 5, steered: true });
    expect(JSON.stringify(entry)).not.toContain('OUT-OF-BAND');
  });

  test('is a note too when Hermes typed it as a steer and its words have no marker', () => {
    expect(entriesOf([{ id: 8, role: 'user', content: 'Stop and summarise', display_kind: 'steer' }])).toEqual([{ kind: 'bubble', id: 8, role: 'user', text: 'Stop and summarise', steered: true }]);
  });

  test('an empty one draws nothing, and an ordinary message is untouched', () => {
    expect(entriesOf([{ id: 9, role: 'user', content: wrapped('') }])).toEqual([]);
    expect(entriesOf([{ id: 10, role: 'user', content: 'Hello' }])).toEqual([{ kind: 'bubble', id: 10, role: 'user', text: 'Hello' }]);
  });
});

describe('how the transcript says it', () => {
  test('a denial reads as what the owner did, with the reason', () => {
    expect(steerNote(denyNote('  too risky '))).toBe('You denied this: too risky');
  });

  test('any other steer says the owner steered, with the words', () => {
    expect(steerNote('Use the other folder')).toBe('You steered: Use the other folder');
  });
});

// A scheduled run opens on the instructions Hermes writes in front of the job's prompt (work audit #5): the chat shows the prompt, and the instructions as a small note.
const CRON_HINT = '[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Your final response will be automatically delivered. SILENT: respond with exactly "[SILENT]" to suppress delivery. RECURSION: treat phrasing like "each Monday" as context for this run.]';

describe('the first message of a scheduled run', () => {
  test('is split into Hermes’s instructions and the job’s own prompt', () => {
    expect(splitCronPrompt(`${CRON_HINT}\n\nAudit the nightly check`)).toEqual({ instructions: CRON_HINT, prompt: 'Audit the nightly check' });
  });

  test('with nothing after the instructions has an empty prompt, and a text that never closes them is all instructions', () => {
    expect(splitCronPrompt(`${CRON_HINT}\n\n`)).toEqual({ instructions: CRON_HINT, prompt: '' });
    expect(splitCronPrompt('[IMPORTANT: You are running as a scheduled cron job. no end')?.prompt).toBe('');
  });

  test('is left alone when it is any other message, even one that mentions cron', () => {
    expect(splitCronPrompt('Set up a cron job for me')).toBeUndefined();
    expect(splitCronPrompt('[IMPORTANT: The user has invoked the "x" skill]')).toBeUndefined();
  });

  test('a history row of it reads as the prompt with the instructions kept aside', () => {
    expect(entriesOf([{ id: 1, role: 'user', content: `${CRON_HINT}\n\nAudit the nightly check` }])).toEqual([{ kind: 'bubble', id: 1, role: 'user', text: 'Audit the nightly check', scheduled: CRON_HINT }]);
  });
});
