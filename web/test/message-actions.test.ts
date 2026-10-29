import { describe, expect, test } from 'vitest';
import type { ChatMessage } from '../src/modules/chat/chat-session.ts';
import { BUSY_REASON, editableText, editedText, forkFailureWords, forkPlan, forkWasCut, messageEntries, plainText, removedByEdit } from '../src/modules/chat/message-actions.ts';

// What the owner can do to a message (M1 #12): the words an edit sends, how much of the history it removes, how a fork is cut back, and what Copy puts on the clipboard.
describe('edit and resend', () => {
  test('an edit sends the new words and keeps the attachment lines the message ended with', () => {
    const original = 'Look at this\n[User attached file: /tmp/notes.md]\n@image:/tmp/shot.png';

    expect(editableText(original)).toBe('Look at this');
    expect(editedText(original, '  Look at this closely \n')).toBe('Look at this closely\n[User attached file: /tmp/notes.md]\n@image:/tmp/shot.png');
    expect(editedText('Plain', 'Plainer')).toBe('Plainer');
  });

  test('says how many messages an edit removes: the message and every one after it, not the cards between them', () => {
    const messages: ChatMessage[] = [
      { id: 1, role: 'user', text: 'Q1' },
      { id: 2, role: 'assistant', text: 'A1' },
      { id: 3, role: 'user', text: 'Q2' },
      { role: 'assistant', text: '', activity: [], key: 'a-1' },
      { id: 4, role: 'assistant', text: 'A2' },
      { id: 5, role: 'user', text: 'Q3' },
    ];

    expect(removedByEdit(messages, 3)).toEqual({ messages: 3, replies: 1 });
    expect(removedByEdit(messages, 5)).toEqual({ messages: 1, replies: 0 });
    expect(removedByEdit(messages, 99)).toEqual({ messages: 0, replies: 0 });
  });
});

describe('the plan of a fork from an earlier message', () => {
  // A branch keeps its parent's times and has row ids of its own, so a message is found by its role and its time (`from(n)`: the n-th message's, as the chat it came from holds it).
  const from = (n: number) => ({ role: branch[n - 1]!.role, at: n * 10 });
  const branch = [
    { role: 'user', text: 'Q1', timestamp: 10 },
    { role: 'assistant', text: 'A1', timestamp: 20 },
    { role: 'user', text: 'Q2', timestamp: 30 },
    { role: 'assistant', text: 'A2', timestamp: 40 },
    { role: 'user', text: '[System note: Your previous turn was interrupted mid-run]', timestamp: 50, display_kind: 'auto_continue' },
    { role: 'assistant', text: 'A2 again', timestamp: 60 },
    { role: 'user', text: 'Q3', timestamp: 70 },
    { role: 'assistant', text: 'A3', timestamp: 80 },
  ];

  test('a reply is kept, and each later message of the owner\'s is one undo (Hermes\'s own notes in the history are not)', () => {
    expect(forkPlan(branch, from(2))).toEqual({ undo: 2, users: 1, last: 'A1', prefill: undefined });
    expect(forkPlan(branch, from(6))).toEqual({ undo: 1, users: 2, last: 'A2 again', prefill: undefined });
    expect(forkPlan(branch, from(8))).toEqual({ undo: 0, users: 3, last: 'A3', prefill: undefined });
  });

  test('a message of the owner\'s is cut too, and its words come back to edit', () => {
    expect(forkPlan(branch, from(3))).toEqual({ undo: 2, users: 1, last: 'A1', prefill: 'Q2' });
    expect(forkPlan(branch, from(1))).toEqual({ undo: 3, users: 0, last: undefined, prefill: 'Q1' });
  });

  test('is nothing for a message the branch does not hold', () => {
    expect(forkPlan(branch, { role: 'user', at: 990 })).toBeUndefined();
    expect(forkPlan(branch, { role: 'assistant', at: 10 })).toBeUndefined();
    expect(forkPlan(branch, { role: 'user', at: undefined })).toBeUndefined();
  });
});

// Talk audit #1: a chat with a denied command (a steer row) failed to fork, because the page did not count that row as a turn although `session.undo` does.
describe('a fork of a chat that has a steer in it', () => {
  const chat = [
    { role: 'user', text: 'Q1', timestamp: 10 },
    { role: 'assistant', text: 'A1', timestamp: 20 },
    { role: 'user', text: 'Q2', timestamp: 30 },
    { role: 'user', text: 'I denied that action. My reason: no', timestamp: 35, display_kind: 'steer' },
    { role: 'assistant', text: 'A2', timestamp: 40 },
  ];

  test('counts the steer as one of the turns `session.undo` takes off, so the page undoes as often as Hermes needs', () => {
    expect(forkPlan(chat, { role: 'assistant', at: 20 })).toEqual({ undo: 2, users: 1, last: 'A1', prefill: undefined });
    expect(forkPlan(chat, { role: 'user', at: 30 })).toEqual({ undo: 2, users: 1, last: 'A1', prefill: 'Q2' });
  });

  test('a note Hermes wrote of its own is still not a turn', () => {
    const noted = [...chat, { role: 'user', text: '[System note: interrupted]', timestamp: 50, display_kind: 'auto_continue' }, { role: 'assistant', text: 'A3', timestamp: 60 }];
    expect(forkPlan(noted, { role: 'assistant', at: 20 })?.undo).toBe(2);
  });

  test('a branch that was cut where the plan said is cut; one that holds more or ends elsewhere is not', () => {
    const plan = forkPlan(chat, { role: 'assistant', at: 20 })!;
    expect(forkWasCut(plan, chat.slice(0, 2))).toBe(true);
    expect(forkWasCut(plan, chat.slice(0, 4))).toBe(false);
    expect(forkWasCut(plan, chat)).toBe(false);
    expect(forkWasCut({ undo: 0, users: 0, last: undefined, prefill: 'Q1' }, [])).toBe(true);
  });

  test('Hermes’s “no longer in session history” and “busy” are said in plain words, anything else as Hermes said it', () => {
    expect(forkFailureWords('undo: target user message is no longer in session history')).toMatch(/no longer holds that message/);
    expect(forkFailureWords('session busy')).toMatch(/still working/);
    expect(forkFailureWords('undo: disk is full')).toBe('disk is full');
  });
});

