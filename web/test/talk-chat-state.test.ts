import { describe, expect, test } from 'vitest';
import { chatState } from '../src/modules/chat/talk-header.ts';

// The sigil in Talk's header says how this chat stands, not how the agent's other work stands (talk audit #19).
describe('how a chat stands', () => {
  test('is idle when nothing is going on in it, however the agent’s background tasks are doing', () => {
    expect(chatState({ requests: 0, running: false, failed: false })).toBe('idle');
  });

  test('is working while a turn runs, and blocked only when its own last turn failed', () => {
    expect(chatState({ requests: 0, running: true, failed: false })).toBe('working');
    expect(chatState({ requests: 0, running: false, failed: true })).toBe('blocked');
  });

  test('is waiting when a question or approval of this chat needs the owner, before anything else', () => {
    expect(chatState({ requests: 1, running: true, failed: true })).toBe('waiting');
  });
});
