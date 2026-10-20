import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat, type ChatState } from '../../web/src/modules/chat/chat-session.ts';
import { clarifyDeadline } from '../../web/src/modules/chat/requests.ts';
import { openGatewayConnection, tabStorage, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Approvals and clarify questions (M1 #06): the chat engine's request state (`web/src/modules/chat/chat-session.ts`, with the pure
// parts in `requests.ts`), over the browser's gateway connection through Caduceus, in front of the real Hermes whose provider is the
// stub LLM. The stub makes the model call `terminal` with a command Hermes holds for approval, and `clarify`, so every request here
// is one Hermes really sends and every answer one it really takes: what an answer did is read from the files the command touches.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let work: string;
let cookie: string | undefined;
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
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
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-approvals-')));
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

/** A chat on a page of the owner's. A page that is dropped redials after `redialMs` (a test that wants it away for a while makes it long, and redials by hand). */
async function openChat(options: Parameters<typeof createChat>[1] = {}, redialMs?: number) {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  cookie ??= await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie, redialMs === undefined ? {} : { backoff: { baseDelayMs: redialMs, capMs: redialMs } });
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest, cwd: work, ...options });
  chats.push(chat);
  return { chat, page, url: server.url };
}

/** Makes the model call `terminal` with a command Hermes holds for approval (it deletes `dir`), then say `after`. */
function removeDirectory(dir: string, after: string, callId = 'call_rm') {
  llm.nextReply({ chunks: [], toolCalls: [{ id: callId, name: 'terminal', arguments: { command: `rm -rf ${dir}` } }] });
  llm.nextReply({ chunks: [after] });
}
const finished = (state: ChatState) => !state.running && state.turn === undefined && state.messages.length > 1;

describe('an approval', () => {
  test('shows the exact command and where it runs, and Allow once lets this one run', async () => {
    const { chat } = await openChat();
    const doomed = path.join(work, 'doomed');
    fs.mkdirSync(doomed);
    removeDirectory(doomed, 'Removed it.');

    await chat.send('Clean up');
    await chat.until((state) => state.requests.length === 1);

    const [card] = chat.state.requests;
    expect(card).toMatchObject({ kind: 'approval', command: `rm -rf ${doomed}`, description: 'delete in root path', choices: ['once', 'session', 'always', 'deny'], status: 'open' });
    expect(chat.state.cwd).toBe(work);
    // Hermes is holding the command: nothing has run.
    expect(fs.existsSync(doomed)).toBe(true);

    await chat.answerApproval(card!.id, { choice: 'once' });
    await chat.until(finished);

    expect(fs.existsSync(doomed)).toBe(false);
    expect(chat.state.requests).toEqual([]);
  });

  test('Allow for this session lets the same kind of command run again without asking', async () => {
    const { chat } = await openChat();
    const first = path.join(work, 'first');
    const second = path.join(work, 'second');
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    removeDirectory(first, 'Removed the first.');
    await chat.send('Clean the first');
    await chat.until((state) => state.requests.length === 1);
    await chat.answerApproval(chat.state.requests[0]!.id, { choice: 'session' });
    await chat.until(finished);
    expect(fs.existsSync(first)).toBe(false);

    removeDirectory(second, 'Removed the second.', 'call_rm2');
    await chat.send('Clean the second');
    await chat.until((state) => state.messages.some((message) => message.text === 'Removed the second.'));

    expect(fs.existsSync(second)).toBe(false);
    expect(chat.state.requests).toEqual([]);
  });

  test('Deny keeps the command from running, and the agent is told why', async () => {
    const { chat } = await openChat();
    const kept = path.join(work, 'kept');
    fs.mkdirSync(kept);
    removeDirectory(kept, 'Left it alone.');
    await chat.send('Clean up');
    await chat.until((state) => state.requests.length === 1);

    await chat.answerApproval(chat.state.requests[0]!.id, { choice: 'deny', reason: 'those are my tax records' });
    await chat.until(finished);

    expect(fs.existsSync(kept)).toBe(true);
    // What the model was told the tool did, and the note beside it.
    const heard = JSON.stringify(llm.completions.at(-1)!.messages.filter((message) => message.role === 'tool' || message.role === 'user').map((message) => message.content));
    expect(heard).toContain('BLOCKED');
    expect(heard).toContain('those are my tax records');
  });

  test('Allow always is a standing permission: it needs a passkey first, and Hermes remembers the answer', async () => {
    const answers = [false, true];
    const asked: boolean[] = [];
    let grant: (() => Promise<void>) | undefined;
    const { chat, url } = await openChat({
      // The owner cancels the passkey prompt the first time, and confirms the second.
      stepUp: async () => {
        const confirm = answers[asked.length]!;
        asked.push(confirm);
        if (confirm) await grant!();
        return confirm;
      },
    });
    const authenticator = await addPasskey(url, cookie!);
    grant = () => stepUp(url, cookie!, authenticator);
    const forever = path.join(work, 'forever');
    fs.mkdirSync(forever);
    // A relative path is another kind of command than the absolute ones the other tests run (Hermes remembers an answer per kind).
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_rm_forever', name: 'terminal', arguments: { command: 'rm -r forever' } }] });
    llm.nextReply({ chunks: ['Removed it.'] });
    await chat.send('Clean up');
    await chat.until((state) => state.requests.length === 1);
    const id = chat.state.requests[0]!.id;
    expect(chat.state.requests[0]).toMatchObject({ command: 'rm -r forever', description: 'recursive delete' });

    // Without a passkey the proxy refuses it, and the card stays open with the reason.
    await chat.answerApproval(id, { choice: 'always' });
    expect(chat.state.requests[0]).toMatchObject({ status: 'open', error: 'This needs a fresh passkey confirmation.' });
    expect(fs.existsSync(forever)).toBe(true);

    await chat.answerApproval(id, { choice: 'always' });
    await chat.until(finished);
    expect(asked).toEqual([false, true]);
    expect(fs.existsSync(forever)).toBe(false);
    expect(fs.readFileSync(path.join(hermes.home, 'config.yaml'), 'utf8')).toContain('recursive delete');
  });
});

