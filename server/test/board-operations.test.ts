import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { MOVES, boardRequests, boardSlugProblem, bulkRequest, cardChangeRequest, dispatchRequest, downloadPath, importSlugFor, moveTargets, readBoards, readBulk, readExport, readDispatch, readSettings, readSide, settingsRequest, undoOf, type CardChange } from '../../web/src/modules/work/board-ops.ts';
import { requests } from '../../web/src/modules/work/task-requests.ts';
import { parseBoard, type BoardTask } from '../../web/src/modules/work/board-model.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Work › Board's operations (M3 #02) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The requests
// are the web app's own (`board-ops.ts`), so what is sent here is what the page sends. No test lets the dispatcher start a worker: a
// task is only ever ready with no profile (or a profile that does not exist), which the dispatcher does not spawn.
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

interface Answer<T = any> {
  status: number;
  body: T;
}

interface Request {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/** The `hermes kanban` CLI of the temp home: how a worker (or the owner at a terminal) changes Hermes, outside Caduceus. */
const kanban = (...args: string[]) => execFileSync('hermes', ['kanban', ...args], { env: { ...process.env, HERMES_HOME: hermes.home, HOME: hermes.fakeHome }, encoding: 'utf8' });

async function start({ steppedUp = false }: { steppedUp?: boolean } = {}) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  const call = async <T = any>(method: string, route: string, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Answer<T>> => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as T };
  };
  /** Sends a request as the page does; a T3 carries the typed confirmation of `typed`, bound to the request as the dialog binds it. */
  const send = async <T = any>(request: Request, typed?: string): Promise<Answer<T>> => {
    let token: string | undefined;
    if (typed !== undefined) {
      const bodySha256 = request.body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex');
      const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation: `${request.method} ${request.path}`, target: typed, typed, ...(bodySha256 ? { bodySha256 } : {}) } });
      token = minted.body.token;
    }
    return call<T>(request.method, request.path, { body: request.body, headers: token ? { 'x-caduceus-confirmation': token } : undefined });
  };
  const board = async (slug?: string) => parseBoard((await call(`GET`, `/api/plugins/kanban/board${slug ? `?board=${slug}` : ''}`)).body);
  const task = async (id: string, slug?: string): Promise<BoardTask> => {
    const found = (await board(slug)).tasks.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`${id} is not on the board`);
    return found;
  };
  /** A plain GET, answered raw (a download is bytes). */
  const raw = (route: string) => fetch(`${url}${route}`, { headers: { cookie } });
  return { url, cookie, call, send, raw, board, task };
}

/** A task made in Hermes itself, the way the CLI would make one. */
async function seed(title: string, fields: Record<string, unknown> = {}, board?: string): Promise<string> {
  const created = await hermes.backend.fetch(`/api/plugins/kanban/tasks${board ? `?board=${board}` : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, ...fields }) });
  expect(created.status).toBe(200);
  return ((await created.json()) as { task: { id: string } }).task.id;
}

describe('single-card changes', () => {
  test('move, assign and priority are T0 (no confirmation), each lands in Hermes, and the change that undoes it puts the previous value back', async () => {
    const { send, task } = await start();
    const id = await seed('Tidy the docs', { assignee: 'writer', priority: 2 });
    const before = await task(id);

    const changes: CardChange[] = [
      { kind: 'move', to: 'blocked' },
      { kind: 'assign', to: 'coder' },
      { kind: 'priority', to: -1 },
    ];
    for (const change of changes) {
      expect((await send(cardChangeRequest(id, change))).status, JSON.stringify(change)).toBe(200);
    }
    expect(await task(id)).toMatchObject({ status: 'blocked', assignee: 'coder', priority: -1 });

    // The undo toast runs these, newest first, from what each card showed before its change.
    const undos = changes.map((change) => undoOf(before, change));
    for (const undo of undos.reverse()) {
      expect(undo).toBeDefined();
      expect((await send(cardChangeRequest(id, undo!))).status).toBe(200);
    }
    expect(await task(id)).toMatchObject({ status: 'ready', assignee: 'writer', priority: 2 });
  });
});

/** Seeds a task in `status` the way Hermes itself would have moved it there. */
async function seedIn(status: string): Promise<string> {
  const id = await seed(`In ${status}`, { triage: status === 'triage' });
  if (status === 'triage' || status === 'ready') return id;
  const moved = await hermes.backend.fetch(`/api/plugins/kanban/tasks/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, result: 'Finished.', summary: 'Finished.' }) });
  expect(moved.status, `seeding ${status}: ${await moved.clone().text()}`).toBe(200);
  return id;
}

