import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { parseBoard, type BoardTask } from '../../web/src/modules/work/board-model.ts';
import { createLiveBoard, type LiveBoard, type LiveBoardState } from '../../web/src/modules/work/board-live.ts';
import { hermesQuery, selectTasks, type FilterDefinition } from '../../web/src/modules/work/tasks-model.ts';
import { browserWebSocket } from './fixtures/browser-socket.ts';
import { editKanbanDb } from './fixtures/kanban-db.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Work › Tasks' built-in filters (M3 #03), in front of the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME): each
// filter selects exactly the tasks Hermes returns for the equivalent query. Hermes's own list (`hermes kanban list --json` with
// the equivalent flags, and the board endpoint's query parameters) is the independent source of what the equivalent query returns.
// Each test gets a Hermes of its own, so the tasks of one never turn up in another.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeEach(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterEach(async () => {
  await server?.close();
  server = undefined;
  await hermes.stop();
});

/** Runs Hermes's own kanban CLI against the test home, the way an operator or a worker would. */
const cli = (...args: string[]) => hermes.cli('kanban', ...args);

/**
 * A task made at Hermes's own REST API (a request, not a Python start; Caduceus is not in the path) and then taken through `steps`, the CLI
 * arguments that follow, given its id; returns its id. Every CLI run is a Python start, which is most of what these tests take: tasks are
 * made side by side (`Promise.all`), and a task needs no more than one run.
 */
async function made(title: string, fields: { assignee?: string; tenant?: string; priority?: number } = {}, ...steps: ((id: string) => string[])[]): Promise<string> {
  const response = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, ...fields }) });
  expect(response.status).toBe(200);
  const { task }: { task: { id: string } } = await response.json();
  for (const step of steps) await cli(...step(task.id));
  return task.id;
}

/** The ids `hermes kanban list` gives for the equivalent query. */
const listed = async (...flags: string[]): Promise<string[]> => {
  const tasks: { id: string }[] = JSON.parse(await cli('list', '--json', ...flags));
  return tasks.map((task) => task.id).sort();
};

const ids = (tasks: readonly BoardTask[]) => tasks.map((task) => task.id).sort();

/** A Caduceus server in front of this test's Hermes, and the owner's cookie for it. */
async function session() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  return { url: server.url, cookie: await ownerCookie(server.url) };
}

async function board(query = ''): Promise<BoardTask[]> {
  const { url, cookie } = await session();
  const response = await fetch(`${url}/api/plugins/kanban/board${query}`, { headers: { cookie } });
  expect(response.status).toBe(200);
  return parseBoard(await response.json()).tasks;
}

/** What Hermes has no write path for: the playbook a task came from (the playbook engine is M6) and a failed attempt, which a real worker leaves. */
function stamp(id: string, columns: Record<string, string | number>) {
  editKanbanDb(hermes.home, (db) => {
    for (const [column, value] of Object.entries(columns)) db.prepare(`UPDATE tasks SET ${column} = ? WHERE id = ?`).run(value, id);
  });
}

const select = (tasks: BoardTask[], definition: FilterDefinition) => ids(selectTasks(tasks, definition));

