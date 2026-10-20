import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { createSessionList, type SessionList } from '../../web/src/modules/chat/sessions-list.ts';
import type { SessionsView } from '../../web/src/modules/chat/sessions-model.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedSessions } from './fixtures/seed-session.ts';
import { sendSessionWrite } from '../src/session-fence.ts';
import { primeSessionWatcher } from './fixtures/session-watcher.ts';

// The sessions list's engine (`web/src/modules/chat/sessions-list.ts`: what the Chat module's list pane runs behind the screen), over the
// browser's connection and REST proxy of a Caduceus server, in front of the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME).
// The screen itself is checked in a browser; what the owner sees is the engine's state.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
const pages: TestGatewayConnection[] = [];
const disposables: { dispose(): void }[] = [];

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
  for (const thing of disposables.splice(0)) thing.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

const CHATS: SessionsView = { tab: 'chats', failed: false, quiet: false, all: false };

/** A page of the owner's, connected to Caduceus. */
async function openPage() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const cookie = await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  return page;
}

/** The list the way the pane makes it. */
async function openList(page: TestGatewayConnection, options: { profile?: string; view?: SessionsView; pageSize?: number } = {}): Promise<SessionList> {
  const list = createSessionList({
    connection: page.connection,
    rest: page.rest,
    profile: options.profile ?? 'default',
    view: options.view ?? CHATS,
    ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
  });
  disposables.push(list);
  await list.until((state) => state.loaded);
  return list;
}

// Written around Caduceus, as another Hermes client would: with the identity Hermes 0.22 wants on a session write.
const patch = (id: string, body: Record<string, unknown>) =>
  sendSessionWrite(hermes.backend, 'PATCH', `/api/sessions/${id}`, new TextEncoder().encode(JSON.stringify(body)), { headers: { 'content-type': 'application/json' } });

