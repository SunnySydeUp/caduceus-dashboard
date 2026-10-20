import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { createSessionList, type SessionList } from '../../web/src/modules/chat/sessions-list.ts';
import { openGatewayConnection, tabStorage, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedSession } from './fixtures/seed-session.ts';

// Run control (M1 #07): steer, queue, interrupt, side tasks and goals. The chat engine (`web/src/modules/chat/chat-session.ts`) over the
// browser's gateway connection through Caduceus, in front of the real Hermes whose provider is the stub LLM, which can hold a turn
// mid-reply so that "the turn is busy" is a real state of Hermes's.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let cookie: string | undefined;
let work: string;
const pages: TestGatewayConnection[] = [];
const chats: (Chat | SessionList)[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  await hermes.cli('config', 'set', 'tools.tool_search.enabled', 'off');
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-run-control-')));
});
afterEach(async () => {
  try {
    for (const chat of chats.splice(0)) chat.dispose();
    for (const page of pages.splice(0)) page.connection.close();
    await server?.close();
    server = undefined;
    cookie = undefined;
    fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

/** A page of the owner's, connected to Caduceus. A tab's storage that two pages share is a reload of that tab. */
async function openPage(tab?: Pick<Storage, 'getItem' | 'setItem'>) {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  cookie ??= await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie, {}, tab);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  return page;
}

/** A chat on a page, working in the temp directory. */
function openChat(page: TestGatewayConnection, options: Parameters<typeof createChat>[1] = {}) {
  const chat = createChat(page.connection, { history: page.rest, cwd: work, ...options });
  chats.push(chat);
  return chat;
}

describe('a chat that opens a stored session', () => {
  test('a prompt sent while the chat is still attaching goes into that session, not a new one, and a workspace option does not stop it attaching', async () => {
    await seedSession(hermes.home, 'attaching-session', [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
    ]);
    const page = await openPage();
    const list = createSessionList({ connection: page.connection, rest: page.rest, profile: 'default', view: { tab: 'chats', failed: false, quiet: false, all: false } });
    chats.push(list);
    await list.until((state) => state.items.some((item) => item.id === 'attaching-session'));
    const before = list.state.items.map((item) => item.id);

    const chat = openChat(page, { storedId: 'attaching-session' });
    // No waiting between opening the chat and sending: the attach is still in flight.
    await chat.send('Follow-up');
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.length === 4);

    expect(chat.state.error).toBeUndefined();
    expect(chat.state.storedId).toBe('attaching-session');
    expect(chat.state.messages.map((message) => message.text).slice(0, 3)).toEqual(['Earlier question', 'Earlier answer', 'Follow-up']);
    await list.until((state) => state.items.length >= before.length);
    expect(list.state.items.map((item) => item.id).sort()).toEqual([...before].sort());
  });
});

/** The words of every message the model was sent in its last completion, tool results and user turns included. */
const lastHeard = () => JSON.stringify(llm.completions.at(-1)!.messages.map((message) => message.content));
const finished = (messages: number) => (state: { running: boolean; turn: unknown; messages: unknown[] }) => !state.running && state.turn === undefined && state.messages.length >= messages;

describe('steering a busy turn', () => {
  test('Steer goes to Hermes as session.steer and the agent reads it with the next tool result, without a new turn or an interrupt', async () => {
    const page = await openPage();
    const chat = openChat(page);
    const first = llm.nextReply({ chunks: ['Looking ', 'around.'], pauseAfter: 1, toolCalls: [{ id: 'call_echo', name: 'terminal', arguments: { command: 'echo looked' } }] });
    llm.nextReply({ chunks: ['Done, with the blue one.'] });

    await chat.send('Pick a colour');
    await first.paused;
    expect(chat.state.running).toBe(true);
    await chat.steer('Use the blue one');
    first.resume();
    await chat.until(finished(2));

    expect(lastHeard()).toContain('Use the blue one');
    expect(chat.state.messages.map((message) => message.text)).toContain('Done, with the blue one.');
    expect(chat.state.error).toBeUndefined();
  });
});

/** What the user said in the stub model's completions, one entry per completion, in order: each queued message is a turn of its own. */
const promptsSent = () => llm.completions.map((completion) => completion.messages.filter((message) => message.role === 'user').at(-1)?.content);

describe('queueing messages for after the turn', () => {
  test('queued messages wait for the running turn and then run one after the other, in the order they were queued', async () => {
    const page = await openPage();
    const chat = openChat(page);
    const first = llm.nextReply({ chunks: ['One ', 'moment.'], pauseAfter: 1 });
    llm.nextReply({ chunks: ['Second answer.'] });
    llm.nextReply({ chunks: ['Third answer.'] });
    const before = llm.completions.length;

    await chat.send('First question');
    await first.paused;
    chat.enqueue('Second question');
    chat.enqueue('Third question');
    expect(chat.state.queue.map((item) => item.text)).toEqual(['Second question', 'Third question']);
    // Nothing is sent while the turn runs.
    expect(llm.completions.length - before).toBe(1);
    first.resume();
    await chat.until((state) => state.messages.some((message) => message.text === 'Third answer.') && !state.running && state.turn === undefined);

    expect(promptsSent().slice(before)).toEqual(['First question', 'Second question', 'Third question']);
    expect(chat.state.messages.map((message) => message.text)).toEqual(['First question', 'One moment.', 'Second question', 'Second answer.', 'Third question', 'Third answer.']);
    expect(chat.state.queue).toEqual([]);
  });
});

/** A tab's `localStorage`, as far as the queue needs it: a test that reloads a page gives the same one to both. */
function memoryStorage() {
  const kept = new Map<string, string>();
  return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key), size: () => kept.size };
}

