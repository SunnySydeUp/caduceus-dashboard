import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { CONTINUE_PROMPT, createChat, transcriptOf, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { killHermes, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { DEFAULT_REPLY, startStubLlm, STUB_TITLE, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedSession } from './fixtures/seed-session.ts';
import crypto from 'node:crypto';
import { createSessionActions, type Outcome } from '../../web/src/modules/chat/sessions-actions.ts';
import type { SessionItem } from '../../web/src/modules/chat/sessions-model.ts';
import type { ConfirmRequest } from '../../web/src/palette.ts';
import { createTieredFetch } from '../../web/src/tiered-fetch.ts';
import { interruptionOf } from '../../web/src/modules/chat/turn-recovery.ts';

// Message actions and turn recovery (M1 #12): the chat engine over the browser's gateway connection through Caduceus (so every call passes the
// policy proxy), in front of the real Hermes whose provider is the stub LLM. What a test asserts is what Hermes holds afterwards: its own history
// over REST, and the prompts the stub model was sent.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let cookie: string | undefined;
let work: string;
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-actions-')));
});
afterEach(async () => {
  for (const chat of chats.splice(0)) chat.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  cookie = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

/** A chat on a page of the owner's, connected to Caduceus. */
async function openChat(options: Parameters<typeof createChat>[1] = {}) {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  cookie ??= await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest, cwd: work, ...options });
  chats.push(chat);
  return { chat, page };
}

const settled = (messages: number) => (state: { running: boolean; turn: unknown; messages: unknown[] }) => !state.running && state.turn === undefined && state.messages.length === messages;
const textsOf = (chat: Chat) => transcriptOf(chat.state).map((message) => `${message.role}: ${message.text}`);
const REPLY = DEFAULT_REPLY.join('');

/** What Hermes holds of a stored session, read over its REST API the way the page does, as `role: text`. */
async function hermesHolds(page: TestGatewayConnection, storedId: string | undefined) {
  const body = (await page.rest(`/api/sessions/${storedId}/messages`)) as { messages: { role: string; content: string }[] };
  return body.messages.map((row) => `${row.role}: ${row.content}`);
}

/** A chat of three exchanges: Q1, Q2 and Q3, each answered with the stub's default reply. */
async function threeExchanges() {
  const opened = await openChat();
  for (const [turn, question] of ['Q1', 'Q2', 'Q3'].entries()) {
    await opened.chat.send(question);
    await opened.chat.until(settled((turn + 1) * 2));
    // Hermes refuses undo, regenerate and fork ("session busy") until it has released the session, which comes after the reply is complete.
    await opened.page.settled();
  }
  return opened;
}

describe('edit and resend', () => {
  test('replaces the message and everything after it, sending the edit as a new turn that the model answers from the earlier history only', async () => {
    const { chat, page } = await threeExchanges();
    const second = chat.state.messages[2]!;
    expect(second.text).toBe('Q2');
    llm.nextReply({ chunks: ['A ', 'new ', 'answer'] });

    expect(await chat.editAndResend(second.id!, 'Q2, reworded')).toBe(true);
    await chat.until(settled(4));

    const expected = ['user: Q1', `assistant: ${REPLY}`, 'user: Q2, reworded', 'assistant: A new answer'];
    expect(textsOf(chat)).toEqual(expected);
    expect(await hermesHolds(page, chat.state.storedId)).toEqual(expected);
    // The model was asked with Q1 and the edit, and never saw the old Q2 or Q3.
    const asked = JSON.stringify(llm.completions.at(-1)!.messages);
    expect(asked).toContain('Q2, reworded');
    expect(asked).not.toContain('"Q3"');
    expect(asked).not.toContain('"Q2"');
  });
});

