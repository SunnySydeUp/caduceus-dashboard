import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket as UpstreamSocket } from 'ws';
import { CADUCEUS_SESSION_SOURCE } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, transcriptOf, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { createSessionList, type SessionList } from '../../web/src/modules/chat/sessions-list.ts';
import { openGatewayConnection, tabStorage, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { graceClock } from './fixtures/grace-clock.ts';
import { HERMES_WORK_TIMEOUT_MS, killHermes, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { DEFAULT_REPLY, startStubLlm, STUB_TITLE, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedSession } from './fixtures/seed-session.ts';

// The Chat module's engine (`web/src/modules/chat/chat-session.ts`: what the page runs behind the screen), over the browser's
// gateway connection through Caduceus, in front of the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME) whose
// provider is the stub LLM. The screen itself is checked in a browser; what the owner sees is the engine's state.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
const pages: TestGatewayConnection[] = [];
const chats: (Chat | SessionList)[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  await hermes.cli('profile', 'create', 'work');
  await llm.connect(hermes, 'work');
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
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** What a transcript says, without Hermes's row ids and what a reply cost (that is `agent-activity.test.ts`'s). */
const words = (state: Parameters<typeof transcriptOf>[0]) => transcriptOf(state).map(({ id: _id, at: _at, stats: _stats, ...message }) => message);

/** The sessions list of a profile, the way the pane makes it. */
const openList = (page: TestGatewayConnection, profile: string) => createSessionList({ connection: page.connection, rest: page.rest, profile, view: { tab: 'chats', failed: false, quiet: false, all: false } });

/** A chat on a page: the engine over the page's connection, reading history through the server. */
const openChat = (page: TestGatewayConnection, options: Parameters<typeof createChat>[1] = {}) => createChat(page.connection, { history: page.rest, ...options });

/** A page of the owner's, connected to Caduceus. A page that is dropped redials after `redialMs` (a test that wants it away for a while makes it long, and redials by hand). */
async function openPage(redialMs?: number, tab?: ReturnType<typeof tabStorage>) {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const cookie = await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie, redialMs === undefined ? {} : { backoff: { baseDelayMs: redialMs, capMs: redialMs } }, tab);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  return { page, url: server.url, cookie };
}

describe('a new chat, in front of the real Hermes', () => {
  test('starts in the tab\'s profile, streams the reply token by token, and shows in that profile\'s list with the title Hermes gave it', async () => {
    const { page } = await openPage();
    const chat = openChat(page, { profile: 'work' });
    chats.push(chat);
    const list = openList(page, 'work');
    chats.push(list);
    const defaultList = openList(page, 'default');
    chats.push(defaultList);

    // Every streamed chunk reaches the transcript, in order, one at a time.
    const seen: string[] = [];
    chat.subscribe(() => {
      const last = transcriptOf(chat.state).at(-1);
      if (last?.role === 'assistant' && last.text !== seen.at(-1)) seen.push(last.text);
    });
    await chat.send('Say hello');
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.length === 2);

    expect(transcriptOf(chat.state).map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'Say hello' },
      { role: 'assistant', text: DEFAULT_REPLY.join('') },
    ]);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((text, index) => index === 0 || text.startsWith(seen[index - 1]))).toBe(true);
    // The session is in the work profile's list under Hermes's title, and not in the default profile's.
    await list.until((state) => state.items.some((item) => item.title === STUB_TITLE));
    expect(list.state.items).toEqual([expect.objectContaining({ id: chat.state.storedId, title: STUB_TITLE, source: CADUCEUS_SESSION_SOURCE })]);
    await defaultList.until((state) => state.loaded);
    expect(defaultList.state.items).toEqual([]);
  });
});

describe('stopping a turn', () => {
  test('Stop interrupts the turn in Hermes, and the partial reply stays and is marked stopped', async () => {
    const { page } = await openPage();
    const chat = openChat(page);
    chats.push(chat);
    const reply = llm.nextReply({ chunks: ['one ', 'two ', 'three ', 'four'], pauseAfter: 2 });

    await chat.send('Count');
    await reply.paused;
    await chat.until((state) => transcriptOf(state).at(-1)?.text === 'one two ');
    await chat.stop();
    // Hermes stopped waiting for the model...
    await reply.hungUp;
    await chat.until((state) => !state.running && state.turn === undefined);

    // ...and the part of the reply that came stays, marked as stopped. Hermes's own transcript holds it too.
    expect(words(chat.state)).toEqual([
      { role: 'user', text: 'Count' },
      { role: 'assistant', text: 'one two', stopped: true },
    ]);
  });
});