describe('where a card can be moved', () => {
  test('every move the table lists lands the task in that column, and no move it leaves out does (checked on the real Hermes, from every column)', async () => {
    const { send, task } = await start();
    const statuses = [...Object.keys(MOVES)] as (keyof typeof MOVES)[];
    const targets = statuses.filter((status) => status !== 'archived');
    const outcomes: string[] = [];
    for (const from of statuses) {
      // Each move gets a task of its own. One at a time: Hermes promotes every Todo task with no open parent to Ready whenever any
      // task changes, so a Todo task seeded beside another move would not stay where the test put it.
      const results: { to: string; listed: boolean; landed: string }[] = [];
      for (const to of [...targets, 'archived' as const].filter((candidate) => candidate !== from)) {
        const id = await seedIn(from);
        const answer = await send(cardChangeRequest(id, { kind: 'move', to }));
        results.push({ to, listed: (MOVES[from] as readonly string[]).includes(to), landed: answer.status === 200 ? (answer.body.task.status as string) : `refused ${answer.status}` });
      }
      for (const { to, listed, landed } of results) {
        outcomes.push(`${from} → ${to}: ${listed ? 'listed' : 'unlisted'}, ${listed ? (landed === to ? 'lands' : `landed ${landed}`) : landed === to ? 'LANDS' : 'does not land'}`);
      }
    }

    expect(outcomes.filter((line) => /landed |LANDS/.test(line))).toEqual([]);
    expect(outcomes.filter((line) => line.includes('listed, lands')).length).toBe(Object.values(MOVES).flat().length);
    // A running card is not moved at all.
    expect(moveTargets({ status: 'running' })).toEqual([]);
    void task;
  }, 180_000);
});

describe('bulk changes', () => {
  test('are a T2: refused without a step-up, then each task reports its own outcome, and a refusal does not stop the others', async () => {
    const plain = await start();
    const first = await seed('Bulk one', { assignee: 'writer' });
    const second = await seed('Bulk two');
    const gone = 't_does_not_exist';
    // Done is only reachable from Ready, Blocked and Review: this one is in Triage, so Hermes refuses it by itself.
    const triaged = await seed('Still a sketch', { triage: true });

    const withoutStepUp = await plain.send<PolicyRefusal>(bulkRequest([first, second], { kind: 'priority', to: 4 }));
    expect(withoutStepUp).toMatchObject({ status: 403, body: { error: 'step-up-required', tier: 'T2' } });
    expect((await plain.task(first)).priority).toBe(0);
    await server?.close();

    const { send, task } = await start({ steppedUp: true });
    const ids = [first, gone, second, triaged];
    const answer = await send(bulkRequest(ids, { kind: 'move', to: 'done', note: 'Closed in bulk.' }));
    expect(answer.status).toBe(200);
    const results = readBulk(answer.body, ids);
    expect(results.map((result) => [result.id, result.ok])).toEqual([[first, true], [gone, false], [second, true], [triaged, false]]);
    expect(results.find((result) => result.id === gone)?.error).toBe('not found');
    expect(results.find((result) => result.id === triaged)?.error).toMatch(/refused|not valid|done/);
    expect([(await task(first)).status, (await task(second)).status, (await task(triaged)).status]).toEqual(['done', 'done', 'triage']);

    const archived = await send(bulkRequest([first, second], { kind: 'move', to: 'archived' }));
    expect(readBulk(archived.body, [first, second]).map((result) => result.ok)).toEqual([true, true]);
    expect((await send(bulkRequest([], { kind: 'priority', to: 1 }))).status).toBe(400);
  });
});