describe('regenerate', () => {
  test('asks again for the last reply: the reply is replaced, and nothing else in the history changes', async () => {
    const { chat, page } = await threeExchanges();
    llm.nextReply({ chunks: ['A ', 'better ', 'third ', 'answer'] });

    expect(await chat.regenerate()).toBe(true);
    await chat.until(settled(6));

    const expected = ['user: Q1', `assistant: ${REPLY}`, 'user: Q2', `assistant: ${REPLY}`, 'user: Q3', 'assistant: A better third answer'];
    expect(textsOf(chat)).toEqual(expected);
    expect(await hermesHolds(page, chat.state.storedId)).toEqual(expected);
    // The model was asked Q3 once more, and the reply it gave the first time was not in front of it.
    expect(JSON.stringify(llm.completions.at(-1)!.messages).match(/"Q3"/g)).toHaveLength(1);
  });
});

describe('undo', () => {
  test('removes the last exchange from Hermes, says how many messages went, and hands back the message that was undone', async () => {
    const { chat, page } = await threeExchanges();

    const undone = await chat.undo();

    expect(undone).toEqual({ removed: 2, message: 'Q3' });
    expect(textsOf(chat)).toEqual(['user: Q1', `assistant: ${REPLY}`, 'user: Q2', `assistant: ${REPLY}`]);
    expect(await hermesHolds(page, chat.state.storedId)).toEqual(['user: Q1', `assistant: ${REPLY}`, 'user: Q2', `assistant: ${REPLY}`]);
  });

  test('is refused with Hermes\'s words while a reply is being written, and the transcript stays', async () => {
    const { chat } = await openChat();
    const reply = llm.nextReply({ chunks: ['one ', 'two '], pauseAfter: 1 });
    await chat.send('Count');
    await reply.paused;

    await expect(chat.undo()).rejects.toThrow(/busy|running|wait/i);
    reply.resume();
    await chat.until(settled(2));
    expect(textsOf(chat)).toEqual(['user: Count', 'assistant: one two']);
  });
});

describe('fork', () => {
  /** Opens the forked session on a page of its own, the way the screen does after a fork: from its stored id. */
  async function openFork(storedId: string) {
    const { chat } = await openChat({ storedId });
    await chat.until((state) => !state.syncing && state.messages.length > 0);
    return chat;
  }

  test('at the tip branches the whole chat into a new Hermes session, which names the chat it came from; the source is untouched', async () => {
    const { chat, page } = await threeExchanges();
    const source = chat.state.storedId!;
    await chat.until((state) => state.title !== undefined);
    const title = chat.state.title;
    const everything = ['user: Q1', `assistant: ${REPLY}`, 'user: Q2', `assistant: ${REPLY}`, 'user: Q3', `assistant: ${REPLY}`];

    const forked = await chat.fork();

    expect(forked.storedId).not.toBe(source);
    expect(forked.prefill).toBeUndefined();
    expect(await hermesHolds(page, forked.storedId)).toEqual(everything);
    expect(await hermesHolds(page, source)).toEqual(everything);
    const opened = await openFork(forked.storedId);
    expect(textsOf(opened)).toEqual(everything);
    await opened.until((state) => state.forkedFrom !== undefined);
    expect(opened.state.forkedFrom).toEqual({ id: source, title });
    expect(chat.state.forkedFrom).toBeUndefined();
  });

  test('from an earlier reply branches, then undoes back to that reply, and what Hermes holds ends there', async () => {
    const { chat, page } = await threeExchanges();
    const source = chat.state.storedId!;
    const firstReply = chat.state.messages[1]!;

    const forked = await chat.fork(firstReply.id);

    expect(forked.prefill).toBeUndefined();
    expect(await hermesHolds(page, forked.storedId)).toEqual(['user: Q1', `assistant: ${REPLY}`]);
    expect(await hermesHolds(page, source)).toHaveLength(6);
    expect(textsOf(await openFork(forked.storedId))).toEqual(['user: Q1', `assistant: ${REPLY}`]);
  });

  test('from an earlier message of the owner\'s ends before it and hands its words back to edit', async () => {
    const { chat, page } = await threeExchanges();
    const second = chat.state.messages[2]!;

    const forked = await chat.fork(second.id);

    expect(forked.prefill).toBe('Q2');
    expect(await hermesHolds(page, forked.storedId)).toEqual(['user: Q1', `assistant: ${REPLY}`]);
  });

  test('from an earlier reply of a chat that holds a denied command (a steer row, which session.undo counts as a turn) still ends at that reply, with nothing left over', async () => {
    const steer = `\n\n[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]\nI denied that action. My reason: not that folder\n[/OUT-OF-BAND USER MESSAGE]`;
    const id = 'steer_fork_chat';
    await seedSession(hermes.home, id, [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
      { role: 'user', content: steer, display_kind: 'steer' },
      { role: 'assistant', content: 'A3' },
    ], { source: 'caduceus' });
    const { chat, page } = await openChat({ storedId: id });
    await chat.until((state) => !state.syncing && state.messages.length === 6);
    // The steer is a note, not a message of the owner's: no raw marker anywhere in what the page shows.
    expect(chat.state.messages.map((message) => message.text).join('\n')).not.toContain('OUT-OF-BAND');
    expect(chat.state.messages.find((message) => message.note === 'steered')?.text).toBe('I denied that action. My reason: not that folder');
    const firstReply = chat.state.messages.find((message) => message.text === 'A1')!;

    const forked = await chat.fork(firstReply.id);

    expect(forked.notCut).toBeUndefined();
    expect(await hermesHolds(page, forked.storedId)).toEqual(['user: Q1', 'assistant: A1']);
  });

  test('is refused with the reason while a reply is being written', async () => {
    const { chat } = await openChat();
    const reply = llm.nextReply({ chunks: ['one ', 'two '], pauseAfter: 1 });
    await chat.send('Count');
    await reply.paused;

    await expect(chat.fork()).rejects.toThrow(/still writing|stop/i);
    reply.resume();
    await chat.until(settled(2));
  });
});