describe('resuming a turn', () => {
  test('a page opened mid-turn (a reload) takes up the stream where it is, with no missing or repeated text', async () => {
    const first = await openPage();
    const before = openChat(first.page);
    chats.push(before);
    const reply = llm.nextReply({ chunks: ['one ', 'two ', 'three ', 'four'], pauseAfter: 2 });
    await before.send('Count');
    await reply.paused;
    await before.until((state) => transcriptOf(state).at(-1)?.text === 'one two ');

    // The page goes away mid-turn and a new one opens the chat from its address: it has only the stored id.
    first.page.connection.close();
    const { page } = await openPage();
    const after = openChat(page, { storedId: before.state.storedId });
    chats.push(after);
    await after.until((state) => transcriptOf(state).at(-1)?.text === 'one two ');
    expect(after.state.running).toBe(true);
    expect(words(after.state)).toEqual([
      { role: 'user', text: 'Count' },
      { role: 'assistant', text: 'one two ' },
    ]);

    reply.resume();
    await after.until((state) => !state.running && state.turn === undefined);
    expect(words(after.state)).toEqual([
      { role: 'user', text: 'Count' },
      { role: 'assistant', text: 'one two three four' },
    ]);
  });
});

describe('a connection that drops mid-turn', () => {
  test('catches up from the last event it saw, with no missing or repeated text', async () => {
    const { page } = await openPage(60_000);
    const chat = openChat(page);
    chats.push(chat);
    const reply = llm.nextReply({ chunks: ['one ', 'two ', 'three ', 'four'], pauseAfter: [2, 3] });
    await chat.send('Count');
    await reply.paused;
    await chat.until((state) => transcriptOf(state).at(-1)?.text === 'one two ');

    // The connection drops, and the turn goes on without the page.
    page.connection.client.invalidate('The connection was lost.');
    await page.until((status) => status.state === 'reconnecting');
    reply.resume();
    await reply.reached(3);
    expect(transcriptOf(chat.state).at(-1)?.text).toBe('one two ');

    page.connection.reconnect();
    await page.until((status) => status.state === 'connected');
    await chat.until((state) => transcriptOf(state).at(-1)?.text === 'one two three ');
    reply.resume();
    await chat.until((state) => !state.running && state.turn === undefined);
    expect(transcriptOf(chat.state).at(-1)?.text).toBe('one two three four');
  });

  test('refetches the transcript when the replay was truncated, and shows the reply Hermes holds', async () => {
    const { page } = await openPage(60_000);
    const chat = openChat(page);
    chats.push(chat);
    // Hermes keeps the last 512 events of a session; a reply of this many chunks while the page is away overruns that.
    const chunks = Array.from({ length: 700 }, (_, index) => `w${index} `);
    const reply = llm.nextReply({ chunks, pauseAfter: [2, 650] });
    await chat.send('Count high');
    await reply.paused;
    await chat.until((state) => transcriptOf(state).at(-1)?.text === 'w0 w1 ');

    page.connection.client.invalidate('The connection was lost.');
    await page.until((status) => status.state === 'reconnecting');
    reply.resume();
    await reply.reached(650);
    // Hermes takes the chunks in after the stub has sent them: a second page (another device) says when it has them all.
    const watcher = openChat((await openPage()).page, { storedId: chat.state.storedId });
    chats.push(watcher);
    await watcher.until((state) => transcriptOf(state).at(-1)?.text === chunks.slice(0, 650).join(''));
    page.connection.reconnect();
    await page.until((status) => status.state === 'connected');

    // The replay cannot hold what came while the page was away, so the page shows what Hermes says the reply is so far.
    await chat.until((state) => transcriptOf(state).at(-1)?.text === chunks.slice(0, 650).join(''));
    reply.resume();
    await chat.until((state) => !state.running && state.turn === undefined);
    expect(transcriptOf(chat.state).at(-1)?.text).toBe(chunks.join('').trim());
  }, HERMES_WORK_TIMEOUT_MS);
});