/** What Hermes told the model the last tool did. */
const toolSaid = () => llm.completions.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => String(message.content)).join('\n');

describe('a clarify question', () => {
  // Hermes 0.22 has the model ask through `questions` only (a single question is a list of one), sends the card as `questions` with ids `q0`, `q1`, …, and takes
  // `{answers}` by id: a result without `answers` is a cancel-all.
  test('is answered by picking one of the choices, which the agent hears as the answer', async () => {
    const { chat } = await openChat();
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_ask', name: 'clarify', arguments: { questions: [{ question: 'Which colour?', choices: ['Red', 'Blue'] }] } }] });
    llm.nextReply({ chunks: ['Blue it is.'] });

    await chat.send('Pick a colour for me');
    await chat.until((state) => state.requests.length === 1);
    expect(chat.state.requests[0]).toMatchObject({ kind: 'clarify', questions: [{ qid: 'q0', question: 'Which colour?', choices: expect.arrayContaining(['Blue']), multiSelect: false }] });

    await chat.answerClarify(chat.state.requests[0]!.id, { q0: 'Blue' });
    await chat.until(finished);

    expect(JSON.parse(toolSaid())).toMatchObject({ outcome: 'submitted', responses: [{ question: 'Which colour?', status: 'answered', user_response: 'Blue' }] });
    expect(chat.state.requests).toEqual([]);
  });

  test('is answered in free text when it offers no choices', async () => {
    const { chat } = await openChat();
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_name', name: 'clarify', arguments: { questions: [{ question: 'What should I call the project?' }] } }] });
    llm.nextReply({ chunks: ['Noted.'] });

    await chat.send('Start a project');
    await chat.until((state) => state.requests.length === 1);
    expect(chat.state.requests[0]).toMatchObject({ questions: [{ question: 'What should I call the project?', choices: [] }] });
    await chat.answerClarify(chat.state.requests[0]!.id, { q0: '  Kestrel  ' });
    await chat.until(finished);

    expect(JSON.parse(toolSaid())).toMatchObject({ responses: [{ status: 'answered', user_response: 'Kestrel' }] });
  });

  test('can ask several questions at once, and several picks of one', async () => {
    const { chat } = await openChat();
    llm.nextReply({
      chunks: [],
      toolCalls: [{
        id: 'call_form',
        name: 'clarify',
        arguments: { questions: [{ question: 'Which toppings?', choices: ['Ham', 'Olives', 'Basil'], multi_select: true }, { question: 'Anything to avoid?' }] },
      }],
    });
    llm.nextReply({ chunks: ['Got it.'] });

    await chat.send('Order a pizza');
    await chat.until((state) => state.requests.length === 1);
    const card = chat.state.requests[0]!;
    if (card.kind !== 'clarify') throw new Error('expected a clarify card');
    expect(card.questions.map(({ question, multiSelect }) => ({ question, multiSelect }))).toEqual([{ question: 'Which toppings?', multiSelect: true }, { question: 'Anything to avoid?', multiSelect: false }]);

    await chat.answerClarify(card.id, { [card.questions[0]!.qid]: ['Ham', 'Basil'], [card.questions[1]!.qid]: 'Anchovies' });
    await chat.until(finished);

    expect(JSON.parse(toolSaid()).responses.map((row: { user_response: unknown }) => row.user_response)).toEqual([['Ham', 'Basil'], 'Anchovies']);
  });
});

