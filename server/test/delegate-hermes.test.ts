import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InboxState } from '@caduceus/contracts/inbox';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { openEventStream, type EventStream } from './fixtures/event-stream.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type ScriptedReply, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';

// The composer's Delegate (M8 #06) starts the message as one of Hermes's own background runs (`prompt.background`, what `/background` does): Caduceus keeps no queue.
// What Hermes records of such a run, and what Caduceus then says of it (Working for the agent, Running in Work), is read from Hermes: the run's id is the one the
// chat engine was given when the run started, and the profile is the one the chat talks to.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let cookie: string;
let work: string;
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
const streams: EventStream[] = [];
const replies: ScriptedReply[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  await hermes.cli('profile', 'create', 'coder');
  await llm.connect(hermes, 'coder');
  await hermes.cli('config', 'set', 'tools.tool_search.enabled', 'off');
  await hermes.cli('-p', 'coder', 'config', 'set', 'tools.tool_search.enabled', 'off');
}, 120_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-delegate-')));
});
afterEach(async () => {
  for (const scripted of replies.splice(0)) scripted.resume();
  for (const chat of chats.splice(0)) chat.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  for (const stream of streams.splice(0)) stream.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

/** A chat page of the owner's with the Inbox's stream, which Today, Work and the crew read the agents' runs from. */
async function openDesk(profile: string) {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, inboxPollMs: 25 });
  cookie = await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest, cwd: work, profile });
  chats.push(chat);
  const stream = await openEventStream(server.url, '/_caduceus/api/inbox/stream', cookie);
  streams.push(stream);
  let state: InboxState | undefined;
  const inbox = {
    async until(match: (state: InboxState) => boolean): Promise<InboxState> {
      for (;;) {
        if (state && match(state)) return state;
        const event = await stream.next();
        if (event.event === 'inbox') state = event.data as InboxState;
      }
    },
  };
  return { page, chat, inbox };
}

/** Delegates a message: the composer calls the chat engine's `background`. Resolves once Hermes has the run going and the model is mid-reply. */
async function delegate(chat: Chat, text: string) {
  const held = llm.nextReply({ chunks: ['Done ', 'delegating.'], pauseAfter: 1 });
  replies.push(held);
  await chat.background(text);
  await held.paused;
  const [task] = chat.state.sideTasks.filter((entry) => entry.prompt === text);
  return { task: task!, held };
}

describe('a delegated message', () => {
  test('is a background run Hermes records as running for the agent the chat talks to, and as over once it finishes', async () => {
    const { page, chat } = await openDesk('coder');
    const { task, held } = await delegate(chat, 'Summarise the week');

    const listed = async () => {
      const body = await page.rest('/api/sessions?profile=coder&limit=50');
      return isRecord(body) && Array.isArray(body.sessions) ? body.sessions.filter(isRecord) : [];
    };
    expect(await listed()).toContainEqual(expect.objectContaining({ id: task.id, is_active: true, profile: 'coder', title: expect.stringContaining('Summarise the week') }));

    held.resume();
    await chat.until((state) => state.sideTasks.every((entry) => entry.status !== 'running'));
    expect((await listed()).find((row) => row.id === task.id)?.is_active).toBe(false);
  });

  test('is Working for that agent and a running row in Work while it goes, and finishing it tells the owner', async () => {
    const { chat, inbox } = await openDesk('coder');
    const { task, held } = await delegate(chat, 'Summarise the week');

    const going = await inbox.until((state) => state.running.some((run) => run.storedSessionId === task.id));
    expect(going.running.find((run) => run.storedSessionId === task.id)).toMatchObject({ profile: 'coder', status: 'running', background: true, title: expect.stringContaining('Summarise the week') });
    expect(going.activity.some((event) => event.storedSessionId === task.id)).toBe(false);

    held.resume();
    const over = await inbox.until((state) => !state.running.some((run) => run.storedSessionId === task.id));
    expect(over.activity).toContainEqual(expect.objectContaining({ storedSessionId: task.id, profile: 'coder', title: expect.stringContaining('Summarise the week') }));
  });
});