describe('a Hermes that restarted', () => {
  test('the chat comes back from Hermes\'s stored transcript under a new replay epoch, and the next prompt goes on in it', async () => {
    const { page } = await openPage();
    const chat = openChat(page);
    chats.push(chat);
    await chat.send('First');
    await chat.until((state) => !state.running && state.messages.length === 2);

    // Hermes's event numbers and live sessions are gone with the process; its stored sessions are not.
    killHermes(hermes);
    await page.until((status) => status.state === 'reconnecting');
    await page.until((status) => status.state === 'connected');
    expect(page.readies.at(-1)?.restarted).toBe(true);
    await chat.until((state) => !state.syncing);
    expect(chat.state.error).toBeUndefined();

    await chat.send('Second');
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.length === 4);
    expect(transcriptOf(chat.state).map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'First' },
      { role: 'assistant', text: DEFAULT_REPLY.join('') },
      { role: 'user', text: 'Second' },
      { role: 'assistant', text: DEFAULT_REPLY.join('') },
    ]);
  }, HERMES_WORK_TIMEOUT_MS);
});

describe('a session Hermes no longer has live', () => {
  test('a prompt for a closed runtime session attaches to the stored one again and goes through', async () => {
    const { page } = await openPage();
    const chat = openChat(page);
    chats.push(chat);
    await chat.send('First');
    await chat.until((state) => !state.running && state.messages.length === 2);

    // Something else ends the live session (another device's Close, Hermes reaping it); the stored one is untouched.
    const live = await page.connection.client.request<{ sessions: { id: string }[] }>('session.active_list', {});
    await page.connection.client.request('session.close', { session_id: live.sessions[0].id });
    await chat.send('Second');
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.length === 4);

    expect(transcriptOf(chat.state).at(-1)?.text).toBe(DEFAULT_REPLY.join(''));
    expect(chat.state.error).toBeUndefined();
  });
});

