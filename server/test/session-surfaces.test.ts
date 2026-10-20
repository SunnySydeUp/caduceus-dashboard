import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat } from '../../web/src/modules/chat/chat-session.ts';
import { generateSummary, summaryRequest } from '../../web/src/modules/chat/handoff-summary.ts';
import { readLineage } from '../../web/src/modules/chat/session-lineage.ts';
import { readAccess } from '../../web/src/modules/chat/session-access.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { DEFAULT_REPLY, startStubLlm, STUB_TITLE, type StubLlm } from './fixtures/stub-llm.ts';
import { appendToSession, seedLineage, seedSession, seedSessions } from './fixtures/seed-session.ts';

// Sessions from other surfaces (M1 #16): the CLI, messaging platforms, cron, webhooks and Kanban workers write to Hermes's store, and Caduceus
// opens them in the same transcript view. Over a real Hermes in a throwaway HERMES_HOME; the other processes are Hermes's own `SessionDB` run
// from a separate process (`fixtures/seed-session.ts`).
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
const pages: TestGatewayConnection[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  await seedSessions(hermes.home, [
    { id: 'cli-running', source: 'cli', title: 'Terminal work in progress' },
    { id: 'cli-finished', source: 'cli', title: 'Finished in the terminal', daysOld: 2, endReason: 'cli_close' },
    { id: 'kanban-worker', source: 'kanban', title: 'A worker’s session', daysOld: 2, endReason: 'completed' },
    { id: 'telegram-quiet', source: 'telegram', title: 'Telegram, quiet for a day', daysOld: 1 },
  ]);
}, 120_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
afterEach(async () => {
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function openPage() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const cookie = await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  return page;
}

describe('which sessions can be continued', () => {
  test('a session the terminal has open and wrote to a moment ago, and a Kanban worker’s, are read-only; a finished one and one quiet for a day are not', async () => {
    const page = await openPage();
    const access = async (storedId: string) => (await readAccess({ rest: page.rest, client: page.connection.client }, { storedId, profile: 'default', now: Date.now() / 1000 })).access;
    expect(await access('cli-running')).toEqual({ mode: 'read-only', reason: 'other-process' });
    expect(await access('kanban-worker')).toEqual({ mode: 'read-only', reason: 'kanban' });
    expect(await access('cli-finished')).toEqual({ mode: 'continue' });
    expect(await access('telegram-quiet')).toEqual({ mode: 'continue' });
    // The source comes with the answer, for the badge.
    expect((await readAccess({ rest: page.rest, client: page.connection.client }, { storedId: 'kanban-worker', profile: 'default', now: Date.now() / 1000 })).source).toBe('kanban');
  });
});

describe('a session another process owns', () => {
  const chats: ReturnType<typeof createChat>[] = [];
  afterEach(() => {
    for (const chat of chats.splice(0)) chat.dispose();
  });

  async function openReadOnly(page: TestGatewayConnection, storedId: string) {
    const chat = createChat(page.connection, { history: page.rest, storedId, readOnly: true });
    chats.push(chat);
    await chat.until((state) => !state.syncing && state.messages.length > 0);
    return chat;
  }

  test('opens read-only: the transcript is read from Hermes, this Hermes hosts no session for it, and nothing can be sent to it', async () => {
    await seedSession(hermes.home, 'owned-elsewhere', [
      { role: 'user', content: 'Deploy the staging build' },
      { role: 'assistant', content: 'Deploying now.' },
    ], { title: 'Owned by the terminal' });
    const page = await openPage();
    const chat = await openReadOnly(page, 'owned-elsewhere');
    expect(chat.state.readOnly).toBe(true);
    expect(chat.state.messages.map((message) => `${message.role}: ${message.text}`)).toEqual(['user: Deploy the staging build', 'assistant: Deploying now.']);
    expect(chat.state.title).toBe('Owned by the terminal');
    const hosted = await page.connection.client.request<{ sessions?: { session_key?: string }[] }>('session.active_list', {});
    expect((hosted.sessions ?? []).map((entry) => entry.session_key)).not.toContain('owned-elsewhere');

    expect(await chat.send('Carry on')).toBe(false);
    expect(chat.state.error).toMatch(/read-only/);
    expect(chat.state.turn).toBeUndefined();
  });

  test('messages the other process writes appear within a few seconds of Hermes announcing the change, message by message, with no streaming', async () => {
    await seedSession(hermes.home, 'followed', [{ role: 'user', content: 'Start the migration' }, { role: 'assistant', content: 'Step 1 done.' }]);
    const page = await openPage();
    const chat = await openReadOnly(page, 'followed');
    // Hermes's change watcher records state.db's modification time on its first pass and reports later changes: a write before that is part of the
    // baseline. So touch the file until it reports one (a bounded poll of an OS-level fact, the watcher's own tick), then write.
    let reported = false;
    const stop = page.connection.client.on('sessions.changed', () => {
      reported = true;
    });
    await vi.waitFor(
      () => {
        if (reported) return;
        const now = new Date();
        fs.utimesSync(path.join(hermes.home, 'state.db'), now, now);
        throw new Error('Hermes has not reported a change yet');
      },
      { timeout: 10_000, interval: 600 },
    );
    stop();

    await appendToSession(hermes.home, 'followed', [{ role: 'assistant', content: 'Step 2 done.' }]);
    await chat.until((state) => state.messages.length === 3);
    expect(chat.state.messages.map((message) => message.text)).toEqual(['Start the migration', 'Step 1 done.', 'Step 2 done.']);
    await appendToSession(hermes.home, 'followed', [{ role: 'user', content: 'Continue' }, { role: 'assistant', content: 'Step 3 done.' }]);
    await chat.until((state) => state.messages.length === 5);
    expect(chat.state.messages.at(-1)?.text).toBe('Step 3 done.');
    expect(chat.state.turn).toBeUndefined();
  }, 40_000);

  test('Branch continues it in a new session with the whole history: the original is untouched, Hermes holds no session for it afterwards, and the branch answers', async () => {
    await seedSession(hermes.home, 'to-branch', [
      { role: 'user', content: 'Plan the release' },
      { role: 'assistant', content: 'Three steps: freeze, test, ship.' },
    ], { title: 'Release plan' });
    const page = await openPage();
    const chat = await openReadOnly(page, 'to-branch');
    const { storedId } = await chat.branch();
    expect(storedId).not.toBe('to-branch');

    const held = async (id: string) => ((await page.rest(`/api/sessions/${id}/messages`)) as { messages: { role: string; content: string }[] }).messages.map((row) => `${row.role}: ${row.content}`);
    expect(await held(storedId)).toEqual(['user: Plan the release', 'assistant: Three steps: freeze, test, ship.']);
    expect(await held('to-branch')).toEqual(['user: Plan the release', 'assistant: Three steps: freeze, test, ship.']);
    const hosted = await page.connection.client.request<{ sessions?: { session_key?: string }[] }>('session.active_list', {});
    expect((hosted.sessions ?? []).map((entry) => entry.session_key)).not.toContain('to-branch');

    // The branch is Caduceus's to continue.
    expect((await readAccess({ rest: page.rest, client: page.connection.client }, { storedId, profile: 'default', now: Date.now() / 1000 })).access).toEqual({ mode: 'continue' });
    const next = createChat(page.connection, { history: page.rest, storedId });
    chats.push(next);
    await next.until((state) => !state.syncing && state.messages.length > 0);
    expect(next.state.readOnly).toBe(false);
    await next.send('And the rollback plan?');
    await next.until((state) => !state.running && state.turn === undefined && state.messages.length === 4);
    expect(next.state.messages.at(-1)?.text).toBe(DEFAULT_REPLY.join(''));
    // The original did not hear of it.
    expect(await held('to-branch')).toHaveLength(2);
  });

  test('a session that can be continued is resumed and answers: it was never read-only', async () => {
    const page = await openPage();
    const chat = createChat(page.connection, { history: page.rest, storedId: 'cli-finished' });
    chats.push(chat);
    await chat.until((state) => !state.syncing && state.messages.length > 0);
    expect(chat.state.readOnly).toBe(false);
    await chat.send('Pick this up again');
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.at(-1)?.text === DEFAULT_REPLY.join(''));
    const hosted = await page.connection.client.request<{ sessions?: { session_key?: string }[] }>('session.active_list', {});
    expect((hosted.sessions ?? []).map((entry) => entry.session_key)).toContain('cli-finished');
  });
});

