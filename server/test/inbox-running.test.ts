import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InboxState } from '@caduceus/contracts/inbox';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { openEventStream, type EventStream } from './fixtures/event-stream.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type ReplyScript, type ScriptedReply, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';

// The runs in the Inbox's stream (M2 #04): what Hermes is working on now, which Work and the crew read. Caduceus asks Hermes (the observer connection's
// `session.active_list`) and stores nothing. The real Hermes has its provider pointed at the stub LLM, which can hold a turn mid-reply so
// that "a run is going" is a real state of Hermes's.
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
  await hermes.cli('profile', 'create', 'work');
  await llm.connect(hermes, 'work');
  await hermes.cli('config', 'set', 'tools.tool_search.enabled', 'off');
  await hermes.cli('-p', 'work', 'config', 'set', 'tools.tool_search.enabled', 'off');
}, 120_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-running-')));
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

async function openServer() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, inboxPollMs: 25 });
  cookie = await ownerCookie(server.url);
  return server.url;
}

/** A chat page of the owner's in a profile. */
async function openChat(profile?: string) {
  const url = await openServer();
  const page = openGatewayConnection(url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest, cwd: work, ...(profile ? { profile } : {}) });
  chats.push(chat);
  return chat;
}

interface RunsWatch {
  /** The first state of the stream, among those already read and those still to come, that `match` accepts. */
  until(match: (state: InboxState) => boolean): Promise<InboxState>;
}

/** The Inbox's stream as the page reads it: the runs ride on it with the items. */
async function watchRuns(): Promise<RunsWatch> {
  const url = await openServer();
  const stream = await openEventStream(url, '/_caduceus/api/inbox/stream', cookie);
  streams.push(stream);
  let state: InboxState | undefined;
  return {
    async until(match: (state: InboxState) => boolean): Promise<InboxState> {
      for (;;) {
        if (state && match(state)) return state;
        const event = await stream.next();
        if (event.event === 'inbox') state = event.data as InboxState;
      }
    },
  };
}

/** A scripted reply that the end of the test lets go of: a test that fails with its turn held would leave that run going in the shared Hermes, and every test after it would wait for it. */
function reply(script: ReplyScript): ScriptedReply {
  const scripted = llm.nextReply(script);
  replies.push(scripted);
  return scripted;
}

describe('the runs of the stream', () => {
  test('lists the live runs of every profile with their profile, title and when they started, and nothing when none is running', async () => {
    const inDefault = await openChat();
    const inWork = await openChat('work');
    const stream = await watchRuns();
    expect((await stream.until((state) => state.live)).running).toEqual([]);
    const first = reply({ chunks: ['Thinking ', 'about it.'], pauseAfter: 1 });
    const second = reply({ chunks: ['Working ', 'on it.'], pauseAfter: 1 });
    const before = Date.now();

    await inDefault.send('Summarise the report');
    await first.paused;
    await inWork.send('Draft the plan');
    await second.paused;

    const { running } = await stream.until((state) => state.running.length === 2);
    const byProfile = Object.fromEntries(running.map((run) => [run.profile, run]));
    expect(byProfile.default).toMatchObject({ status: 'running', storedSessionId: inDefault.state.storedId });
    expect(byProfile.work).toMatchObject({ status: 'running', storedSessionId: inWork.state.storedId });
    // The run started when its turn did: not before this test sent it, and not in the future.
    for (const run of running) expect(run.since).toBeGreaterThanOrEqual(before - 1000);
    for (const run of running) expect(run.since).toBeLessThanOrEqual(Date.now());

    first.resume();
    second.resume();
    await stream.until((state) => state.running.length === 0);
  }, HERMES_WORK_TIMEOUT_MS);
});

describe('a run that waits for the owner', () => {
  test('is listed as waiting while Hermes holds its approval, and leaves the list when it is answered', async () => {
    const kept = path.join(work, 'kept');
    fs.mkdirSync(kept);
    const chat = await openChat();
    const stream = await watchRuns();
    reply({ chunks: [], toolCalls: [{ id: 'call_rm', name: 'terminal', arguments: { command: `rm -rf ${kept}` } }] });
    reply({ chunks: ['Left it alone.'] });
    await chat.send('Clean up');
    await chat.until((state) => state.requests.length === 1);
    const { running } = await stream.until((state) => state.running.some((run) => run.status === 'waiting'));
    expect(running).toMatchObject([{ status: 'waiting', profile: 'default' }]);

    await chat.answerApproval(chat.state.requests[0]!.id, { choice: 'deny' });
    await stream.until((state) => state.running.length === 0);
  }, HERMES_WORK_TIMEOUT_MS);
});