describe('copy as plain text', () => {
  test('reads the Markdown as words: no markup, link addresses kept, list markers and code lines kept, table cells tab separated', () => {
    const markdown = ['# Plan', '', 'Do **this** and *that*, see [the docs](https://example.com/docs) and `code`.', '', '- one', '- two', '', '1. first', '2. second', '', '```js', 'const a = 1;', '```', '', '| a | b |', '|---|---|', '| 1 | 2 |'].join('\n');

    expect(plainText(markdown)).toBe(['Plan', 'Do this and that, see the docs (https://example.com/docs) and code.', '- one\n- two', '1. first\n2. second', 'const a = 1;', 'a\tb\n1\t2'].join('\n\n'));
  });

  test('a link whose words are its address is not said twice', () => {
    expect(plainText('<https://example.com>')).toBe('https://example.com');
    expect(plainText('[https://example.com/x](https://example.com/x)')).toBe('https://example.com/x');
  });
});

describe('what a message offers', () => {
  const idle = { last: false, busy: false, link: true, task: true };
  const ids = (message: Parameters<typeof messageEntries>[0], context = idle) => messageEntries(message, context).map((entry) => entry.id);

  test('a message of the owner\'s can be copied, edited and forked from; an earlier reply can be copied and forked from', () => {
    expect(ids({ id: 1, role: 'user', text: 'Q' })).toEqual(['copy-text', 'copy-markdown', 'edit', 'fork', 'link', 'task']);
    expect(ids({ id: 2, role: 'assistant', text: 'A' })).toEqual(['copy-text', 'copy-markdown', 'read-aloud', 'fork', 'link', 'task']);
  });

  test('the last reply can also be regenerated, and the last message undone', () => {
    const last = { ...idle, last: true };
    expect(ids({ id: 2, role: 'assistant', text: 'A' }, last)).toEqual(['copy-text', 'copy-markdown', 'read-aloud', 'regenerate', 'fork', 'undo', 'link', 'task']);
    expect(ids({ id: 1, role: 'user', text: 'Q' }, last)).toEqual(['copy-text', 'copy-markdown', 'edit', 'fork', 'undo', 'link', 'task']);
  });

  test('a failed turn offers Retry (not Regenerate) when it is the last one, and copies Hermes\'s error', () => {
    const failed = { id: 3, role: 'assistant' as const, text: 'Your request was not processed.', failed: { error: 'HTTP 400' } };
    expect(ids(failed, { ...idle, last: true })).toEqual(['copy-text', 'copy-markdown', 'retry', 'fork', 'undo', 'link', 'task']);
    expect(ids(failed)).not.toContain('retry');
  });

  test('every change to Hermes\'s history is switched off, with the reason, while a turn runs; copying is not', () => {
    const entries = messageEntries({ id: 2, role: 'assistant', text: 'A' }, { last: true, busy: true, link: false, task: false });

    expect(entries.map((entry) => [entry.id, entry.disabled])).toEqual([
      ['copy-text', undefined],
      ['copy-markdown', undefined],
      ['read-aloud', undefined],
      ['regenerate', BUSY_REASON],
      ['fork', BUSY_REASON],
      ['undo', BUSY_REASON],
    ]);
  });

  test('a read-only session offers copying, its link and a task, and nothing that changes its history', () => {
    const readOnly = { ...idle, last: true, readOnly: true as const };
    expect(ids({ id: 2, role: 'assistant', text: 'A' }, readOnly)).toEqual(['copy-text', 'copy-markdown', 'read-aloud', 'link', 'task']);
    expect(ids({ id: 1, role: 'user', text: 'Q' }, readOnly)).toEqual(['copy-text', 'copy-markdown', 'link', 'task']);
  });

  test('only a reply with words can be read aloud: not the owner\'s message, not a failed turn, not an empty reply', () => {
    expect(ids({ id: 1, role: 'user', text: 'Q' })).not.toContain('read-aloud');
    expect(ids({ id: 3, role: 'assistant', text: 'Your request was not processed.', failed: { error: 'HTTP 400' } })).not.toContain('read-aloud');
    expect(ids({ id: 4, role: 'assistant', text: '' })).not.toContain('read-aloud');
  });

  test('a message Hermes does not hold yet (the turn in progress) offers copying only, and activity cards offer nothing', () => {
    expect(ids({ role: 'assistant', text: 'so far' })).toEqual(['copy-text', 'copy-markdown']);
    expect(ids({ role: 'assistant', text: '', activity: [] })).toEqual([]);
    expect(ids({ id: 4, role: 'assistant', text: '' })).toEqual(['fork', 'link']);
  });

  test('the hover toolbar has the quick ones: copy, edit, regenerate or retry, fork; the rest is in the menu', () => {
    expect(messageEntries({ id: 2, role: 'assistant', text: 'A' }, { ...idle, last: true }).filter((entry) => entry.quick).map((entry) => entry.id)).toEqual(['copy-text', 'read-aloud', 'regenerate', 'fork']);
  });
});
