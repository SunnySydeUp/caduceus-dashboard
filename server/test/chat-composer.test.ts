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

// The composer's settings (M1 #08): model, reasoning effort, workspace and toolsets, and the context ring. The chat engine over the
// browser's gateway connection through Caduceus (so every call passes the policy proxy), in front of the real Hermes whose provider is
// the stub LLM, which records the model, tools and messages of every completion: "the next turn uses it" is what the model was sent.
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
  await hermes.cli('config', 'set', 'tools.tool_search.enabled', 'off');
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-composer-')));
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
  const chat = createChat(page.connection, { history: page.rest, ...options });
  chats.push(chat);
  return chat;
}

const finished = (messages: number) => (state: { running: boolean; turn: unknown; messages: unknown[] }) => !state.running && state.turn === undefined && state.messages.length >= messages;
/** What the model was sent in its last completion, beyond the messages. */
const lastCompletion = () => llm.completions.at(-1)!;

describe('the model chip', () => {
  test('a model picked on a chat that has a session is used by its next turn, for that session only', async () => {
    const chat = await openChat({ cwd: work });
    await chat.send('First');
    await chat.until(finished(2));
    expect(lastCompletion().model).toBe('stub-model');

    const answer = await chat.setModel({ provider: 'custom', model: 'stub-model-large' });
    expect(answer).toEqual({ kind: 'set' });
    expect(chat.state).toMatchObject({ model: 'stub-model-large', provider: 'custom' });
    await chat.send('Second');
    await chat.until(finished(4));

    expect(lastCompletion().model).toBe('stub-model-large');
  });
});

describe('a chat that has no session yet', () => {
  test('starts with the model, reasoning effort and workspace picked before its first message, and a pick on one chat does not reach the next', async () => {
    const chat = await openChat();
    expect(await chat.setModel({ provider: 'custom', model: 'stub-model-large' })).toEqual({ kind: 'set' });
    await chat.setReasoning('high');
    await chat.setWorkspace(work);
    // Nothing has been created in Hermes for the picks: the chat has no session.
    expect(chat.state.storedId).toBeUndefined();

    llm.nextReply({ chunks: ['Looking.'], toolCalls: [{ id: 'call_pwd', name: 'terminal', arguments: { command: 'pwd' } }] });
    llm.nextReply({ chunks: ['Done.'] });
    await chat.send('Where are you?');
    await chat.until(finished(2));

    const [first, second] = llm.completions.slice(-2);
    expect(first).toMatchObject({ model: 'stub-model-large', reasoning_effort: 'high' });
    expect(chat.state).toMatchObject({ model: 'stub-model-large', reasoning: 'high', cwd: work });
    // The terminal ran where the owner put the chat.
    expect(JSON.stringify(second!.messages.at(-1))).toContain(work);

    const next = await openChat({ cwd: work });
    await next.send('Another chat');
    await next.until(finished(2));
    expect(lastCompletion()).toMatchObject({ model: 'stub-model' });
    expect(lastCompletion().reasoning_effort).not.toBe('high');
  });
});

