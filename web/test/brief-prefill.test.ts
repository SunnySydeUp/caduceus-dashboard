import { describe, expect, test } from 'vitest';
import { prefillFromMessage, prefillFromSession } from '../src/modules/work/brief-prefill.ts';

const session = { id: '20261018_101500_ab12cd', title: 'Export the report' };

describe('the title of a brief from one message', () => {
  test('is the first line with the Markdown markers and backticks taken off and the spaces collapsed', () => {
    const prefill = prefillFromMessage({ text: '\n\n## > **Fix**   the `export`   job\nMore detail below.', role: 'user', session });

    expect(prefill.title).toBe('Fix the export job');
  });

  test('skips a first line that is only markers', () => {
    expect(prefillFromMessage({ text: '---\n```\nRename the column', role: 'user', session }).title).toBe('Rename the column');
  });

  test('is cut at 80 characters with an ellipsis', () => {
    const title = prefillFromMessage({ text: 'word '.repeat(40), role: 'user', session }).title;

    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
    expect(title.startsWith('word word word')).toBe(true);
  });

  test('keeps a title of exactly 80 characters whole', () => {
    const text = 'a'.repeat(80);

    expect(prefillFromMessage({ text, role: 'user', session }).title).toBe(text);
  });
});

describe('a brief from one message', () => {
  test('from a user message asks for what the owner asked', () => {
    const prefill = prefillFromMessage({ text: '  Export the report as CSV.\n\nUse UTF-8.  ', role: 'user', session });

    expect(prefill.goal).toBe('Export the report as CSV.\n\nUse UTF-8.');
    expect(prefill.context).toBe('');
  });

  test('from an assistant message asks to act on the reply, and carries the reply as context', () => {
    const prefill = prefillFromMessage({ text: '\nThe job fails because the path is missing.\n\nCreate it first.\n', role: 'assistant', session });

    expect(prefill.goal).toBe('Act on this reply from the earlier chat.');
    expect(prefill.context).toBe('The job fails because the path is missing.\n\nCreate it first.');
    expect(prefill.title).toBe('The job fails because the path is missing.');
  });

  test('names the chat session and its id, and the message link when there is one', () => {
    const without = prefillFromMessage({ text: 'Do it.', role: 'user', session });
    const withLink = prefillFromMessage({ text: 'Do it.', role: 'user', session, messageLink: 'https://host/chat/20261018_101500_ab12cd?message=7' });

    expect(without.references).toBe('- Chat session: Export the report (session id `20261018_101500_ab12cd`)');
    expect(withLink.references).toBe('- Chat session: Export the report (session id `20261018_101500_ab12cd`)\n- Message: https://host/chat/20261018_101500_ab12cd?message=7');
  });

  test('calls a chat with no title Untitled chat and still gives its id', () => {
    const prefill = prefillFromMessage({ text: 'Do it.', role: 'user', session: { id: 'abc', title: null } });

    expect(prefill.references).toBe('- Chat session: Untitled chat (session id `abc`)');
  });

  test('empty text gives empty strings, and the references still name the session', () => {
    for (const role of ['user', 'assistant'] as const) {
      const prefill = prefillFromMessage({ text: ' \n ', role, session });

      expect(prefill).toEqual({ title: '', goal: '', context: '', references: '- Chat session: Export the report (session id `20261018_101500_ab12cd`)' });
    }
  });
});

describe('a brief from the whole session', () => {
  test('takes the first user message as the goal and the other turns as a transcript', () => {
    const prefill = prefillFromSession({
      session,
      messages: [
        { role: 'user', text: '  Export the report.  ' },
        { role: 'assistant', text: 'Which format?' },
        { role: 'user', text: 'CSV.' },
        { role: 'assistant', text: 'Done.' },
      ],
    });

    expect(prefill.goal).toBe('Export the report.');
    expect(prefill.context).toBe('**Hermes:** Which format?\n\n**You:** CSV.\n\n**Hermes:** Done.');
  });

  test('uses the session title when there is one, else the first user message', () => {
    const messages = [{ role: 'user' as const, text: '# Export the report as CSV' }];

    expect(prefillFromSession({ session, messages }).title).toBe('Export the report');
    expect(prefillFromSession({ session: { id: 'abc', title: null }, messages }).title).toBe('Export the report as CSV');
    expect(prefillFromSession({ session: { id: 'abc', title: '  ' }, messages }).title).toBe('Export the report as CSV');
  });

  test('cuts a long turn at 1,500 characters with a marker', () => {
    const prefill = prefillFromSession({ session, messages: [{ role: 'user', text: 'Go.' }, { role: 'assistant', text: 'x'.repeat(2000) }] });

    expect(prefill.context).toBe(`**Hermes:** ${'x'.repeat(1500)} …`);
  });

  test('stops adding turns before 12,000 characters and says the rest is in the chat', () => {
    const messages = [{ role: 'user' as const, text: 'Go.' }, ...Array.from({ length: 20 }, (_, index) => ({ role: 'assistant' as const, text: `${index}`.padEnd(1500, 'y') }))];
    const prefill = prefillFromSession({ session, messages });
    const marker = '(The rest of the chat is in the source session.)';

    expect(prefill.context.endsWith(`\n\n${marker}`)).toBe(true);
    const turns = prefill.context.slice(0, -marker.length - 2).split('\n\n');
    expect(turns.length).toBeLessThan(20);
    expect(turns.join('\n\n').length).toBeLessThanOrEqual(12_000);
    expect(turns[0]?.startsWith('**Hermes:** 0y')).toBe(true);
  });

  test('has no truncation marker when everything fits', () => {
    const prefill = prefillFromSession({ session, messages: [{ role: 'user', text: 'Go.' }, { role: 'assistant', text: 'Done.' }] });

    expect(prefill.context).not.toContain('The rest of the chat');
  });

  test('always names the session id in the references', () => {
    expect(prefillFromSession({ session, messages: [] }).references).toBe('- Chat session: Export the report (session id `20261018_101500_ab12cd`)');
    expect(prefillFromSession({ session: { id: 'abc', title: null }, messages: [{ role: 'user', text: 'Hi' }] }).references).toContain('`abc`');
  });

  test('a session with no text gives empty strings', () => {
    const prefill = prefillFromSession({ session: { id: 'abc', title: null }, messages: [{ role: 'user', text: ' ' }, { role: 'assistant', text: '' }] });

    expect(prefill).toEqual({ title: '', goal: '', context: '', references: '- Chat session: Untitled chat (session id `abc`)' });
  });
});