describe('boards', () => {
  test('create and rename are T1 and land in Hermes; switching makes a board Hermes’s current one; a slug Hermes would refuse is refused', async () => {
    const { send, call } = await start();
    const listed = async () => readBoards((await call('GET', '/api/plugins/kanban/boards')).body);

    expect((await send(boardRequests.create({ slug: 'side-work', name: 'Side work', description: 'Odd jobs' }))).status).toBe(200);
    expect((await send(boardRequests.rename('side-work', { name: 'Side jobs' }))).status).toBe(200);
    const created = await call('POST', '/api/plugins/kanban/tasks?board=side-work', { body: { title: 'Sweep the yard' } });
    expect(created.status).toBe(200);
    const { boards, current } = await listed();
    expect(current).toBe('default');
    expect(boards.map((candidate) => candidate.slug)).toEqual(['default', 'side-work']);
    expect(boards.find((candidate) => candidate.slug === 'side-work')).toMatchObject({ name: 'Side jobs', description: 'Odd jobs', isCurrent: false, total: 1 });

    expect((await send(boardRequests.switchTo('side-work'))).status).toBe(200);
    expect((await listed()).current).toBe('side-work');
    expect((await send(boardRequests.switchTo('default'))).status).toBe(200);

    expect(boardSlugProblem('Side Work!')).toMatch(/lowercase/);
    expect((await send(boardRequests.create({ slug: 'Side Work!', name: 'Bad' }))).status).toBe(400);
  });
});

describe('exporting, archiving and importing boards', () => {
  test('export is Hermes’s file, which the browser downloads; archive takes the board off the list and its undo puts the same tasks back at T1; any other import is a T3 with a typed name', async () => {
    // Its own board address: the boards test above made `side-work` on this same Hermes, and creating a board that exists answers the existing one.
    const { send, call, raw } = await start({ steppedUp: true });
    expect((await send(boardRequests.create({ slug: 'yard-work', name: 'Side work' }))).status).toBe(200);
    const yard = await call('POST', '/api/plugins/kanban/tasks?board=yard-work', { body: { title: 'Sweep the yard', assignee: 'writer', priority: 3 } });
    expect(yard.status).toBe(200);
    const listed = async () => readBoards((await call('GET', '/api/plugins/kanban/boards')).body);
    const titlesOn = async (slug: string) => parseBoard((await call('GET', `/api/plugins/kanban/board?board=${slug}`)).body).tasks.map((task) => task.title);

    const exported = await send(boardRequests.export('yard-work'));
    expect(exported.status).toBe(200);
    const archive = readExport(exported.body);
    expect(archive).toMatch(/\/kanban\/board-exports\/yard-work-\d{8}-\d{6}\.tar\.gz$/);
    const download = await raw(downloadPath(archive!));
    expect(download.status).toBe(200);
    // A gzip file: its first two bytes.
    expect([...new Uint8Array(await download.arrayBuffer()).slice(0, 2)]).toEqual([0x1f, 0x8b]);

    const archived = await send(boardRequests.archive('yard-work'));
    expect(archived.status).toBe(200);
    expect((await listed()).boards.map((candidate) => candidate.slug)).not.toContain('yard-work');

    // Undo: the export saved just before, asked back under the same address. No typed name: it is a T1.
    // Hermes keeps an archived board's address for the archived board, so it lands the copy under another one and says which.
    const restore = boardRequests.restore(archive!, 'yard-work');
    const undone = await send<{ board?: string }>(restore);
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    const landed = undone.body.board!;
    expect(landed).not.toBe('yard-work');
    expect(await titlesOn(landed)).toEqual(['Sweep the yard']);
    expect((await listed()).boards.find((candidate) => candidate.slug === landed)).toMatchObject({ name: 'Side work', total: 1 });

    // Any other import is the T3: it needs the typed name, and then lands as a new board.
    const copy = boardRequests.importArchive({ archive: archive!, slug: 'yard-copy' });
    expect(await send<PolicyRefusal>(copy)).toMatchObject({ status: 403, body: { error: 'confirmation-required', tier: 'T3' } });
    expect((await send(copy, 'yard-copy')).status).toBe(200);
    expect(await titlesOn('yard-copy')).toEqual(['Sweep the yard']);
    expect(importSlugFor(archive!)).toBe('yard-work');
    expect(importSlugFor('/Users/o/Downloads/My Board.tar.gz')).toBe('my-board');
  });
});

