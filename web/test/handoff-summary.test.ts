import { describe, expect, test } from 'vitest';
import { SUMMARY_INPUT_CHARS, summaryRequest } from '../src/modules/chat/handoff-summary.ts';
import type { ChatMessage } from '../src/modules/chat/chat-session.ts';

// The handoff summary (M1 #16): what is asked of Hermes's one-shot model for a chat. The words of the chat are what the model summarises, with
// no marks, no attachments' paths and no tool output; a chat too long for one request is summarised from its newest part, and says so.
const chat: ChatMessage[] = [
  { id: 1, role: 'user', text: 'Please **deploy** staging\n@image:/tmp/screenshot.png' },
  { role: 'assistant', text: '', activity: [{ kind: 'tool', key: 't1', id: 't1', name: 'terminal', status: 'done', output: 'a very long log' }] },
  { id: 2, role: 'assistant', text: 'Deployed. The `migrate` step took 40 s.' },
];

describe('the request for a handoff summary', () => {
  test('the chat as plain words under who said them, with nothing of tool output, and instructions that ask for what a successor needs', () => {
    const request = summaryRequest(chat, { user: 'You', assistant: 'Hermes' });
    expect(request.input).toBe('You: Please deploy staging\n\nHermes: Deployed. The migrate step took 40 s.');
    expect(request.truncated).toBe(false);
    expect(request.instructions).toMatch(/hand(ing)? ?off/i);
    expect(request.instructions).toMatch(/still open/i);
  });

  test('a chat longer than the request allows is cut from its start, on a message boundary, and says it was', () => {
    const long: ChatMessage[] = Array.from({ length: 40 }, (_, n) => ({ id: n, role: n % 2 === 0 ? ('user' as const) : ('assistant' as const), text: `${n} ${'word '.repeat(300)}` }));
    const request = summaryRequest(long, { user: 'You', assistant: 'Hermes' });
    expect(request.truncated).toBe(true);
    expect(request.input.length).toBeLessThanOrEqual(SUMMARY_INPUT_CHARS);
    expect(request.input.startsWith('You: ') || request.input.startsWith('Hermes: ')).toBe(true);
    expect(request.input).toContain('39 word');
    expect(request.input).not.toContain('\n\nHermes: 0 word');
  });

  test('a chat with no words has nothing to summarise', () => {
    expect(summaryRequest([], { user: 'You', assistant: 'Hermes' }).input).toBe('');
  });
});
