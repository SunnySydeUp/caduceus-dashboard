import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { BOARD_STATUSES, parseBoard } from '../../web/src/modules/work/board-model.ts';
import { createLiveBoard, type LiveBoard, type LiveBoardState } from '../../web/src/modules/work/board-live.ts';
import { browserWebSocket } from './fixtures/browser-socket.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Work › Board's data, in front of the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME): the board the page
// reads through Caduceus is the board Hermes has, and Caduceus keeps none of it.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  const cookie = await ownerCookie(server.url);
  const read = async (route: string) => (await fetch(`${server!.url}${route}`, { headers: { cookie } })).json();
  return { url: server.url, cookie, read };
}

/** A task made in Hermes itself, the way the CLI or a worker would make one, moved to `status` the way Hermes moves tasks. */
async function seed(title: string, status: string, fields: Record<string, unknown> = {}): Promise<string> {
  const json = { 'content-type': 'application/json' };
  const created = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: json, body: JSON.stringify({ title, triage: status === 'triage', ...fields }) });
  expect(created.status).toBe(200);
  const { task }: { task: { id: string; status: string } } = await created.json();
  if (task.status !== status && status !== 'triage') {
    const moved = await hermes.backend.fetch(`/api/plugins/kanban/tasks/${task.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ status, result: 'Finished.', summary: 'Finished.' }) });
    expect(moved.status, `moving ${title} to ${status}: ${await moved.clone().text()}`).toBe(200);
  }
  return task.id;
}

describe('Board data, through Caduceus', () => {
  test('every non-archived task is in its Hermes status column, and the counts are the ones Hermes keeps', async () => {
    const { read } = await start();
    await seed('Sketch the idea', 'triage');
    const build = await seed('Fix the build', 'ready', { assignee: 'coder' });
    // A task waits as `todo` while a task it depends on is not done.
    await seed('Plan the release', 'todo', { parents: [build] });
    await seed('Write the changelog', 'ready', { assignee: 'writer', priority: 3 });
    await seed('Waiting on a key', 'blocked');
    await seed('Ship it', 'done');
    const archived = await seed('Old news', 'ready');
    await hermes.backend.fetch(`/api/plugins/kanban/tasks/${archived}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) });

    const board = parseBoard(await read('/api/plugins/kanban/board'));
    // Hermes's own count of its tasks per status: a second source for the same fact.
    const stats: { by_status: Record<string, number> } = await read('/api/plugins/kanban/stats');

    expect(board.columns.map((column) => column.status)).toEqual([...BOARD_STATUSES]);
    for (const column of board.columns) expect(column.tasks.length, column.status).toBe(stats.by_status[column.status] ?? 0);
    expect(board.columns.find((column) => column.status === 'ready')?.tasks.map((task) => task.title).sort()).toEqual(['Fix the build', 'Write the changelog']);
    expect(board.tasks.map((task) => task.title)).not.toContain('Old news');
    expect(board.tasks.find((task) => task.title === 'Write the changelog')).toMatchObject({ assignee: 'writer', priority: 3, status: 'ready' });
    expect(board.assignees).toEqual(expect.arrayContaining(['coder', 'writer']));
  });

  test('Caduceus keeps nothing of Kanban: its database has no Kanban tables, and holds no task', async () => {
    const { read } = await start();
    await seed('Only in Hermes', 'ready');
    parseBoard(await read('/api/plugins/kanban/board'));

    const db = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'), { readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name));
      // The store is there and has its own tables, so an empty answer below is a fact about Kanban and not a missed file.
      expect(tables).toEqual(expect.arrayContaining(['owner', 'sessions', 'audit']));
      expect(tables.filter((name) => /kanban|task|board|lane/i.test(name))).toEqual([]);
      for (const name of tables) {
        const rows = db.prepare(`SELECT * FROM "${name}"`).all();
        expect(JSON.stringify(rows), name).not.toContain('Only in Hermes');
      }
    } finally {
      db.close();
    }
  });
});

// ---- Live: the web app's board engine (`web/src/modules/work/board-live.ts`) run against a Caduceus server ----