describe('a clarify question that nobody answers', () => {
  test('counts down to the deadline Hermes\'s config sets, then says what Hermes did', async () => {
    const setTimeoutS = (seconds: number) => hermes.cli('config', 'set', 'agent.clarify_timeout', String(seconds));
    await setTimeoutS(2);
    try {
      const { chat } = await openChat();
      llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_late', name: 'clarify', arguments: { questions: [{ question: 'Still there?' }] } }] });
      llm.nextReply({ chunks: ['Carrying on.'] });
      await chat.send('Ask me something');
      await chat.until((state) => state.requests.length === 1);
      await chat.until((state) => state.clarifyTimeoutS === 2);

      const card = chat.state.requests[0]!;
      if (card.kind !== 'clarify') throw new Error('expected a clarify card');
      expect(clarifyDeadline(card, chat.state.clarifyTimeoutS)).toBe(card.receivedAt + 2000);

      await chat.until((state) => state.settled.length === 1);
      expect(chat.state.settled[0]).toEqual({ id: card.id, kind: 'clarify', outcome: 'expired', text: 'Time ran out: Hermes carried on without an answer.' });
      expect(chat.state.requests).toEqual([]);
      await chat.until(finished);
      expect(JSON.parse(toolSaid())).toMatchObject({ outcome: 'timed_out', responses: [{ question: 'Still there?', status: 'unanswered', user_response: null }] });
    } finally {
      await setTimeoutS(3600);
    }
  });
});

/** Records what a chat shows as it syncs, so a test can say what it showed at the moment it unblocked. */
function whenUnblocked(chat: Chat) {
  const unblocked = Promise.withResolvers<ChatState>();
  let blocked = false;
  chat.subscribe(() => {
    if (chat.state.syncing) blocked = true;
    else if (blocked) unblocked.resolve(chat.state);
  });
  return unblocked.promise;
}