describe('a failed turn', () => {
  const provider = { status: 400, message: 'bad request from stub' };

  test('is a bubble that says what Hermes said and offers Retry: Retry asks for the reply to the same message again, with no second copy of it', async () => {
    const { chat, page } = await openChat();
    llm.nextReply({ chunks: [], fail: provider });

    await chat.send('Hello fail');
    await chat.until(settled(2));

    const bubble = transcriptOf(chat.state).at(-1)!;
    expect(bubble).toMatchObject({ role: 'assistant', failed: { error: expect.stringContaining('bad request from stub') } });
    expect(chat.state.error).toBeUndefined();
    // Hermes refuses /retry ("session busy") until it has released the session, which comes after the turn is over.
    await page.settled();

    llm.nextReply({ chunks: ['Second ', 'try'] });
    expect(await chat.retry()).toBe(true);
    await chat.until(settled(2));

    expect(textsOf(chat)).toEqual(['user: Hello fail', 'assistant: Second try']);
    expect(await hermesHolds(page, chat.state.storedId)).toEqual(['user: Hello fail', 'assistant: Second try']);
    expect(JSON.stringify(llm.completions.at(-1)!.messages).match(/Hello fail/g)).toHaveLength(1);
  });

  test('is still a failed turn when the chat is opened again: Hermes\'s own note for the turn it did not process', async () => {
    await seedSession(hermes.home, 'failed-before', [
      { role: 'user', content: 'Do the thing' },
      { role: 'assistant', content: 'Your request was not processed. Send it again if you still want me to carry it out.' },
    ]);

    const { chat } = await openChat({ storedId: 'failed-before' });
    await chat.until((state) => !state.syncing && state.messages.length === 2);

    expect(transcriptOf(chat.state)).toMatchObject([{ role: 'user', text: 'Do the thing' }, { role: 'assistant', failed: { error: expect.stringMatching(/not processed/i) } }]);
    expect(interruptionOf(chat.state)).toBeUndefined();
  });
});