/** The engine a page runs, wired the way the page wires it: the board over REST, the events over a WebSocket with the owner's cookie. */
function openLiveBoard(serverUrl: string, cookie: string, options: { gate?: () => Promise<void>; onSocket?: (socket: WebSocket) => void; onFetched?: () => void } = {}) {
  const engine = createLiveBoard({
    fetchBoard: async () => {
      const response = await fetch(`${serverUrl}/api/plugins/kanban/board`, { headers: { cookie } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const board: unknown = await response.json();
      options.onFetched?.();
      return board;
    },
    openEvents: async (since) => {
      await options.gate?.();
      const socket = browserWebSocket(serverUrl, { cookie, path: `/api/plugins/kanban/events?since=${since}` });
      options.onSocket?.(socket);
      return socket;
    },
    backoff: { baseDelayMs: 5, capMs: 50 },
  });
  /** Resolves with the first state, already reached or still to come, that `match` accepts. */
  const until = (match: (state: LiveBoardState) => boolean): Promise<LiveBoardState> => {
    if (match(engine.state)) return Promise.resolve(engine.state);
    const { promise, resolve } = Promise.withResolvers<LiveBoardState>();
    const stop = engine.subscribe(() => {
      if (!match(engine.state)) return;
      stop();
      resolve(engine.state);
    });
    return promise;
  };
  return { engine, until };
}

const titles = (state: LiveBoardState, status?: string) => (state.board?.tasks ?? []).filter((task) => status === undefined || task.status === status).map((task) => task.title).sort();

describe('The live board, through Caduceus', () => {
  const engines: LiveBoard[] = [];
  afterEach(() => {
    for (const engine of engines.splice(0)) engine.close();
  });
  const open = (serverUrl: string, cookie: string, options?: Parameters<typeof openLiveBoard>[2]) => {
    const live = openLiveBoard(serverUrl, cookie, options);
    engines.push(live.engine);
    return live;
  };

  test('shows the board, then a created task, a moved task and a deleted task appear without a reload', async () => {
    const { url, cookie } = await start();
    await stepUp(url, cookie, await addPasskey(url, cookie));
    const first = await seed('Already there', 'ready');
    const { engine, until } = open(url, cookie);

    await until((state) => state.phase === 'ready' && state.live);
    expect(titles(engine.state, 'ready')).toContain('Already there');

    await seed('Arrives live', 'ready');
    await until((state) => titles(state, 'ready').includes('Arrives live'));

    await hermes.backend.fetch(`/api/plugins/kanban/tasks/${first}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'blocked' }) });
    const moved = await until((state) => titles(state, 'blocked').includes('Already there'));
    expect(titles(moved, 'ready')).not.toContain('Already there');

    // Hermes records no event for a delete; the page is told because the delete went through Caduceus.
    const deleted = await fetch(`${url}/api/plugins/kanban/tasks/${first}`, { method: 'DELETE', headers: { cookie, origin: url } });
    expect(deleted.status).toBe(200);
    await until((state) => !titles(state).includes('Already there'));
  });

  test('after a dropped socket the board loads again, and shows no card that went while it was away', async () => {
    const { url, cookie } = await start();
    const stale = await seed('Gone while away', 'ready');
    let reopen: (() => void) | undefined;
    let gated = Promise.resolve();
    const sockets: WebSocket[] = [];
    const fetched: (() => void)[] = [];
    const { engine, until } = open(url, cookie, { gate: () => gated, onSocket: (socket) => sockets.push(socket), onFetched: () => fetched.shift()?.() });
    await until((state) => state.phase === 'ready' && state.live);
    expect(titles(engine.state)).toContain('Gone while away');

    // The connection drops and stays down. The page loads the board once more, and then Hermes loses a task: it records
    // no event for that, so only a load after the socket is back can show it.
    gated = new Promise<void>((resolve) => (reopen = resolve));
    const reloaded = new Promise<void>((resolve) => fetched.push(resolve));
    sockets[0].close();
    await until((state) => !state.live);
    await reloaded;
    const gone = await hermes.backend.fetch(`/api/plugins/kanban/tasks/${stale}`, { method: 'DELETE' });
    expect(gone.status).toBe(200);
    expect(titles(engine.state)).toContain('Gone while away');

    reopen!();
    const back = await until((state) => state.live && !titles(state).includes('Gone while away'));
    expect(titles(back)).not.toContain('Gone while away');
    expect(sockets).toHaveLength(2);
  });

  test('a board Hermes cannot give is a failure the page can show, and it recovers when Hermes answers', async () => {
    const { url, cookie } = await start();
    let failing = true;
    const engine = createLiveBoard({
      fetchBoard: async () => {
        if (failing) throw new Error('HTTP 500');
        return (await fetch(`${url}/api/plugins/kanban/board`, { headers: { cookie } })).json();
      },
      openEvents: async (since) => browserWebSocket(url, { cookie, path: `/api/plugins/kanban/events?since=${since}` }),
      backoff: { baseDelayMs: 5, capMs: 50 },
    });
    engines.push(engine);
    const failed = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<void>();
    engine.subscribe(() => {
      if (engine.state.phase === 'failed') failed.resolve();
      if (engine.state.phase === 'ready') ready.resolve();
    });
    await failed.promise;
    expect(engine.state).toMatchObject({ phase: 'failed', error: 'HTTP 500' });
    expect(engine.state.board).toBeUndefined();

    failing = false;
    await ready.promise;
    expect(engine.state.error).toBeUndefined();
  });
});