describe('the segments of a messaging session', () => {
  test('a conversation Hermes carried on in new sessions lists its segments oldest first, from any of them, with the one that is open marked', async () => {
    await seedLineage(hermes.home, ['seg-a', 'seg-b', 'seg-c']);
    const page = await openPage();
    const read = (storedId: string) => readLineage(page.rest, { storedId, profile: 'default' });
    const middle = await read('seg-b');
    expect(middle.segments.map((segment) => [segment.id, segment.title])).toEqual([['seg-a', 'Segment 1'], ['seg-b', 'Segment 2'], ['seg-c', 'Segment 3']]);
    expect(middle.index).toBe(1);
    expect((await read('seg-a')).index).toBe(0);
    expect((await read('seg-c')).index).toBe(2);
    expect((await read('seg-c')).segments).toHaveLength(3);
  });

  test('a session that is nobody’s continuation, or only a branch of another, is one segment', async () => {
    const page = await openPage();
    expect((await readLineage(page.rest, { storedId: 'cli-finished', profile: 'default' })).segments.map((segment) => segment.id)).toEqual(['cli-finished']);
    const chat = createChat(page.connection, { history: page.rest, storedId: 'cli-finished' });
    try {
      await chat.until((state) => !state.syncing && state.messages.length > 0);
      const { storedId } = await chat.branch();
      expect((await readLineage(page.rest, { storedId, profile: 'default' })).segments.map((segment) => segment.id)).toEqual([storedId]);
      expect((await readLineage(page.rest, { storedId: 'cli-finished', profile: 'default' })).segments.map((segment) => segment.id)).toEqual(['cli-finished']);
    } finally {
      chat.dispose();
    }
  });
});