describe('catching up', () => {
  /** Timers a test fires by hand: what is waiting, and what was cleared. */
  function fakeTimers() {
    const waiting = new Map<number, { run: () => void; ms: number }>();
    let next = 0;
    return {
      waiting,
      timers: {
        setTimeout: (run: () => void, ms: number) => waiting.set(++next, { run, ms }) && next,
        clearTimeout: (handle: unknown) => waiting.delete(handle as number),
      },
    };
  }

  /** The page's connection, with the answer to `session.resume` held back until the test lets it go. */
  function slowResume(connection: TestGatewayConnection['connection']) {
    const gate = Promise.withResolvers<void>();
    const client = new Proxy(connection.client, {
      get(target, property) {
        if (property === 'request') return (method: string, ...rest: unknown[]) => (method === 'session.resume' ? gate.promise : Promise.resolve()).then(() => (target.request as Function)(method, ...rest));
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return { connection: { client, status: connection.status, onReady: connection.onReady.bind(connection) }, release: gate.resolve };
  }

  test('says "Catching up…" only when it takes longer than 300 ms', async () => {
    const { page } = await openPage();
    const started = openChat(page);
    chats.push(started);
    await started.send('First');
    await started.until((state) => !state.running && state.messages.length === 2);

    const { waiting, timers } = fakeTimers();
    const { connection, release } = slowResume(page.connection);
    const opened = createChat(connection, { history: page.rest, storedId: started.state.storedId, timers });
    chats.push(opened);
    const shown: boolean[] = [];
    opened.subscribe(() => shown.push(opened.state.catchingUp));

    expect(opened.state.syncing).toBe(true);
    expect(opened.state.catchingUp).toBe(false);
    expect([...waiting.values()].map(({ ms }) => ms)).toEqual([300]);
    [...waiting.values()][0].run();
    expect(opened.state.catchingUp).toBe(true);

    release();
    await opened.until((state) => !state.syncing);
    expect(opened.state.catchingUp).toBe(false);
    expect(opened.state.messages).toHaveLength(2);
  });

  test('says nothing when it is quicker than that', async () => {
    const { page } = await openPage();
    const started = openChat(page);
    chats.push(started);
    await started.send('First');
    await started.until((state) => !state.running && state.messages.length === 2);

    const { waiting, timers } = fakeTimers();
    const opened = openChat(page, { storedId: started.state.storedId, timers });
    chats.push(opened);
    const shown: boolean[] = [];
    opened.subscribe(() => shown.push(opened.state.catchingUp));
    await opened.until((state) => !state.syncing && state.messages.length === 2);

    expect(shown).not.toContain(true);
    // The timer for the message was never left running.
    expect(waiting.size).toBe(0);
  });
});

describe('the same session on two devices', () => {
  test('a second device that attaches mid-turn sees the same stream as the first', async () => {
    const phone = await openPage();
    const laptop = await openPage();
    const onPhone = openChat(phone.page);
    chats.push(onPhone);
    const reply = llm.nextReply({ chunks: ['one ', 'two ', 'three ', 'four'], pauseAfter: 2 });
    await onPhone.send('Count');
    await reply.paused;
    await onPhone.until((state) => transcriptOf(state).at(-1)?.text === 'one two ');

    const onLaptop = openChat(laptop.page, { storedId: onPhone.state.storedId });
    chats.push(onLaptop);
    await onLaptop.until((state) => transcriptOf(state).at(-1)?.text === 'one two ');
    reply.resume();
    await Promise.all([phone, laptop].map((_, index) => [onPhone, onLaptop][index].until((state) => !state.running && state.turn === undefined && state.messages.length === 2)));

    for (const chat of [onPhone, onLaptop]) expect(transcriptOf(chat.state).at(-1)?.text).toBe('one two three four');
  });
});

describe('the grace hold, with a turn running in the real Hermes', () => {
  test('a page that drops mid-turn comes back to the same upstream, the turn having run on; after ten minutes away the upstream is closed', async () => {
    // Every upstream Caduceus opens to Hermes, as the sockets themselves: what a test cannot see from the browser's side.
    const upstreams: UpstreamSocket[] = [];
    const backend = new Proxy(hermes.backend, {
      get(target, property) {
        if (property === 'openGateway') {
          return async (...args: Parameters<typeof target.openGateway>) => {
            const socket = await target.openGateway(...args);
            upstreams.push(socket);
            return socket;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const clock = graceClock();
    server = await startCaduceusServer({ backend, hermesRoot: hermes.home, gatewayGrace: { timers: clock.timers } });
    // Caduceus reads Hermes's markers over a gateway socket of its own when it starts; that one is not the page's.
    await fetch(`${server.url}/_caduceus/api/compatibility`, { headers: { cookie: await ownerCookie(server.url) } });
    upstreams.length = 0;
    const { page } = await openPage(60_000);
    const chat = openChat(page);
    chats.push(chat);
    const reply = llm.nextReply({ chunks: ['one ', 'two ', 'three ', 'four'], pauseAfter: [2, 3] });
    await chat.send('Count');
    await reply.paused;
    await chat.until((state) => transcriptOf(state).at(-1)?.text === 'one two ');

    // The phone is locked: its socket is gone, and Caduceus holds the upstream open while the turn goes on in Hermes.
    const holding = clock.nextStart();
    page.connection.client.invalidate('The phone was locked.');
    const timer = await holding;
    reply.resume();
    await reply.reached(3);
    expect(upstreams).toHaveLength(1);
    expect(upstreams[0].readyState).toBe(upstreams[0].OPEN);

    // It is unlocked within the grace: the page's new socket is joined to the same upstream and the chat catches up through it.
    page.connection.reconnect();
    await page.until((status) => status.state === 'connected');
    await chat.until((state) => transcriptOf(state).at(-1)?.text === 'one two three ');
    expect(upstreams).toHaveLength(1);
    expect(timer.cancelled).toBe(true);
    reply.resume();
    await chat.until((state) => !state.running && state.turn === undefined);
    expect(transcriptOf(chat.state).at(-1)?.text).toBe('one two three four');

    // Gone again, and not back for the grace period: Hermes's side closes.
    const closed = Promise.withResolvers<void>();
    upstreams[0].addEventListener('close', () => closed.resolve());
    const holdingAgain = clock.nextStart();
    page.connection.client.invalidate('The phone was locked.');
    (await holdingAgain).fire();
    await closed.promise;
  });
});

describe('a long transcript', () => {
  /** 1,000 turns (2,000 messages): the owner's prompt `Q<n>` and Hermes's answer `A<n>`. */
  const turns = Array.from({ length: 1000 }, (_, n) => [
    { role: 'user' as const, content: `Q${n}` },
    { role: 'assistant' as const, content: `A${n}` },
  ]).flat();
  let rowIds: number[];
  beforeAll(async () => {
    rowIds = await seedSession(hermes.home, 'long-session', turns);
  });

  test('opens on the newest page only; load earlier reads the page before it, and the oldest message is reachable by loading until there is no more', async () => {
    const { page } = await openPage();
    const chat = openChat(page, { storedId: 'long-session' });
    chats.push(chat);
    await chat.until((state) => !state.syncing && state.messages.length > 0);
    expect(chat.state.messages).toHaveLength(100);
    expect(chat.state.messages.at(-1)?.text).toBe('A999');
    expect(chat.state.messages[0]?.text).toBe('Q950');
    expect(chat.state).toMatchObject({ hasOlder: true, hasNewer: false });

    await chat.loadOlder();
    expect(chat.state.messages).toHaveLength(200);
    expect(chat.state.messages[0]?.text).toBe('Q900');
    expect(chat.state.messages.at(-1)?.text).toBe('A999');

    while (chat.state.hasOlder) await chat.loadOlder();
    expect(chat.state.messages).toHaveLength(2000);
    expect(chat.state.messages.map((message) => message.text).slice(0, 3)).toEqual(['Q0', 'A0', 'Q1']);
    expect(new Set(chat.state.messages.map((message) => message.id)).size).toBe(2000);
  });

  test('opened at a message link: loads the page that starts at that prompt through messages-around, focuses it, and reads on in both directions', async () => {
    const { page } = await openPage();
    const prompt = rowIds[1200]!;
    const chat = openChat(page, { storedId: 'long-session', around: prompt });
    chats.push(chat);
    await chat.until((state) => !state.syncing && state.messages.length > 0);
    expect(chat.state.focusId).toBe(prompt);
    expect(chat.state.messages[0]).toMatchObject({ id: prompt, text: 'Q600' });
    expect(chat.state).toMatchObject({ hasOlder: true, hasNewer: true });
    expect(chat.state.messages.length).toBeLessThanOrEqual(120);

    const before = chat.state.messages.length;
    await chat.loadOlder();
    expect(chat.state.messages.length).toBe(before + 100);
    expect(chat.state.messages[0]?.text).toBe('Q550');
    await chat.loadNewer();
    expect(chat.state.messages.at(-1)?.text).toBe('A709');
    expect(chat.state.hasNewer).toBe(true);

    await chat.showLatest();
    expect(chat.state).toMatchObject({ hasNewer: false, focusId: undefined });
    expect(chat.state.messages.at(-1)?.text).toBe('A999');
  });

  test('a link to a message Hermes does not have says so and shows the newest messages', async () => {
    const { page } = await openPage();
    const chat = openChat(page, { storedId: 'long-session', around: 999_999 });
    chats.push(chat);
    await chat.until((state) => !state.syncing && state.messages.length > 0);
    expect(chat.state.error).toMatch(/could not be found/);
    expect(chat.state.focusId).toBeUndefined();
    expect(chat.state.messages.at(-1)?.text).toBe('A999');
  });

  test('a reply that completes while the newest page is shown joins it without dropping the older pages already loaded', async () => {
    const { page } = await openPage();
    const chat = openChat(page, { storedId: 'long-session' });
    chats.push(chat);
    await chat.until((state) => !state.syncing && state.messages.length > 0);
    await chat.loadOlder();
    await chat.send('One more');
    await chat.until((state) => !state.running && state.turn === undefined && state.messages.at(-1)?.role === 'assistant' && state.messages.some((message) => message.text === 'One more'));
    expect(chat.state.messages.length).toBe(202);
    expect(chat.state.messages[0]?.text).toBe('Q900');
  });
});