describe('the dispatcher', () => {
  test('a preview says which tasks would start and why the others wait, and starts nothing; a nudge that has nothing it may start starts nothing either', async () => {
    const { send, task } = await start();
    // `default` is a real profile of the temp home, so a ready task of its own is one the dispatcher would start: only ever in a preview.
    const startable = await seed('Would start', { assignee: 'default' });
    const nobody = await seed('Nobody’s', {});
    const stranger = await seed('Not a profile', { assignee: 'orion-cc' });
    const ready = [startable, nobody, stranger];

    const preview = await send(dispatchRequest({ dryRun: true }));
    expect(preview.status).toBe(200);
    expect(readDispatch(preview.body, ready)).toMatchObject({
      wouldStart: [{ taskId: startable, profile: 'default' }],
      waiting: expect.arrayContaining([
        { taskId: nobody, why: expect.stringMatching(/nobody|assigned/i) },
        { taskId: stranger, why: expect.stringMatching(/not a Hermes profile/i) },
      ]),
    });
    // Nothing started: no worker, no run, the task is where it was.
    expect(await task(startable)).toMatchObject({ status: 'ready', startedAt: null });
    const detail = await send({ method: 'GET', path: `/api/plugins/kanban/tasks/${startable}` });
    expect(detail.body.runs).toEqual([]);
    expect((await send({ method: 'GET', path: '/api/plugins/kanban/workers/active' })).body.count).toBe(0);

    // The nudge asks Hermes to dispatch for real, so it is sent on a board where no task may start: the two that wait stay ready.
    // (The task above would start, and Hermes would run a real worker for it.)
    await hermes.backend.fetch('/api/plugins/kanban/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'quiet', name: 'Quiet' }) });
    const waitingOne = await seed('Nobody’s here', {}, 'quiet');
    const waitingTwo = await seed('Not a profile here', { assignee: 'orion-cc' }, 'quiet');
    const nudge = await send(dispatchRequest({ slug: 'quiet' }));
    expect(nudge.status).toBe(200);
    expect(readDispatch(nudge.body, [waitingOne, waitingTwo])).toMatchObject({ wouldStart: [], waiting: [{ taskId: waitingOne }, { taskId: waitingTwo }] });
    expect([(await task(waitingOne, 'quiet')).status, (await task(waitingTwo, 'quiet')).status]).toEqual(['ready', 'ready']);
    expect((await send({ method: 'GET', path: '/api/plugins/kanban/workers/active?board=quiet' })).body.count).toBe(0);
  });

  test('settings are a T2 that Hermes saves under `kanban`, and the page reads them back from Hermes; nothing else in the config can be written this way', async () => {
    const owner = await start();
    const change = settingsRequest({ maxInProgress: 2, maxInProgressPerProfile: 1, staleTimeoutSeconds: 600 });
    expect(await owner.send<PolicyRefusal>(change)).toMatchObject({ status: 403, body: { error: 'step-up-required', tier: 'T2' } });
    await server?.close();

    const { send, call } = await start({ steppedUp: true });
    const readBack = async () => readSettings((await call('GET', '/api/config')).body, (await call('GET', '/api/plugins/kanban/orchestration')).body);
    expect(await readBack()).toMatchObject({ maxInProgress: null, maxInProgressPerProfile: null, staleTimeoutSeconds: 14400, autoDecompose: true });

    expect((await send(change)).status).toBe(200);
    expect(await readBack()).toMatchObject({ maxInProgress: 2, maxInProgressPerProfile: 1, staleTimeoutSeconds: 600 });
    // Clearing a limit writes null, which Hermes reads as "none of my own".
    expect((await send(settingsRequest({ maxInProgress: null, autoDecompose: false, defaultAssignee: 'orion-cc' }))).status).toBe(200);
    expect(await readBack()).toMatchObject({ maxInProgress: null, maxInProgressPerProfile: 1, autoDecompose: false, defaultAssignee: 'orion-cc' });

    // The route is the whole config's, which is a T3 for anything but these settings.
    const other = { method: 'PUT', path: '/api/config', body: { config: { kanban: { dispatch_profiles: ['x'] } } } };
    expect(await send<PolicyRefusal>(other)).toMatchObject({ status: 403, body: { error: 'confirmation-required', tier: 'T3' } });
  });
});

describe('stuck workers', () => {
  test('Reclaim on a running task is a T1 that returns the card to Ready, and it shows in the stats Hermes keeps', async () => {
    const { send, task } = await start();
    const id = await seed('Stuck one', { assignee: 'coder' });
    // A worker holds it: the way a worker (or the owner at a terminal) claims a task, outside Caduceus.
    kanban('claim', id);
    expect(await task(id)).toMatchObject({ status: 'running', assignee: 'coder' });
    const stats = readSide({ stats: (await send({ method: 'GET', path: '/api/plugins/kanban/stats' })).body });
    expect(stats.byStatus).toMatchObject({ running: 1 });
    expect(stats.byAssignee).toContainEqual({ name: 'coder', counts: { running: 1 }, total: 1 });

    expect((await send(requests.reclaim(id, 'Reclaimed from Caduceus'))).status).toBe(200);
    expect(await task(id)).toMatchObject({ status: 'ready', assignee: 'coder' });
    // Nothing to reclaim any more: Hermes says so, and the page shows its words.
    const again = await send(requests.reclaim(id, 'Reclaimed from Caduceus'));
    expect(again.status).toBe(409);
    expect(again.body.detail).toMatch(/cannot reclaim/);
  });
});

describe('read-only mode', () => {
  test('refuses every change a board control makes, and still answers a dispatcher preview and every read', async () => {
    const { send, call, task } = await start({ steppedUp: true });
    const id = await seed('Look, don’t touch', { assignee: 'writer', priority: 1 });
    expect((await call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } })).status).toBe(200);

    const writes: Request[] = [
      cardChangeRequest(id, { kind: 'move', to: 'blocked' }),
      cardChangeRequest(id, { kind: 'assign', to: 'coder' }),
      cardChangeRequest(id, { kind: 'priority', to: 9 }),
      bulkRequest([id], { kind: 'priority', to: 9 }),
      requests.reclaim(id, 'no'),
      dispatchRequest({}),
      settingsRequest({ maxInProgress: 3 }),
      boardRequests.create({ slug: 'nope', name: 'Nope' }),
      boardRequests.rename('default', { name: 'Renamed' }),
      boardRequests.archive('default'),
      boardRequests.export('default'),
      boardRequests.switchTo('default'),
      boardRequests.importArchive({ archive: '/x/y-20261019-002528.tar.gz', slug: 'y' }),
    ];
    for (const write of writes) expect((await send(write, 'typed')).body, `${write.method} ${write.path}`).toMatchObject({ error: 'read-only' });
    expect(await task(id)).toMatchObject({ status: 'ready', assignee: 'writer', priority: 1 });

    expect((await send(dispatchRequest({ dryRun: true }))).status).toBe(200);
    expect((await send({ method: 'GET', path: '/api/plugins/kanban/diagnostics' })).status).toBe(200);
  });
});

