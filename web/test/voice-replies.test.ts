import { describe, expect, test } from 'vitest';
import { finishedReply, replyTo, type ReplyView } from '../src/modules/voice/replies.ts';

// Telling when a reply is done (M7 #07): auto-read and hands-free mode speak a reply once its turn has finished in front of the owner, never one that was
// already in the transcript when the chat opened, and never one that failed or was stopped.
const working: ReplyView = { running: true, turn: { status: 'streaming' }, error: undefined, messages: [{ id: 1, role: 'user', text: 'Hi' }] };
const done = (reply: Partial<ReplyView['messages'][number]> = {}): ReplyView => ({ running: false, turn: undefined, error: undefined, messages: [{ id: 1, role: 'user', text: 'Hi' }, { id: 2, role: 'assistant', text: 'Hello there.', ...reply }] });

describe('a reply that has just finished', () => {
  test('the turn went from working to settled: its last reply is the one to speak', () => {
    expect(finishedReply(working, done())).toMatchObject({ id: 2, text: 'Hello there.' });
  });

  test('a transcript that was already settled gives nothing: that is history, not a reply that just came', () => {
    expect(finishedReply(done(), done())).toBeUndefined();
  });

  test('still working, or settled in the turn but the reply not yet held, is not done', () => {
    expect(finishedReply(working, working)).toBeUndefined();
    expect(finishedReply(working, { ...done(), turn: { status: 'streaming' } })).toBeUndefined();
  });

  test('a stopped, failed or empty reply is not spoken', () => {
    expect(finishedReply(working, done({ stopped: true }))).toBeUndefined();
    expect(finishedReply(working, done({ failed: { error: 'HTTP 400' } }))).toBeUndefined();
    expect(finishedReply(working, done({ text: '   ' }))).toBeUndefined();
    expect(finishedReply(working, { ...done(), error: 'Hermes is not answering' })).toBeUndefined();
  });

  test('a turn that ended with the owner’s own message last has no reply', () => {
    expect(finishedReply(working, { ...done(), messages: [{ id: 1, role: 'user', text: 'Hi' }] })).toBeUndefined();
  });
});

describe('the reply to a message that was sent', () => {
  const settled = (messages: ReplyView['messages'], extra: Partial<ReplyView> = {}): ReplyView => ({ running: false, turn: undefined, error: undefined, messages, ...extra });

  test('a screen that took over a chat finds the reply by the words that were sent', () => {
    expect(replyTo(settled([{ id: 1, role: 'user', text: 'Hi' }, { id: 2, role: 'assistant', text: 'Hello there.' }]), 'Hi')).toMatchObject({ id: 2 });
  });

  test('only the last message with those words counts, and only a reply after it', () => {
    const view = settled([{ id: 1, role: 'user', text: 'Hi' }, { id: 2, role: 'assistant', text: 'Old.' }, { id: 3, role: 'user', text: 'Hi' }]);
    expect(replyTo(view, 'Hi')).toBeUndefined();
    expect(replyTo(settled([...view.messages, { id: 4, role: 'assistant', text: 'New.' }]), 'Hi')).toMatchObject({ id: 4 });
  });

  test('nothing while the turn is still working, and nothing for a reply that is not to be spoken', () => {
    const messages: ReplyView['messages'] = [{ id: 1, role: 'user', text: 'Hi' }, { id: 2, role: 'assistant', text: 'Partial' }];
    expect(replyTo(settled(messages, { running: true }), 'Hi')).toBeUndefined();
    expect(replyTo(settled([messages[0]!, { id: 2, role: 'assistant', text: 'x', failed: { error: 'e' } }]), 'Hi')).toBeUndefined();
    expect(replyTo(settled([messages[0]!, { id: 2, role: 'assistant', text: 'x', stopped: true }]), 'Hi')).toBeUndefined();
  });
});
