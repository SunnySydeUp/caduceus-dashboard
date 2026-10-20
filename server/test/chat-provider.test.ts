import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, transcriptOf, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';

// What a chat shows about the agent Hermes builds for it, in front of the real Hermes: a Hermes with a provider (the stub LLM)
// and one without. Each test has its own Hermes home, so that one has no provider whatever the other is given.
let hermes: TestHermes;
let llm: StubLlm | undefined;
let server: CaduceusServer | undefined;
let page: TestGatewayConnection | undefined;
const chats: Chat[] = [];
beforeEach(async () => {
  // Starting Hermes is a process start, which takes as long as the machine makes it: it has the time of a hook, not of the test.
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterEach(async () => {
  for (const chat of chats.splice(0)) chat.dispose();
  page?.connection.close();
  page = undefined;
  await server?.close();
  server = undefined;
  await llm?.close();
  llm = undefined;
  await hermes.stop();
});

async function openChat(withProvider: boolean) {
  if (withProvider) {
    llm = await startStubLlm();
    await llm.connect(hermes);
  }
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  page = openGatewayConnection(server.url, await ownerCookie(server.url));
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest });
  chats.push(chat);
  return chat;
}

describe('the agent of a chat, in front of the real Hermes', () => {
  test('its tools are read once the agent is built: the session gets Hermes\'s normal tools and none of the Desktop bridges', async () => {
    const chat = await openChat(true);
    await chat.start();

    // Asked at once, Hermes has no agent yet and lists every tool there is, the Desktop-only bridges included (architecture §3).
    const shown = await chat.tools();
    const names = shown.sections.flatMap((section) => section.tools.map((tool) => tool.name));
    expect(names).toEqual(expect.arrayContaining(['read_file', 'terminal', 'memory']));
    expect(names).not.toContain('desktop_preview');
    expect(shown.sections.map((section) => section.name)).not.toContain('desktop_ui');
  });

  test('a build that fails for want of a provider shows Hermes\'s own message in the chat, and so does the prompt that cannot be answered', async () => {
    const chat = await openChat(false);
    await chat.start();

    await expect(chat.tools()).rejects.toThrow(/not connected to any AI provider/);
    expect(chat.state.error).toMatch(/not connected to any AI provider/);

    await chat.send('Hello?');
    await chat.until((state) => state.turn?.status === 'failed');
    expect(chat.state.running).toBe(false);
    // The banner is not asserted here: Hermes announces a failed build again only when the prompt makes it try again, which depends on how far the first attempt has got.
    // The prompt the owner wrote stays on screen, and the reply is a failed-turn bubble that says what Hermes said (M1 #12).
    expect(transcriptOf(chat.state).map(({ role, text, failed }) => ({ role, text, failed: failed?.error }))).toEqual([
      { role: 'user', text: 'Hello?', failed: undefined },
      { role: 'assistant', text: '', failed: expect.stringMatching(/not connected to any AI provider/) },
    ]);
  });
});