describe('the built-in task filters, against Hermes', () => {
  test('Mine, Waiting for me, By playbook and By project each select what the equivalent Hermes query returns', async () => {
    const [mine, mineRunning, , , reviewing, asking, waitingOnTask, released, archived] = await Promise.all([
      made('Fix the build', { assignee: 'coder' }),
      made('Tune the cache', { assignee: 'coder', priority: 2 }),
      made('Write the changelog', { assignee: 'writer' }),
      made('Nobody has this'),
      made('Draft the post', { assignee: 'writer' }, (id) => ['request-review', id]),
      made('Which database?', { assignee: 'coder' }, (id) => ['block', id, 'Which database should it use?', '--kind', 'needs_input']),
      // Blocked, but not on a question: no worker can take it (Hermes turns a dependency block with no open parent into a question).
      made('Needs a skill', { assignee: 'coder' }, (id) => ['block', id, 'No profile has the skill', '--kind', 'capability']),
      made('Ship it', { assignee: 'coder' }, (id) => ['complete', id, '--summary', 'Finished.']),
      made('Old news', { assignee: 'coder' }, (id) => ['archive', id]),
    ]);
    const [coder, inReview] = await Promise.all([listed('--assignee', 'coder'), listed('--status', 'review')]);
    expect(coder).toEqual(expect.arrayContaining([mine, mineRunning]));

    const tasks = await board();
    // Mine: the profile in scope, which is `coder` here.
    expect(select(tasks, { assignee: 'coder' })).toEqual(coder);
    expect(select(tasks, { assignee: 'coder' })).not.toContain(archived);
    // Waiting for me: everything in review, and what is blocked on a question.
    const waiting = select(tasks, { waiting: true });
    expect(waiting).toEqual([...inReview, asking].sort());
    expect(waiting).not.toContain(waitingOnTask);
    // By playbook: a task made by the playbook engine carries its playbook in `idempotency_key` (Hermes cannot set the native field), which Hermes cannot filter
    // on, so the page asks Hermes for the whole board and selects; a task that has the native `workflow_template_id` is selected by it, the same tasks Hermes lists.
    stamp(mine, { workflow_template_id: 'release' });
    stamp(released, { workflow_template_id: 'release' });
    stamp(asking, { workflow_template_id: 'research' });
    const playbook: FilterDefinition = { playbook: 'release' };
    expect(hermesQuery(playbook)).toBe('');
    expect(select(await board(), playbook)).toEqual(await listed('--workflow-template-id', 'release'));
    // By project: a task carries its project's id.
    stamp(mineRunning, { project_id: 'p_site' });
    stamp(waitingOnTask, { project_id: 'p_site' });
    stamp(reviewing, { project_id: 'p_docs' });
    const projected = await board();
    expect(select(projected, { project: 'p_site' })).toEqual([mineRunning, waitingOnTask].sort());
    expect(select(projected, { project: 'p_docs' })).toEqual([reviewing]);
  });

  test('Failed selects the tasks whose latest run failed or that Hermes gave up on, and not what finished since', async () => {
    const [failing, gaveUp, recovered] = await Promise.all([
      made('Flaky build', { assignee: 'coder' }),
      made('Hopeless', { assignee: 'coder' }, (id) => ['block', id, 'Gave up after repeated failures']),
      made('Fine now', { assignee: 'coder' }),
      made('Never ran', { assignee: 'coder' }),
    ]);
    stamp(failing, { consecutive_failures: 1, last_failure_error: 'spawn_failed: no such profile' });
    stamp(gaveUp, { consecutive_failures: 3, last_failure_error: 'crashed' });
    // A task that finishes has its failure record cleared by Hermes (`complete_task`): the filter reads Hermes's own fields.
    stamp(recovered, { consecutive_failures: 2, last_failure_error: 'timed_out' });
    await cli('complete', recovered, '--summary', 'Finished.');

    const tasks = await board();
    expect(select(tasks, { failed: true })).toEqual([failing, gaveUp].sort());
  });

  test('a filter with several conditions needs all of them, and the tenant is a query Hermes answers', async () => {
    const [a] = await Promise.all([
      made('Coder in review', { assignee: 'coder', tenant: 'acme' }, (id) => ['request-review', id]),
      made('Coder ready', { assignee: 'coder', tenant: 'acme' }),
      made('Writer ready', { assignee: 'writer', tenant: 'other' }),
    ]);

    const tasks = await board();
    expect(select(tasks, { assignee: 'coder', waiting: true })).toEqual([a]);
    expect(select(tasks, { statuses: ['ready'], text: 'ready' })).toHaveLength(2);
    expect(hermesQuery({ tenant: 'acme', playbook: 'x y' })).toBe('?tenant=acme');
    expect(ids(await board(hermesQuery({ tenant: 'acme' })))).toEqual(await listed('--tenant', 'acme'));
  });
});

describe('the task list, live, while a filter is applied', () => {
  let engine: LiveBoard | undefined;
  afterEach(() => engine?.close());

  test('a task that arrives, changes status or is archived appears in and leaves the list exactly when the filter says so', async () => {
    const { url, cookie } = await session();
    // The page's filter: Waiting for me, in the tenant `acme` (the tenant is asked of Hermes, the waiting is applied to its answer).
    const definition: FilterDefinition = { tenant: 'acme', waiting: true };
    const query = hermesQuery(definition);
    const asked: string[] = [];
    engine = createLiveBoard({
      fetchBoard: async () => {
        asked.push(query);
        const response = await fetch(`${url}/api/plugins/kanban/board${query}`, { headers: { cookie } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      },
      openEvents: async (since) => browserWebSocket(url, { cookie, path: `/api/plugins/kanban/events?since=${since}` }),
      backoff: { baseDelayMs: 5, capMs: 50 },
    });
    const live = engine;
    const shown = (state: LiveBoardState) => (state.board ? selectTasks(state.board.tasks, definition).map((task) => task.title).sort() : []);
    const until = (match: (state: LiveBoardState) => boolean): Promise<LiveBoardState> => {
      if (match(live.state)) return Promise.resolve(live.state);
      const { promise, resolve } = Promise.withResolvers<LiveBoardState>();
      const stop = live.subscribe(() => {
        if (!match(live.state)) return;
        stop();
        resolve(live.state);
      });
      return promise;
    };
    await until((state) => state.phase === 'ready' && state.live);
    expect(shown(live.state)).toEqual([]);

    // Made in Hermes the way a worker or the CLI would: not through Caduceus.
    const review = await made('Review me', { tenant: 'acme', assignee: 'coder' }, (id) => ['request-review', id]);
    await until((state) => shown(state).includes('Review me'));
    await Promise.all([
      made('Other tenant', { tenant: 'other', assignee: 'coder' }, (id) => ['request-review', id]),
      made('A question', { tenant: 'acme', assignee: 'coder' }, (id) => ['block', id, 'Which one?', '--kind', 'needs_input']),
    ]);
    await until((state) => shown(state).includes('A question'));
    // The other tenant's review never shows: Hermes was asked for `acme` only.
    expect(shown(live.state)).toEqual(['A question', 'Review me']);
    expect((live.state.board?.tasks ?? []).map((task) => task.title)).not.toContain('Other tenant');

    // A review that is approved leaves the list at once.
    await cli('complete', review, '--summary', 'Approved.');
    const left = await until((state) => !shown(state).includes('Review me'));
    expect(shown(left)).toEqual(['A question']);
    expect(asked.every((value) => value === query)).toBe(true);
  });
});
