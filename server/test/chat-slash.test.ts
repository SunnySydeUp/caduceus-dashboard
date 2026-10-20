import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { DENIED_MESSAGES } from '@caduceus/contracts/policy/tiers';

// Slash commands in the composer (M1 #09): the chat engine over the browser's gateway connection through Caduceus (so every call passes the
// policy proxy), in front of the real Hermes whose provider is the stub LLM. The commands are Hermes's own: what a test asserts is what
// Hermes did (its title, its transcript, the personality it keeps in its config, the marker a shell command would have left).
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let cookie: string | undefined;
let work: string;
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
const configSet = (key: string, value: string) => hermes.cli('config', 'set', key, value);
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  await configSet('tools.tool_search.enabled', 'off');
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-slash-')));
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

const finished = (messages: number) => (state: { running: boolean; turn: unknown; messages: unknown[] }) => !state.running && state.turn === undefined && state.messages.length >= messages;
const textsOf = (chat: Chat) => chat.state.messages.map((message) => `${message.role}: ${message.text}`);

describe('/title', () => {
  test('renames the session in Hermes and says so in the transcript', async () => {
    const { chat } = await openChat();
    await chat.send('Hello');
    await chat.until(finished(2));
    // Hermes names a chat after its first exchange; the owner's title comes after that, or it would be replaced.
    await chat.until((state) => state.title !== undefined);

    expect(await chat.runSlash('/title Pirate plans')).toEqual({ kind: 'noted' });
    await chat.until((state) => state.title === 'Pirate plans');
    expect(chat.state.notes.at(-1)).toMatchObject({ command: '/title', tone: 'info', text: expect.stringContaining('Pirate plans') });

    const stored = (await hermes.backend.fetch(`/api/sessions/${chat.state.storedId}`).then((res) => res.json())) as { title?: string };
    expect(stored.title).toBe('Pirate plans');
  });
});

describe('/retry', () => {
  test('sends the last message again, in place of the reply it got', async () => {
    const { chat, page } = await openChat();
    llm.nextReply({ chunks: ['First answer'] });
    await chat.send('Question one');
    await chat.until(finished(2));
    // Hermes refuses /retry ("session busy") until it has released the session, which comes after the reply is complete.
    await page.settled();
    const completions = llm.completions.length;

    llm.nextReply({ chunks: ['Second answer'] });
    expect(await chat.runSlash('/retry')).toEqual({ kind: 'sent' });
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.at(-1)?.text === 'Second answer');

    expect(textsOf(chat)).toEqual(['user: Question one', 'assistant: Second answer']);
    expect(llm.completions).toHaveLength(completions + 1);
    expect(llm.completions.at(-1)!.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['Question one']);
  });
});

describe('/undo', () => {
  test('takes the last exchange out of Hermes’s history and hands back the message to edit', async () => {
    const { chat, page } = await openChat();
    llm.nextReply({ chunks: ['Answer one'] });
    await chat.send('Question one');
    await chat.until(finished(2));
    llm.nextReply({ chunks: ['Answer two'] });
    await chat.send('Question two');
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.at(-1)?.text === 'Answer two');
    // Hermes refuses /undo ("session busy") until it has released the session, which comes after the reply is complete.
    await page.settled();

    expect(await chat.runSlash('/undo')).toEqual({ kind: 'prefill', text: 'Question two' });
    expect(textsOf(chat)).toEqual(['user: Question one', 'assistant: Answer one']);
    expect(chat.state.notes.at(-1)).toMatchObject({ command: '/undo', tone: 'info', text: expect.stringContaining('Undid 1 turn') });

    // Hermes holds the shorter history: it is what a reload shows.
    const stored = (await hermes.backend.fetch(`/api/sessions/${chat.state.storedId}/messages`).then((res) => res.json())) as { messages?: { role: string; content: string }[] };
    expect((stored.messages ?? []).filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['Question one']);
  });
});

describe('/personality', () => {
  test('switches the personality Hermes keeps, and its argument list is Hermes’s', async () => {
    await configSet('personalities.pirate', 'You are a pirate. Say arr.');
    const { chat } = await openChat();
    llm.nextReply({ chunks: ['Ahoy'] });
    await chat.send('Hello');
    await chat.until(finished(2));

    const offered = await chat.completeSlash('/personality ');
    expect(offered.map((item) => item.text)).toContain('pirate');

    expect(await chat.runSlash('/personality pirate')).toEqual({ kind: 'noted' });
    expect(chat.state.notes.at(-1)).toMatchObject({ command: '/personality', tone: 'info' });
    expect(chat.state.notes.at(-1)!.text).toMatch(/pirate/i);

    // The next turn is made under it: the model is sent the personality's prompt.
    llm.nextReply({ chunks: ['Arr'] });
    await chat.send('Again');
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.at(-1)?.text === 'Arr');
    expect(JSON.stringify(llm.completions.at(-1)!.messages)).toContain('You are a pirate. Say arr.');
  });
});