describe('changing the queue', () => {
  test('a queued message can be edited, and cancelling one hands its text back; only what is left runs after the turn', async () => {
    const page = await openPage();
    const chat = openChat(page);
    const first = llm.nextReply({ chunks: ['Busy ', 'now.'], pauseAfter: 1 });
    llm.nextReply({ chunks: ['A done.'] });
    llm.nextReply({ chunks: ['B done.'] });
    const before = llm.completions.length;
    await chat.send('Start');
    await first.paused;
    chat.enqueue('A');
    chat.enqueue('B');
    chat.enqueue('C');
    const [a, b, c] = chat.state.queue;

    chat.editQueued(b!.id, 'B, reworded');
    const handedBack = chat.cancelQueued(c!.id);
    expect(handedBack).toBe('C');
    expect(chat.cancelQueued(c!.id)).toBeUndefined();
    expect(chat.state.queue).toEqual([a, { id: b!.id, text: 'B, reworded' }]);
    first.resume();
    await chat.until((state) => state.messages.some((message) => message.text === 'B done.') && !state.running && state.turn === undefined);

    expect(promptsSent().slice(before)).toEqual(['Start', 'A', 'B, reworded']);
    expect(chat.state.queue).toEqual([]);
  });
});

describe('a reload while the turn is still running', () => {
  test('keeps the queue, and the reloaded page runs it once the turn ends', async () => {
    const storage = memoryStorage();
    const tab = tabStorage();
    const first = llm.nextReply({ chunks: ['Still ', 'going.'], pauseAfter: 1 });
    llm.nextReply({ chunks: ['Queued answer.'] });
    const before = llm.completions.length;
    const page = await openPage(tab);
    const chat = openChat(page, { queueStorage: storage });
    await chat.send('Long task');
    await first.paused;
    chat.enqueue('After that');
    await chat.until((state) => state.storedId !== undefined);
    const { storedId } = chat.state;

    // The page goes away mid-turn and a new one opens in the same tab.
    chat.dispose();
    page.connection.close();
    const reloaded = openChat(await openPage(tab), { storedId, queueStorage: storage });
    await reloaded.until((state) => state.running && !state.syncing);
    expect(reloaded.state.queue.map((item) => item.text)).toEqual(['After that']);
    expect(llm.completions.length - before).toBe(1);

    first.resume();
    await reloaded.until((state) => state.messages.some((message) => message.text === 'Queued answer.') && !state.running && state.turn === undefined);

    expect(promptsSent().slice(before)).toEqual(['Long task', 'After that']);
    expect(reloaded.state.queue).toEqual([]);
    expect(storage.size()).toBe(0);
  });
});

describe('stopping a turn that has messages queued behind it', () => {
  test('Stop interrupts the turn in Hermes and holds the queue; Run queue sends it', async () => {
    const page = await openPage();
    const chat = openChat(page);
    const first = llm.nextReply({ chunks: ['Going ', 'on and on.'], pauseAfter: 1 });
    llm.nextReply({ chunks: ['Queued answer.'] });
    const before = llm.completions.length;
    await chat.send('Long task');
    await first.paused;
    chat.enqueue('After that');

    await chat.stop();
    await first.hungUp;
    await chat.until((state) => !state.running);
    // Hermes stopped; nothing was sent behind it.
    expect(chat.state.queue.map((item) => item.text)).toEqual(['After that']);
    expect(chat.state.queuePaused).toBe(true);
    expect(llm.completions.length - before).toBe(1);

    chat.runQueue();
    await chat.until((state) => state.messages.some((message) => message.text === 'Queued answer.') && !state.running && state.turn === undefined);
    expect(promptsSent().slice(before)).toEqual(['Long task', 'After that']);
    expect(chat.state.queue).toEqual([]);
    expect(chat.state.queuePaused).toBe(false);
  });
});