describe('a handoff summary', () => {
  test('is Hermes’s one-shot model’s answer for the chat, generated on request, and it leaves no trace in the session or the list', async () => {
    await seedSession(hermes.home, 'to-hand-off', [{ role: 'user', content: 'Plan the release' }, { role: 'assistant', content: 'Three steps: freeze, test, ship.' }], { title: 'Release handoff' });
    const page = await openPage();
    const chat = createChat(page.connection, { history: page.rest, storedId: 'to-hand-off', readOnly: true });
    try {
      await chat.until((state) => !state.syncing && state.messages.length > 0);
      const sessionsBefore = ((await page.rest('/api/sessions?limit=100')) as { total: number }).total;
      const asked = llm.requests.length;
      const request = summaryRequest(chat.state.messages, { user: 'You', assistant: 'Hermes' });
      const note = await generateSummary(page.connection.client, { profile: 'default', ...request });
      // The stub model answers a request that is not streamed as it answers a title.
      expect(note).toBe(STUB_TITLE);
      expect(llm.requests.length).toBeGreaterThan(asked);
      const held = (await page.rest('/api/sessions/to-hand-off/messages')) as { messages: unknown[] };
      expect(held.messages).toHaveLength(2);
      expect(((await page.rest('/api/sessions?limit=100')) as { total: number }).total).toBe(sessionsBefore);
    } finally {
      chat.dispose();
    }
  });
});
