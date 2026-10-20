import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Learn-a-skill (M4 #05): the chat engine's `learn` over the browser's gateway connection through Caduceus, in front of the real Hermes
// whose provider is the stub LLM. `/learn` is Hermes's own slash command: `command.dispatch` turns the owner's topic into the prompt
// Hermes wants the agent to work from, and the chat sends that as the first turn, so the owner watches it in Chat.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
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
afterEach(async () => {
  for (const chat of chats.splice(0)) chat.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  cookie = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** A chat on a page of the owner's. `passkey` is what the owner does when the page asks for one: confirm it (and show it to the server), or cancel. */
async function openChat(passkey: 'confirm' | 'cancel') {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  cookie ??= await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  const page = openGatewayConnection(url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const asked: number[] = [];
  const chat = createChat(page.connection, {
    history: page.rest,
    stepUp: async () => {
      asked.push(asked.length);
      if (passkey === 'cancel') return false;
      await stepUp(url, cookie!, authenticator);
      return true;
    },
  });
  chats.push(chat);
  return { chat, asked };
}

describe('learn a skill', () => {
  test('runs Hermes\'s /learn through command.dispatch behind a passkey (Tier 2): the prompt Hermes builds from the topic is the first turn of a new chat, and the agent works from it', async () => {
    const { chat, asked } = await openChat('confirm');
    llm.nextReply({ chunks: ['I will read the notes and write the skill.'] });
    const topic = 'the release process in docs/release.md, focus on rollback';

    await chat.learn(topic);
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.length >= 2);

    expect(chat.state.error).toBeUndefined();
    expect(asked).toHaveLength(1);
    // Hermes's /learn prompt, with the owner's topic as its request, is what the model was sent.
    const sent = JSON.stringify(llm.completions.at(-1)!.messages.filter((message) => message.role === 'user').map((message) => message.content));
    expect(sent).toContain('[/learn] The user wants you to learn a reusable skill');
    expect(sent).toContain(topic);
    expect(chat.state.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(chat.state.messages[1].text).toBe('I will read the notes and write the skill.');
    // It is a session in Hermes like any other, so Chat lists it.
    expect(chat.state.storedId).toBeDefined();
  });

  test('without the passkey nothing reaches the model and no turn starts: the owner said no, and the chat says why', async () => {
    const { chat, asked } = await openChat('cancel');
    const before = llm.completions.length;

    await expect(chat.learn('anything')).rejects.toThrow(/passkey/i);

    expect(asked).toHaveLength(1);
    expect(llm.completions.length).toBe(before);
    expect(chat.state.running).toBe(false);
    expect(chat.state.turn).toBeUndefined();
  });
});