describe('an interrupted turn', () => {
  /** A storage of the browser's, kept by the test: what a reload of the same page still has. */
  const browserStorage = () => {
    const kept = new Map<string, string>();
    return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) };
  };

  test('a reply the owner stopped is still marked stopped after a reload, and offers Continue and Retry', async () => {
    const storage = browserStorage();
    const first = await openChat({ queueStorage: storage });
    const reply = llm.nextReply({ chunks: ['one ', 'two ', 'three ', 'four'], pauseAfter: 2 });
    await first.chat.send('Count');
    await reply.paused;
    await first.chat.until((state) => transcriptOf(state).at(-1)?.text === 'one two ');
    await first.chat.stop();
    await reply.hungUp;
    await first.chat.until(settled(2));

    const { chat } = await openChat({ storedId: first.chat.state.storedId, queueStorage: storage });
    await chat.until((state) => !state.syncing && state.messages.length === 2);

    expect(transcriptOf(chat.state).at(-1)).toMatchObject({ role: 'assistant', text: 'one two', stopped: true });
    expect(interruptionOf(chat.state)).toBe('stopped');
  });

  test('a message Hermes never answered is unanswered after a reload; Retry sends it again, and Hermes holds one copy of it', async () => {
    await seedSession(hermes.home, 'unanswered-before', [{ role: 'user', content: 'Anyone there?' }]);
    const { chat, page } = await openChat({ storedId: 'unanswered-before' });
    await chat.until((state) => !state.syncing && state.messages.length === 1);
    expect(interruptionOf(chat.state)).toBe('unanswered');
    llm.nextReply({ chunks: ['Yes, ', 'here.'] });

    expect(await chat.retry()).toBe(true);
    await chat.until(settled(2));

    expect(textsOf(chat)).toEqual(['user: Anyone there?', 'assistant: Yes, here.']);
    expect(await hermesHolds(page, 'unanswered-before')).toEqual(['user: Anyone there?', 'assistant: Yes, here.']);
    expect(JSON.stringify(llm.completions.at(-1)!.messages).match(/Anyone there\?/g)).toHaveLength(1);
    expect(interruptionOf(chat.state)).toBeUndefined();
  });

  test('a turn stopped before the first word is shown as stopped, not failed (Hermes closes it with its failed-turn note); Continue asks Hermes to go on, as a message of its own', async () => {
    const { chat } = await openChat();
    const reply = llm.nextReply({ chunks: ['never ', 'sent'], pauseAfter: 0 });
    await chat.send('Start');
    await reply.paused;
    await chat.stop();
    await reply.hungUp;
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.length === 2);
    expect(transcriptOf(chat.state).at(-1)).toEqual({ id: expect.any(Number), at: expect.any(Number), role: 'assistant', text: '', stopped: true });
    expect(interruptionOf(chat.state)).toBe('stopped');
    llm.nextReply({ chunks: ['Going ', 'on.'] });

    expect(await chat.continueTurn()).toBe(true);
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.length >= 4);

    expect(textsOf(chat)).toEqual(['user: Start', 'assistant: ', `user: ${CONTINUE_PROMPT}`, 'assistant: Going on.']);
    expect(interruptionOf(chat.state)).toBeUndefined();
  });
});