describe('side tasks', () => {
  test('/btw is answered apart from the main thread while the turn goes on undisturbed', async () => {
    const page = await openPage();
    const chat = openChat(page);
    const main = llm.nextReply({ chunks: ['Main ', 'answer.'], pauseAfter: 1 });
    llm.nextReply({ chunks: ['The side answer.'] });
    await chat.send('Main question');
    await main.paused;

    await chat.btw('A quick aside');
    expect(chat.state.sideTasks).toEqual([expect.objectContaining({ kind: 'btw', prompt: 'A quick aside', status: expect.stringMatching(/running|done/) })]);
    const done = await chat.until((state) => state.sideTasks.every((task) => task.status !== 'running'));

    // The answer is the task's, not a message of the chat: the turn is still running, and its transcript holds only its own words.
    expect(done.sideTasks).toEqual([expect.objectContaining({ kind: 'btw', status: 'done', answer: expect.stringContaining('side answer'), unseen: true })]);
    expect(done.running).toBe(true);
    main.resume();
    await chat.until(finished(2));
    expect(chat.state.messages.map((message) => message.text)).toEqual(['Main question', 'Main answer.']);
  });
});

describe('background prompts', () => {
  test('/background shows as running while Hermes works on it, then as finished with its result, which opening marks as read', async () => {
    const page = await openPage();
    const chat = openChat(page);
    const background = llm.nextReply({ chunks: ['The research ', 'result.'], pauseAfter: 1 });

    await chat.background('Research the thing');
    await background.paused;
    expect(chat.state.sideTasks).toEqual([expect.objectContaining({ kind: 'background', prompt: 'Research the thing', status: 'running', unseen: false })]);
    // A background prompt is not a turn of this chat.
    expect(chat.state.running).toBe(false);

    background.resume();
    const done = await chat.until((state) => state.sideTasks.every((task) => task.status !== 'running'));
    expect(done.sideTasks).toEqual([expect.objectContaining({ kind: 'background', status: 'done', answer: 'The research result.', unseen: true })]);

    const [task] = chat.state.sideTasks;
    chat.readSideTask(task!.id);
    expect(chat.state.sideTasks[0]!.unseen).toBe(false);
    chat.dismissSideTask(task!.id);
    expect(chat.state.sideTasks).toEqual([]);
  });
});

describe('a goal', () => {
  test('/goal sets the goal and starts working on it, the goal panel follows Hermes live, and a new text replaces it until it is cleared', async () => {
    const page = await openPage();
    const chat = openChat(page);
    llm.nextReply({ chunks: ['Starting on the release.'] });

    await chat.setGoal('Ship the release');
    const set = await chat.until((state) => state.goal !== undefined);
    expect(set.goal).toMatchObject({ title: 'Ship the release', status: 'active' });
    // Hermes's kickoff is a turn of the chat.
    await chat.until((state) => state.messages.some((message) => message.text === 'Starting on the release.'));

    await chat.setGoal('Ship the release on Friday');
    await chat.until((state) => state.goal?.title === 'Ship the release on Friday');
    await chat.clearGoal();
    await chat.until((state) => state.goal === undefined);
    expect(chat.state.error).toBeUndefined();
  });
});

describe('a goal that outlives the page', () => {
  test('pausing it shows as paused here and on a page that opens the chat afterwards', async () => {
    const tab = tabStorage();
    const page = await openPage(tab);
    const chat = openChat(page);
    llm.nextReply({ chunks: ['Starting.'] });
    await chat.setGoal('Tidy the repository');
    await chat.until((state) => state.goal !== undefined && state.messages.some((message) => message.text === 'Starting.') && !state.running);

    await chat.pauseGoal(true);
    await chat.until((state) => state.goal?.status === 'paused');
    const { storedId } = chat.state;
    chat.dispose();
    page.connection.close();

    const reopened = openChat(await openPage(tab), { storedId });
    await reopened.until((state) => !state.syncing && state.goal !== undefined);
    expect(reopened.state.goal).toMatchObject({ title: 'Tidy the repository', status: 'paused' });
    await reopened.clearGoal();
    await reopened.until((state) => state.goal === undefined);
  });
});