describe('an approval that is still open when the page comes back', () => {
  test('is shown again by a reload, before the chat is ready for the owner', async () => {
    const tab = tabStorage();
    const first = openGatewayConnection((server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home })).url, (cookie ??= await ownerCookie(server.url)), {}, tab);
    pages.push(first);
    await first.until((status) => status.state === 'connected');
    const before = createChat(first.connection, { history: first.rest, cwd: work });
    chats.push(before);
    const doomed = path.join(work, 'doomed');
    fs.mkdirSync(doomed);
    removeDirectory(doomed, 'Removed it.');
    await before.send('Clean up');
    await before.until((state) => state.requests.length === 1);

    // The page is closed and opened again in the same tab.
    before.dispose();
    first.connection.close();
    const second = openGatewayConnection(server.url, cookie, {}, tab);
    pages.push(second);
    await second.until((status) => status.state === 'connected');
    const after = createChat(second.connection, { history: second.rest, storedId: before.state.storedId });
    chats.push(after);
    const ready = await whenUnblocked(after);

    expect(ready.requests).toHaveLength(1);
    expect(ready.requests[0]).toMatchObject({ kind: 'approval', command: `rm -rf ${doomed}`, status: 'open' });
    await after.answerApproval(ready.requests[0]!.id, { choice: 'once' });
    await after.until(finished);
    expect(fs.existsSync(doomed)).toBe(false);
  });

  test('is shown by a reconnect when Hermes asked while the page was away, once', async () => {
    const { chat, page } = await openChat({}, 60_000);
    const doomed = path.join(work, 'doomed');
    fs.mkdirSync(doomed);
    const reply = llm.nextReply({ chunks: ['Checking. ', 'Now.'], pauseAfter: 1, toolCalls: [{ id: 'call_rm_away', name: 'terminal', arguments: { command: `rm -rf ${doomed}` } }] });
    llm.nextReply({ chunks: ['Removed it.'] });
    await chat.send('Clean up');
    await reply.paused;

    // The connection drops, and Hermes asks while nobody is listening. A second device sees that it has.
    page.connection.client.invalidate('The connection was lost.');
    await page.until((status) => status.state === 'reconnecting');
    reply.resume();
    const other = await openPage();
    const watcher = createChat(other.connection, { history: other.rest, storedId: chat.state.storedId });
    chats.push(watcher);
    await watcher.until((state) => state.requests.length === 1);
    expect(chat.state.requests).toEqual([]);

    const ready = whenUnblocked(chat);
    page.connection.reconnect();
    await page.until((status) => status.state === 'connected');

    expect((await ready).requests).toHaveLength(1);
    await chat.answerApproval(chat.state.requests[0]!.id, { choice: 'once' });
    await chat.until(finished);
    expect(fs.existsSync(doomed)).toBe(false);
    expect(chat.state.requests).toEqual([]);
  });
});

/** A second page (another tab) of the owner's, connected. */
async function openPage() {
  const page = openGatewayConnection(server!.url, cookie!);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  return page;
}

describe('the same chat on two devices', () => {
  /** The chat Hermes holds for `first`'s session, opened on a second device (another tab, so another connection). */
  async function secondDevice(first: Chat) {
    const second = await openPage();
    const chat = createChat(second.connection, { history: second.rest, storedId: first.state.storedId });
    chats.push(chat);
    return chat;
  }

  test('an approval answered on one closes on the other, which says it was answered elsewhere', async () => {
    const { chat: phone } = await openChat();
    const doomed = path.join(work, 'doomed');
    fs.mkdirSync(doomed);
    removeDirectory(doomed, 'Removed it.');
    await phone.send('Clean up');
    await phone.until((state) => state.requests.length === 1);
    const laptop = await secondDevice(phone);
    await laptop.until((state) => state.requests.length === 1 && !state.syncing);

    await phone.answerApproval(phone.state.requests[0]!.id, { choice: 'once' });
    await laptop.until((state) => state.settled.length === 1);

    expect(laptop.state.settled[0]).toMatchObject({ kind: 'approval', outcome: 'answered-elsewhere', text: 'Answered elsewhere.' });
    expect(laptop.state.requests).toEqual([]);
    expect(phone.state.settled).toEqual([]);
    await laptop.until(finished);
    expect(fs.existsSync(doomed)).toBe(false);
  });

  test('a question answered on one closes on the other', async () => {
    const { chat: phone } = await openChat();
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_ask_two', name: 'clarify', arguments: { questions: [{ question: 'Left or right?', choices: ['Left', 'Right'] }] } }] });
    llm.nextReply({ chunks: ['Going left.'] });
    await phone.send('Which way?');
    await phone.until((state) => state.requests.length === 1);
    const laptop = await secondDevice(phone);
    await laptop.until((state) => state.requests.length === 1 && !state.syncing);

    await laptop.answerClarify(laptop.state.requests[0]!.id, { q0: 'Left' });
    await phone.until((state) => state.settled.length === 1);

    expect(phone.state.settled[0]).toMatchObject({ kind: 'clarify', outcome: 'answered-elsewhere' });
    expect(phone.state.requests).toEqual([]);
    expect(laptop.state.settled).toEqual([]);
    await phone.until(finished);
  });
});