describe('titles', () => {
  /** What the sessions pane's menu runs, over the page's connection and REST proxy; the dialog's answer is the test's. */
  function openActions(page: TestGatewayConnection) {
    const dialogs: ConfirmRequest[] = [];
    const url = server!.url;
    const send = createTieredFetch({
      fetch: (route, init) => fetch(`${url}${route}`, { ...init, headers: { origin: url, cookie: cookie!, ...Object.fromEntries(new Headers(init.headers)) } }),
      confirmer: () => async (request) => (dialogs.push(request), { typed: request.object ?? request.label }),
      withStepUp: (request) => request(),
      online: () => true,
      readOnly: () => false,
      sha256: async (text) => crypto.createHash('sha256').update(text).digest('hex'),
    });
    const actions = createSessionActions({ send, connection: page.connection, confirm: async (request) => (dialogs.push(request), true), readOnly: () => false, profile: 'default' });
    return { actions, dialogs };
  }
  const itemOf = (chat: Chat): SessionItem => ({ id: chat.state.storedId!, title: chat.state.title ?? '', preview: '', source: 'caduceus', startedAt: 0, lastActive: 0, messageCount: 2, pinned: false, unread: false, failed: false, profile: undefined, archived: false, cwd: '', tokens: 0 });
  const done = (outcome: Outcome) => {
    if (outcome.kind !== 'done') throw new Error(`Expected done, got ${JSON.stringify(outcome)}`);
    return outcome;
  };
  const storedTitle = async (page: TestGatewayConnection, id: string | undefined) => ((await page.rest(`/api/sessions/${id}`)) as { title?: string }).title;

  test('a new chat is named by Hermes after its first exchange; Regenerate title asks the title model again from the first message, and what it says is read back from Hermes', async () => {
    const { chat, page } = await openChat();
    await chat.send('Plan a week in Lisbon');
    await chat.until(settled(2));
    await chat.until((state) => state.title !== undefined && state.title.startsWith(STUB_TITLE));
    const first = chat.state.title;
    const { actions, dialogs } = openActions(page);
    llm.nextTitle('Lisbon trip plan');

    const outcome = done(await actions.regenerateTitle(itemOf(chat)));

    expect(outcome.message).toContain('Lisbon trip plan');
    expect(dialogs).toHaveLength(1);
    expect(await storedTitle(page, chat.state.storedId)).toBe('Lisbon trip plan');
    expect(JSON.stringify(llm.titleRequests.at(-1))).toContain('Plan a week in Lisbon');
    await chat.refreshTitle();
    expect(chat.state.title).toBe('Lisbon trip plan');

    // Undo puts Hermes's title back as it was.
    done(await outcome.undo!());
    expect(await storedTitle(page, chat.state.storedId)).toBe(first);
  });

  test('a title another chat already has gets a number, so that Hermes takes it', async () => {
    const { chat, page } = await openChat();
    await chat.send('Another chat');
    await chat.until(settled(2));
    await chat.until((state) => state.title !== undefined);
    const other = await openChat();
    await other.chat.send('Yet another chat');
    await other.chat.until(settled(2));
    await other.chat.until((state) => state.title !== undefined);
    const { actions } = openActions(page);
    llm.nextTitle('Shared name');
    done(await actions.regenerateTitle(itemOf(chat)));
    llm.nextTitle('Shared name');

    done(await actions.regenerateTitle(itemOf(other.chat)));

    expect(await storedTitle(page, other.chat.state.storedId)).toBe('Shared name #2');
  });

  test('a turn killed with Hermes is picked up again by Hermes itself: the chat marks it so, shows one answer, and offers nothing to retry', async () => {
    const { chat, page } = await openChat();
    const reply = llm.nextReply({ chunks: ['one ', 'two ', 'three'], pauseAfter: 1 });
    await chat.send('Count kill');
    await reply.paused;
    await chat.until((state) => transcriptOf(state).at(-1)?.text === 'one ');
    llm.nextReply({ chunks: ['Picked ', 'up.'] });

    killHermes(hermes);
    await page.until((status) => status.state === 'reconnecting');
    await page.until((status) => status.state === 'connected');
    // Hermes writes its note and answers on its own once the session is opened again: the chat follows it.
    await chat.until((state) => !state.syncing && !state.running && state.turn === undefined && state.messages.some((message) => message.role === 'assistant' && message.text === 'Picked up.'));

    expect(transcriptOf(chat.state).map((message) => message.note ?? message.role)).toEqual(['user', 'continued', 'assistant']);
    expect(interruptionOf(chat.state)).toBeUndefined();
    expect(await hermesHolds(page, chat.state.storedId)).toHaveLength(3);
  });
});