describe('commands the policy denies', () => {
  test('an exec-type quick command never reaches Hermes, and a command that administers Hermes is refused with its reason', async () => {
    const marker = path.join(work, 'ran');
    await configSet('quick_commands.shout.type', 'exec');
    await configSet('quick_commands.shout.command', `touch ${marker}`);
    const { chat } = await openChat();

    expect(await chat.runSlash('/shout')).toEqual({ kind: 'failed' });
    expect(chat.state.notes.at(-1)).toMatchObject({ command: '/shout', tone: 'danger', text: DENIED_MESSAGES['exec-quick-command'] });
    expect(await chat.runSlash('/update')).toEqual({ kind: 'failed' });
    expect(chat.state.notes.at(-1)).toMatchObject({ command: '/update', tone: 'danger', text: DENIED_MESSAGES['slash-admin'] });

    // The same command through the worker route is refused too, and what a shell command would have left is not there.
    expect(await chat.runSlash('/Shout now')).toEqual({ kind: 'failed' });
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('an alias quick command runs the command it stands for', async () => {
    await configSet('quick_commands.retitle.type', 'alias');
    await configSet('quick_commands.retitle.target', '/title');
    const { chat } = await openChat();
    await chat.send('Hello');
    await chat.until(finished(2));
    await chat.until((state) => state.title !== undefined);

    expect(await chat.runSlash('/retitle Through an alias')).toEqual({ kind: 'noted' });
    const stored = (await hermes.backend.fetch(`/api/sessions/${chat.state.storedId}`).then((res) => res.json())) as { title?: string };
    expect(stored.title).toBe('Through an alias');
  });
});


describe('path references', () => {
  test('list the session’s workspace through Hermes’s file listing, without what Hermes hides, and never what Caduceus protects', async () => {
    fs.mkdirSync(path.join(work, 'src'));
    fs.writeFileSync(path.join(work, 'README.md'), '# Work\n');
    fs.writeFileSync(path.join(work, '.env'), 'SECRET=1\n');
    fs.mkdirSync(path.join(work, 'node_modules'));
    const { chat } = await openChat();

    expect((await chat.listFolder(work)).map((entry) => [entry.name, entry.isDirectory])).toEqual([
      ['src', true],
      ['README.md', false],
    ]);
    // Caduceus's own directory is protected for reads too: the proxy refuses before Hermes is asked.
    await expect(chat.listFolder(path.join(hermes.home, 'caduceus'))).rejects.toThrow(/403/);
    await expect(chat.listFolder(path.join(work, '.env'))).rejects.toThrow(/403/);
  });
});

describe('a command run in a new chat', () => {
  test('keeps its answer when the chat is opened again as the session it became, and the owner can dismiss it', async () => {
    const { chat, page } = await openChat();
    expect(await chat.runSlash('/usage')).toEqual({ kind: 'noted' });
    const [note] = chat.state.notes;
    expect(note).toMatchObject({ command: '/usage', tone: 'info' });

    // `/chat/new` becomes `/chat/:id` once there is a session, and opens the chat afresh: a new engine.
    const reopened = createChat(page.connection, { history: page.rest, cwd: work, storedId: chat.state.storedId! });
    chats.push(reopened);
    expect(reopened.state.notes).toEqual([note]);
    // Hermes holds no messages of a session that only ran a command (its messages endpoint says 404): that is an empty chat, not an error.
    await reopened.until((state) => state.syncing || state.error !== undefined);
    await reopened.until((state) => !state.syncing);
    expect(reopened.state).toMatchObject({ error: undefined, messages: [] });

    reopened.dismissNote(note!.id);
    expect(reopened.state.notes).toEqual([]);
    expect(chat.state.notes).toEqual([]);
  });
});

describe('the catalogue', () => {
  test('is Hermes’s own: its commands with the groups and descriptions, and the quick commands of the profile', async () => {
    await configSet('quick_commands.fresh.type', 'alias');
    await configSet('quick_commands.fresh.target', '/new');
    const { chat } = await openChat();
    const catalog = await chat.commandCatalog();
    const pairs = new Map(catalog.pairs as [string, string][]);
    expect(pairs.get('/personality')).toBe('Set a predefined personality (usage: /personality [name])');
    expect(pairs.get('/fresh')).toBe('alias → /new');
    expect(catalog.categories!.map((category) => category.name)).toContain('User commands');
    // Read once for a chat that has no session; the same answer is handed out until the chat has one.
    expect(chat.commandCatalog()).toBe(chat.commandCatalog());
  });
});