describe('a row of the list', () => {
  test('is made from what Hermes says on this load: its title, source, pin, unread marker and failure, and a session Hermes is working on is live until the turn is done', async () => {
    await seedSessions(hermes.home, [
      { id: 'row-cli', title: 'Plan the trip' },
      { id: 'row-telegram', source: 'telegram', title: 'Telegram thread' },
      { id: 'row-crashed', source: 'telegram', title: 'Crashed run', endReason: 'error' },
      { id: 'row-cron', source: 'cron', title: 'Nightly job' },
    ]);
    await patch('row-cli', { pinned: true });
    await patch('row-telegram', { unread: true });

    const page = await openPage();
    const list = await openList(page);

    const byId = Object.fromEntries(list.state.items.map((item) => [item.id, item]));
    expect(Object.keys(byId).sort()).toEqual(['row-cli', 'row-crashed', 'row-telegram']);
    expect(byId['row-cli']).toMatchObject({ title: 'Plan the trip', source: 'cli', pinned: true, unread: false, failed: false, messageCount: 2 });
    expect(byId['row-telegram']).toMatchObject({ source: 'telegram', unread: true, pinned: false, failed: false });
    expect(byId['row-crashed']).toMatchObject({ failed: true, unread: false });
    expect(list.state.live).toEqual({});

    // A turn Hermes is running makes its session live; when the turn is over it is not.
    const held = llm.nextReply({ chunks: ['one ', 'two ', 'three'], pauseAfter: 1 });
    const chat: Chat = createChat(page.connection, { history: page.rest, profile: 'default' });
    disposables.push(chat);
    await chat.send('Think for a while');
    await held.paused;
    await list.until((state) => Object.keys(state.live).length === 1);
    expect(list.state.live).toEqual({ [chat.state.storedId!]: 'running' });
    held.resume();
    await chat.until((state) => !state.running && state.turn === undefined);
    await list.until((state) => Object.keys(state.live).length === 0);
  });

  test('is not kept by Caduceus: nothing of a session reaches its own store', async () => {
    await seedSessions(hermes.home, [{ id: 'stored-nowhere', title: 'A title only Hermes knows' }]);
    const page = await openPage();
    const list = await openList(page);
    expect(list.state.items.some((item) => item.id === 'stored-nowhere')).toBe(true);

    // Every table of Caduceus's store, every column of every row: neither the id nor the title of a session is in it.
    const store = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'), { readOnly: true });
    const tables = (store.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((table) => table.name);
    expect(tables).toEqual(expect.arrayContaining(['owner', 'sessions', 'audit']));
    const everything = JSON.stringify(
      tables.map((table) => store.prepare(`SELECT * FROM "${table}"`).all()),
      (_key, value) => (value instanceof Uint8Array ? '' : value),
    );
    store.close();
    expect(everything).not.toContain('stored-nowhere');
    expect(everything).not.toContain('A title only Hermes knows');
  });
});

const ids = (list: SessionList) => list.state.items.map((item) => item.id);

describe('the filters', () => {
  test('the tabs, the source and failed-only combine over Hermes’s list, and changing them reads the list again', async () => {
    await seedSessions(hermes.home, [
      { id: 'f-chat', source: 'telegram', title: 'Friend chat' },
      { id: 'f-chat-failed', source: 'telegram', title: 'Friend chat that broke', endReason: 'error' },
      { id: 'f-cron', source: 'cron', title: 'Cron run' },
      { id: 'f-cron-failed', source: 'cron', title: 'Cron run that broke', endReason: 'agent_error' },
    ]);
    const page = await openPage();
    const list = await openList(page);
    expect(ids(list)).toEqual(expect.arrayContaining(['f-chat', 'f-chat-failed']));
    expect(ids(list)).not.toContain('f-cron');

    list.setView({ ...CHATS, tab: 'automation' });
    await list.until((state) => state.loaded && state.items.some((item) => item.id === 'f-cron'));
    expect(ids(list)).toEqual(expect.arrayContaining(['f-cron', 'f-cron-failed']));
    expect(ids(list)).not.toContain('f-chat');

    list.setView({ ...CHATS, source: 'telegram', failed: true });
    await list.until((state) => state.loaded && state.items.some((item) => item.id === 'f-chat-failed'));
    expect(ids(list).filter((id) => id.startsWith('f-'))).toEqual(['f-chat-failed']);
    expect(list.state.items.every((item) => item.source === 'telegram' && item.failed)).toBe(true);

    // Failed-only is the screen's own filter: switching it off shows the rows again without Hermes being asked, and the total is Hermes's for the tab and source.
    const before = list.state.total;
    list.setView({ ...CHATS, source: 'telegram' });
    expect(ids(list)).toEqual(expect.arrayContaining(['f-chat', 'f-chat-failed']));
    expect(list.state.total).toBe(before);
  });
});

describe('every profile at once', () => {
  test('shows the sessions of all profiles, each with the profile that owns it, through Hermes’s aggregate endpoint; one profile’s list shows only its own', async () => {
    await seedSessions(path.join(hermes.home, 'profiles', 'work'), [{ id: 'p-work', title: 'Work thing' }]);
    await seedSessions(hermes.home, [{ id: 'p-default', title: 'Default thing' }]);
    const page = await openPage();

    const everyone = await openList(page, { view: { ...CHATS, all: true } });
    const byId = Object.fromEntries(everyone.state.items.map((item) => [item.id, item]));
    expect(byId['p-work']?.profile).toBe('work');
    expect(byId['p-default']?.profile).toBe('default');
    expect(everyone.state.profileTotals).toEqual(expect.objectContaining({ work: 1, default: expect.any(Number) }));
    // The aggregate endpoint carries no session counts of its own strip: the strip is the total and the profiles.
    expect(everyone.state.stats).toBeUndefined();

    const work = await openList(page, { profile: 'work' });
    expect(ids(work)).toEqual(['p-work']);
    expect(work.state.items[0]!.profile).toBe('work');
  });
});

/** A connection whose `sessions.changed` is sent by the test, as Hermes's change watcher would send it; everything else is the page's own. */
function withBroadcast(page: TestGatewayConnection) {
  const handlers = new Set<() => void>();
  const client = {
    request: page.connection.client.request.bind(page.connection.client),
    on: (type: string, handler: () => void) => (type === 'sessions.changed' ? (handlers.add(handler), () => handlers.delete(handler)) : () => undefined),
  };
  return {
    connection: {
      client,
      get status() {
        return page.connection.status;
      },
      onReady: page.connection.onReady.bind(page.connection),
    } as unknown as TestGatewayConnection['connection'],
    broadcast: () => handlers.forEach((handler) => handler()),
  };
}

describe('a long list', () => {
  test('is read a page at a time from Hermes: 2,000 sessions cost one page until the owner goes on, and a change Hermes announces reads what was loaded again', async () => {
    await hermes.cli('profile', 'create', 'big');
    await seedSessions(
      path.join(hermes.home, 'profiles', 'big'),
      Array.from({ length: 2000 }, (_, n) => ({ id: `big-${String(n).padStart(4, '0')}`, title: `Session ${n}` })),
    );
    const page = await openPage();
    const reads: string[] = [];
    const counted = { ...page, rest: (path: string) => (reads.push(path), page.rest(path)) } as TestGatewayConnection;
    const { connection, broadcast } = withBroadcast(page);
    const list = createSessionList({ connection, rest: counted.rest, profile: 'big', view: CHATS });
    disposables.push(list);
    await list.until((state) => state.loaded);

    expect(list.state.items).toHaveLength(100);
    expect(list.state.total).toBe(2000);
    expect(list.state.hasMore).toBe(true);
    expect(reads.filter((path) => path.startsWith('/api/sessions?'))).toHaveLength(1);
    // Newest first: the last session seeded is the first row.
    expect(list.state.items[0]!.id).toBe('big-1999');

    for (let loaded = 100; loaded < 2000; loaded += 100) await list.loadMore();
    expect(list.state.items).toHaveLength(2000);
    expect(new Set(ids(list)).size).toBe(2000);
    expect(list.state.hasMore).toBe(false);
    await list.loadMore();
    expect(reads.filter((path) => path.startsWith('/api/sessions?'))).toHaveLength(20);

    // Hermes says the sessions changed: as many sessions as were loaded are read again, and a session made meanwhile is the first row. The oldest is
    // pushed onto the page that has not been read, which is one more page away.
    await seedSessions(path.join(hermes.home, 'profiles', 'big'), [{ id: 'big-new', title: 'Made meanwhile' }]);
    broadcast();
    await list.until((state) => state.items[0]?.id === 'big-new' && !state.refreshing);
    expect(list.state.items).toHaveLength(2000);
    expect(list.state.total).toBe(2001);
    expect(list.state.hasMore).toBe(true);
    await list.loadMore();
    expect(list.state.items).toHaveLength(2001);
    expect(new Set(ids(list)).size).toBe(2001);
  }, 120_000);

  test('keeps reading while the filters of the screen leave too little to show', async () => {
    await hermes.cli('profile', 'create', 'noisy');
    await seedSessions(path.join(hermes.home, 'profiles', 'noisy'), [
      { id: 'noisy-failed-old', title: 'The one that broke', endReason: 'error' },
      ...Array.from({ length: 250 }, (_, n) => ({ id: `noisy-${String(n).padStart(3, '0')}`, title: `Fine ${n}` })),
    ]);
    const page = await openPage();
    const list = await openList(page, { profile: 'noisy', view: { ...CHATS, failed: true } });
    // The only failed session is the oldest: it is past the first two pages, and the list went and got it.
    await list.until((state) => state.items.length === 1);
    expect(ids(list)).toEqual(['noisy-failed-old']);
    expect(list.state.total).toBe(251);
  }, 60_000);
});

describe('the list follows Hermes', () => {
  test('a session another tool writes to Hermes’s store appears when Hermes announces the change, with the rows already shown still there', async () => {
    const page = await openPage();
    const list = await openList(page);
    const shown = ids(list);

    // Hermes's change watcher takes what exists at its first pass as its baseline, so it is made to report once before the session is written.
    await primeSessionWatcher(hermes.home, page.connection.client);

    await seedSessions(hermes.home, [{ id: 'written-elsewhere', source: 'telegram', title: 'Written by the messaging gateway' }]);
    await list.until((state) => state.items.some((item) => item.id === 'written-elsewhere'));
    expect(list.state.items[0]!.id).toBe('written-elsewhere');
    expect(ids(list).slice(1)).toEqual(shown);
  }, 40_000);

  test('the stats strip is Hermes’s counts by source and the week’s tokens', async () => {
    await seedSessions(hermes.home, [{ id: 'stats-a', source: 'discord', exchanges: 3 }]);
    const page = await openPage();
    const list = await openList(page);
    await list.until((state) => state.stats !== undefined);
    const stats = list.state.stats!;
    expect(stats.bySource['discord']).toBeGreaterThanOrEqual(1);
    expect(stats.sessions).toBeGreaterThanOrEqual(1);
    expect(stats.messages).toBeGreaterThanOrEqual(6);
    expect(stats.tokens).toEqual(expect.any(Number));
  });

  test('marking a session read clears its marker in the list, and the list says nothing of Hermes’s read state until Hermes does', async () => {
    await seedSessions(hermes.home, [{ id: 'unread-one', title: 'Has news' }]);
    await patch('unread-one', { unread: true });
    const page = await openPage();
    const list = await openList(page);
    expect(list.state.items.find((item) => item.id === 'unread-one')?.unread).toBe(true);
    list.markRead('unread-one');
    expect(list.state.items.find((item) => item.id === 'unread-one')?.unread).toBe(false);
  });
});
