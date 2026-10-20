import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { InboxNotice, InboxState } from '@caduceus/contracts/inbox';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { openEventStream, type EventStream } from './fixtures/event-stream.ts';
import { editKanbanDb } from './fixtures/kanban-db.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

// Work in the Inbox (M3 #09) in front of the real Hermes in a throwaway HERMES_HOME. Tasks are made and moved the way the CLI does, so the Inbox
// must notice a change it did not make itself. The read interval is a minute: only the board's event stream can explain an item going within seconds.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
let cookie = '';
const streams: EventStream[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function open() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir, inboxPollMs: 25, inboxReadMs: 60_000 });
  cookie = await ownerCookie(server.url);
  const url = server.url;
  const stream = await openEventStream(url, '/_caduceus/api/inbox/stream', cookie);
  streams.push(stream);
  let state: InboxState | undefined;
  return {
    url,
    async until(match: (state: InboxState) => boolean): Promise<InboxState> {
      for (;;) {
        if (state && match(state)) return state;
        const event = await stream.next();
        if (event.event === 'inbox') state = event.data as InboxState;
      }
    },
    async send(action: { request: { method: string; path: string; body?: unknown } }, body?: Record<string, unknown>) {
      const sent = body ?? action.request.body;
      const res = await fetch(`${url}${action.request.path}`, { method: action.request.method, headers: { cookie, origin: url, ...(sent ? { 'content-type': 'application/json' } : {}) }, body: sent ? JSON.stringify(sent) : undefined });
      return { status: res.status, body: (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined };
    },
    async task(id: string) {
      return ((await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${id}`)).json()) as { task: { status: string }; comments: { author: string; body: string }[] });
    },
  };
}

type Page = Awaited<ReturnType<typeof open>>;
const forTask = (id: string) => (state: InboxState) => state.items.some((item) => item.ref === `task:default:${id}`);
const noTask = (id: string) => (state: InboxState) => !forTask(id)(state);
const itemOf = (state: InboxState, id: string) => state.items.find((item) => item.ref === `task:default:${id}`) as InboxNotice;
const action = (item: InboxNotice, id: string) => item.actions.find((candidate) => candidate.id === id)!;

async function made(title: string, ...then: (string[] | ((id: string) => string[]))[]): Promise<string> {
  const res = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  const { task } = (await res.json()) as { task: { id: string } };
  await hermes.cli('kanban', 'assign', task.id, 'default');
  for (const step of then) await hermes.cli('kanban', ...(typeof step === 'function' ? step(task.id) : step));
  return task.id;
}

/** What Hermes has no write path for: a worker that crashed and was given up on. */
function gaveUp(id: string) {
  editKanbanDb(hermes.home, (db) => db.prepare("UPDATE tasks SET status = 'blocked', block_kind = 'transient', consecutive_failures = 3, last_failure_error = 'worker crashed' WHERE id = ?").run(id));
}

describe('tasks that need the owner', () => {
  test('a task in review is a decision; Approve writes done through Caduceus and the item goes', async () => {
    const id = await made('Draft the post', (taskId) => ['request-review', taskId]);
    const page: Page = await open();
    const item = itemOf(await page.until(forTask(id)), id);

    expect(item).toMatchObject({ group: 'decision', category: 'work', title: 'Review: Draft the post' });
    expect((await page.send(action(item, 'approve'))).status).toBe(200);
    expect((await page.task(id)).task.status).toBe('done');
    await page.until(noTask(id));
  }, 60_000);

  test('Reject needs a note, posts it as a comment stamped by Caduceus and returns the task to work', async () => {
    const id = await made('Write the report', (taskId) => ['request-review', taskId]);
    const page = await open();
    const item = itemOf(await page.until(forTask(id)), id);

    expect((await page.send(action(item, 'reject'), {})).status).toBe(400);
    expect((await page.send(action(item, 'reject'), { note: '   ' })).status).toBe(400);
    expect((await page.task(id)).task.status).toBe('review');
    expect((await page.send(action(item, 'reject'), { note: 'Add the totals.', author: 'someone-else' })).status).toBe(200);
    const after = await page.task(id);
    expect(after.task.status).toBe('ready');
    expect(after.comments).toEqual([expect.objectContaining({ author: 'owner', body: 'Add the totals.' })]);
    await page.until(noTask(id));
  }, 60_000);

  test('a task blocked on a question is a decision; Answer comments and unblocks it', async () => {
    const id = await made('Which database?', (taskId) => ['block', taskId, 'Which database should it use?', '--kind', 'needs_input']);
    const page = await open();
    const item = itemOf(await page.until(forTask(id)), id);

    expect(item).toMatchObject({ group: 'decision', title: 'Needs input: Which database?' });
    expect((await page.send(action(item, 'answer'), {})).status).toBe(400);
    expect((await page.send(action(item, 'answer'), { answer: 'Postgres.' })).status).toBe(200);
    const after = await page.task(id);
    expect(after.task.status).toBe('ready');
    expect(after.comments.map((comment) => [comment.author, comment.body])).toContainEqual(['owner', 'Postgres.']);
    await page.until(noTask(id));
  }, 60_000);

  test('a task that gave up is a failure; Retry sends it to Ready, and Reassign hands it to another profile', async () => {
    const retried = await made('Flaky job', (taskId) => ['block', taskId, 'crashed', '--kind', 'transient']);
    const moved = await made('Other flaky job', (taskId) => ['block', taskId, 'crashed', '--kind', 'transient']);
    gaveUp(retried);
    gaveUp(moved);
    const page = await open();
    const state = await page.until((current) => forTask(retried)(current) && forTask(moved)(current));

    expect(itemOf(state, retried)).toMatchObject({ group: 'failed', title: 'Gave up: Flaky job', detail: 'worker crashed' });
    expect((await page.send(action(itemOf(state, retried), 'retry'))).status).toBe(200);
    expect((await page.task(retried)).task.status).toBe('ready');
    const reassign = action(itemOf(state, moved), 'reassign');
    expect((await page.send(reassign, { profile: 'writer', reclaim_first: false })).status).toBe(200);
    await page.until((current) => noTask(retried)(current));
  }, 60_000);

  test('an item goes when the task is approved or unblocked from the CLI, within seconds, with no read of the boards in between', async () => {
    const reviewed = await made('Reviewed by CLI', (taskId) => ['request-review', taskId]);
    const asked = await made('Asked and answered', (taskId) => ['block', taskId, 'Which?', '--kind', 'needs_input']);
    const page = await open();
    await page.until((state) => forTask(reviewed)(state) && forTask(asked)(state));

    await hermes.cli('kanban', 'unblock', asked);
    await page.until(noTask(asked));
    await hermes.cli('kanban', 'complete', reviewed, '--summary', 'ok');
    await page.until(noTask(reviewed));
  }, 60_000);

  test('nothing about the items is stored by Caduceus', async () => {
    const id = await made('Stored nowhere', (taskId) => ['request-review', taskId]);
    const page = await open();
    await page.until(forTask(id));
    const db = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'));
    try {
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
      for (const { name } of rows) expect(JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all())).not.toContain('Stored nowhere');
    } finally {
      db.close();
    }
  }, 60_000);
});

describe('the notification switch of a scheduled job', () => {
  test('is a preference of Caduceus: it is kept per job, tells the Inbox, and leaves the job in Hermes as it was', async () => {
    const created = await hermes.backend.fetch('/api/cron/jobs?profile=default', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Say hello', schedule: 'every 6h', name: 'Quiet job' }) });
    const { id } = (await created.json()) as { id: string };
    const before = await (await hermes.backend.fetch(`/api/cron/jobs/${id}?profile=default`)).json();
    const page = await open();
    const route = `${page.url}/_caduceus/api/work/jobs/default/${id}/notifications`;
    const headers = { cookie, origin: page.url, 'content-type': 'application/json' };

    expect(await (await fetch(route, { headers })).json()).toEqual({ enabled: true });
    expect((await fetch(route, { method: 'PUT', headers, body: JSON.stringify({ enabled: 'no' }) })).status).toBe(400);
    expect((await fetch(route, { method: 'PUT', headers, body: JSON.stringify({ enabled: false }) })).status).toBe(200);
    expect(await (await fetch(route, { headers })).json()).toEqual({ enabled: false });
    expect(await (await hermes.backend.fetch(`/api/cron/jobs/${id}?profile=default`)).json()).toEqual(before);
    expect((await fetch(route, { method: 'PUT', headers, body: JSON.stringify({ enabled: true }) })).status).toBe(200);
    expect(await (await fetch(route, { headers })).json()).toEqual({ enabled: true });
    await hermes.backend.fetch(`/api/cron/jobs/${id}?profile=default`, { method: 'DELETE' });
  }, 60_000);
});