describe('read-only mode', () => {
  test('lets the owner deny a held command and nothing else about it', async () => {
    const { chat, url } = await openChat();
    const kept = path.join(work, 'kept');
    fs.mkdirSync(kept);
    removeDirectory(kept, 'Left it alone.');
    await chat.send('Clean up');
    await chat.until((state) => state.requests.length === 1);
    // Turning read-only mode on or off is the owner's, behind a passkey.
    await stepUp(url, cookie!, await addPasskey(url, cookie!));
    const readOnly = (on: boolean) => fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { origin: url, cookie: cookie!, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: on }) });
    expect((await readOnly(true)).ok).toBe(true);
    try {
      const id = chat.state.requests[0]!.id;

      await chat.answerApproval(id, { choice: 'once' });
      expect(chat.state.requests[0]).toMatchObject({ status: 'open', error: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' });
      expect(fs.existsSync(kept)).toBe(true);

      await chat.answerApproval(id, { choice: 'deny' });
      await chat.until(finished);
      expect(fs.existsSync(kept)).toBe(true);
      expect(chat.state.requests).toEqual([]);
    } finally {
      await readOnly(false);
    }
  });
});

describe('YOLO for a session', () => {
  test('needs a passkey to switch on, takes effect at once, and switches off without one', async () => {
    let grant: (() => Promise<void>) | undefined;
    const asked: number[] = [];
    const { chat, url } = await openChat({
      stepUp: async () => {
        asked.push(asked.length);
        await grant!();
        return true;
      },
    });
    const authenticator = await addPasskey(url, cookie!);
    grant = () => stepUp(url, cookie!, authenticator);
    await chat.start();
    expect(chat.state.yolo).toBe(false);

    await chat.setYolo(true);
    await chat.until((state) => state.yolo);
    expect(asked).toEqual([0]);

    // Everything runs without asking.
    const doomed = path.join(work, 'doomed');
    fs.mkdirSync(doomed);
    removeDirectory(doomed, 'Removed it.');
    await chat.send('Clean up');
    await chat.until(finished);
    expect(fs.existsSync(doomed)).toBe(false);
    expect(chat.state.requests).toEqual([]);

    await chat.setYolo(false);
    await chat.until((state) => !state.yolo);
    expect(asked).toEqual([0]);
  });

  test('switched on a chat that is still opening applies to that chat, not a new one', async () => {
    const { chat: first } = await openChat();
    await first.send('Hello');
    await first.until(finished);
    const other = await openPage();
    const reopened = createChat(other.connection, { history: other.rest, storedId: first.state.storedId });
    chats.push(reopened);

    // Straight away: the chat is still attaching to its session.
    await reopened.setYolo(false);

    expect(reopened.state.storedId).toBe(first.state.storedId);
    await reopened.until((state) => !state.syncing);
    expect(reopened.state.storedId).toBe(first.state.storedId);
  });

  test('is refused, and stays off, when the owner does not confirm with a passkey', async () => {
    const { chat } = await openChat({ stepUp: async () => false });
    await chat.start();

    await expect(chat.setYolo(true)).rejects.toThrow('This needs a fresh passkey confirmation.');
    expect(chat.state.yolo).toBe(false);
  });
});

// Last in the file: it sets the legacy `clarify.timeout`, which Hermes reads before `agent.clarify_timeout` and which stays set in the temp home.
describe('how long Hermes waits for the owner', () => {
  test('is the profile\'s clarify timeout, passed on alone, and only to the signed-in owner', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    cookie = await ownerCookie(server.url);
    const limits = (headers?: Record<string, string>) => fetch(`${server!.url}/_caduceus/api/chat/limits`, { headers });
    const configSet = (key: string, value: string) => hermes.cli('config', 'set', key, value);

    expect((await limits()).status).toBe(401);
    // Hermes's default, then the legacy key, which wins over `agent.clarify_timeout` as it does in Hermes.
    expect(await (await limits({ cookie })).json()).toEqual({ clarifyTimeoutS: 3600 });
    await configSet('agent.clarify_timeout', '90');
    expect(await (await limits({ cookie })).json()).toEqual({ clarifyTimeoutS: 90 });
    await configSet('clarify.timeout', '0');
    try {
      expect(await (await limits({ cookie })).json()).toEqual({ clarifyTimeoutS: 0 });
    } finally {
      await configSet('clarify.timeout', '3600');
      await configSet('agent.clarify_timeout', '3600');
    }
  });
});