describe('the reasoning chip and the workspace chip on a chat with a session', () => {
  test('reasoning effort is sent to Hermes for this session and the next turn runs with it', async () => {
    const chat = await openChat({ cwd: work });
    await chat.send('First');
    await chat.until(finished(2));

    await chat.setReasoning('low');
    expect(chat.state.reasoning).toBe('low');
    await chat.send('Second');
    await chat.until(finished(4));

    expect(lastCompletion().reasoning_effort).toBe('low');
  });

  test('the workspace moves with session.cwd.set between turns, the next turn runs there, and Hermes refuses while a turn is running', async () => {
    const chat = await openChat({ cwd: work });
    const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-composer-else-')));
    try {
      // Hermes's default directory is what a chat without a pick works in.
      const fallback = await chat.defaultWorkspace();
      expect(path.isAbsolute(fallback!)).toBe(true);
      await chat.send('First');
      await chat.until(finished(2));
      // Hermes refuses session.cwd.set ("session busy") until it has released the session, which comes after the reply is complete.
      await Promise.all(pages.map((page) => page.settled()));
      await chat.setWorkspace(elsewhere);
      expect(chat.state.cwd).toBe(elsewhere);

      const busy = llm.nextReply({ chunks: ['Looking ', 'around.'], pauseAfter: 1, toolCalls: [{ id: 'call_pwd', name: 'terminal', arguments: { command: 'pwd' } }] });
      llm.nextReply({ chunks: ['Done.'] });
      await chat.send('Where are you?');
      await busy.paused;
      await expect(chat.setWorkspace(work)).rejects.toThrow(/busy/i);
      busy.resume();
      await chat.until(finished(4));
      await Promise.all(pages.map((page) => page.settled()));

      expect(JSON.stringify(lastCompletion().messages.at(-1))).toContain(elsewhere);
      expect(chat.state.cwd).toBe(elsewhere);
      await expect(chat.setWorkspace(path.join(elsewhere, 'missing'))).rejects.toThrow(/does not exist|not a directory|directory/i);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('the toolsets chip', () => {
  test('lists Hermes\'s toolsets, and turning one off reaches the next turn: the model is no longer sent its tools, and the reasoning pick survives the rebuild', async () => {
    const chat = await openChat({ cwd: work });
    await chat.send('First');
    await chat.until(finished(2));
    await chat.setReasoning('low');
    expect(lastCompletion().tools!.map((tool) => tool.function.name)).toContain('todo_list');

    const listed = await chat.toolsets();
    expect(listed.find((set) => set.name === 'todo')).toMatchObject({ enabled: true });
    try {
      const done = await chat.configureToolsets('disable', ['todo']);
      expect(done.changed).toEqual(['todo']);
      await chat.send('Second');
      await chat.until(finished(4));
      expect(lastCompletion().tools!.map((tool) => tool.function.name)).not.toContain('todo_list');
      expect(lastCompletion().reasoning_effort).toBe('low');
      expect((await chat.toolsets()).find((set) => set.name === 'todo')).toMatchObject({ enabled: false });
    } finally {
      await chat.configureToolsets('enable', ['todo']);
    }
  });
});

describe('the toolsets chip on a chat that has no session', () => {
  test('lists the toolsets of the chat\'s profile, and the profile named is the one read', async () => {
    const created = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'coder' }) });
    expect(created.ok).toBe(true);
    const chat = await openChat({ profile: 'coder' });
    const rows = await chat.toolsets();
    expect(rows.find((row) => row.name === 'terminal')).toMatchObject({ enabled: true });
    expect(rows.find((row) => row.name === 'terminal')!.tool_count).toBeGreaterThan(0);
    expect(chat.state.storedId).toBeUndefined();
  });
});

describe('the context ring', () => {
  test('usage follows each turn, the breakdown splits the window, and Compress leaves less in it', async () => {
    const chat = await openChat({ cwd: work });
    const filler = 'A long answer about nothing in particular. '.repeat(120);
    for (let turn = 1; turn <= 8; turn += 1) {
      llm.nextReply({ chunks: [filler], usage: { prompt: 1000 * turn, completion: 50 } });
      await chat.send(`Question ${turn}`);
      await chat.until(finished(turn * 2));
      // The ring shows what Hermes last reported, which can follow the end of the turn by a moment under load: wait for this turn's number (an event), not for the end of the turn alone.
      await chat.until((state) => state.usage?.context_used === 1000 * turn);
      expect(chat.state.usage).toMatchObject({ context_used: 1000 * turn, context_max: 256000 });
    }
    const before = chat.state.usage!.context_used!;

    const breakdown = await chat.contextBreakdown();
    expect(breakdown.categories.map((category) => category.id)).toEqual(expect.arrayContaining(['system_prompt', 'tool_definitions', 'conversation']));
    expect(breakdown).toMatchObject({ context_max: 256000, model: 'stub-model' });
    const messagesBefore = chat.state.messages.length;

    const done = await chat.compress();
    // Hermes took messages out of the conversation, and what the ring shows is the smaller size it says the request has now.
    expect(done.removed).toBeGreaterThan(0);
    expect(done.after_tokens!).toBeLessThan(done.before_tokens!);
    expect(chat.state.usage!.context_used).toBe(done.after_tokens);
    expect(chat.state.usage!.context_max).toBe(256000);
    expect(chat.state.messages.length).toBeLessThan(messagesBefore);
    expect(before).toBe(8000);
  });
});
