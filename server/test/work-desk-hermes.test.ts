import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InboxState } from '@caduceus/contracts/inbox';
import type { ReadyState } from '@caduceus/contracts/today';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { parseBoard } from '../../web/src/modules/work/board-model.ts';
import { readBoards } from '../../web/src/modules/work/board-ops.ts';
import { parseJobs } from '../../web/src/modules/work/schedules-model.ts';
import { groupWork, WORK_GROUPS } from '../../web/src/modules/work/work-desk-model.ts';
import { openEventStream, type EventStream } from './fixtures/event-stream.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { editKanbanDb } from './fixtures/kanban-db.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Work's landing view (M8 #07) over a seeded real Hermes: two boards with a task in every status Hermes can leave one in, three schedules, a chat run that
// is going and one that has finished. Each of them lands in exactly one of the four groups. What exists is read from Hermes's own CLI and from the ids the
// test was given when it made them, not from the code under test.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let work: string;
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
const streams: EventStream[] = [];
const json = { 'content-type': 'application/json' };

beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  await hermes.cli('config', 'set', 'tools.tool_search.enabled', 'off');
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workdesk-')));
}, 120_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
  fs.rmSync(work, { recursive: true, force: true });
});
afterEach(async () => {
  for (const chat of chats.splice(0)) chat.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  for (const stream of streams.splice(0)) stream.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** A task made at Hermes's own REST API on `board`, then taken through `steps` (CLI arguments given its id); returns its id. */
async function made(board: string, title: string, ...steps: ((id: string) => string[])[]): Promise<string> {
  const response = await hermes.backend.fetch(`/api/plugins/kanban/tasks?board=${board}`, { method: 'POST', headers: json, body: JSON.stringify({ title, assignee: 'default' }) });
  expect(response.status, await response.clone().text()).toBe(200);
  const { task }: { task: { id: string } } = await response.json();
  for (const step of steps) await hermes.cli('kanban', '--board', board, ...step(task.id));
  return task.id;
}

/** What Hermes has no write path for here (a worker holding a task, a block on another task): the task's row, as a worker or the dispatcher would leave it. */
function stamp(id: string, columns: Record<string, string | number>) {
  editKanbanDb(hermes.home, (db) => {
    for (const [column, value] of Object.entries(columns)) db.prepare(`UPDATE tasks SET ${column} = ? WHERE id = ?`).run(value, id);
  });
}

async function schedule(name: string, expression: string): Promise<string> {
  const response = await hermes.backend.fetch('/api/cron/jobs?profile=default', { method: 'POST', headers: json, body: JSON.stringify({ name, schedule: expression, prompt: 'Say hello', deliver: 'local' }) });
  expect(response.status, await response.clone().text()).toBe(200);
  const job: { id: string } = await response.json();
  return job.id;
}

test('every Kanban task of every board, every live and unopened finished run, and every schedule is in exactly one group', async () => {
  // Caduceus is up before any of this finishes: what is ready for review is what finished since it began.
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, inboxPollMs: 25 });
  const cookie = await ownerCookie(server.url);
  const stream = await openEventStream(server.url, '/_caduceus/api/inbox/stream', cookie);
  streams.push(stream);
  // A second board, so that the same id on two boards would be two rows and a task of a board that is not current is not lost.
  const board = await hermes.backend.fetch('/api/plugins/kanban/boards', { method: 'POST', headers: json, body: JSON.stringify({ slug: 'other', name: 'Other' }) });
  expect(board.status).toBe(200);
  const seeded: { board: string; id: string; group: string }[] = [];
  const add = async (slug: string, group: string, title: string, ...steps: ((id: string) => string[])[]) => seeded.push({ board: slug, group, id: await made(slug, title, ...steps) });
  await Promise.all([
    add('default', 'scheduled', 'Queued for a worker'),
    add('default', 'waiting', 'In review', (id) => ['request-review', id]),
    add('default', 'waiting', 'Asks a question', (id) => ['block', id, 'Which database?', '--kind', 'needs_input']),
    add('default', 'waiting', 'No worker can take it', (id) => ['block', id, 'No profile has the skill', '--kind', 'capability']),
    add('default', 'review', 'Finished', (id) => ['complete', id, '--summary', 'Done.']),
    add('other', 'scheduled', 'Queued elsewhere'),
    add('other', 'review', 'Finished elsewhere', (id) => ['complete', id, '--summary', 'Done there.']),
  ]);
  // Hermes would put these there itself while a worker holds a task or while one task waits on another.
  const [running, dependent, rough] = await Promise.all([made('default', 'A worker has it'), made('default', 'Waits on a task'), made('other', 'A rough idea')]);
  stamp(running, { status: 'running', started_at: Math.floor(Date.now() / 1000) });
  stamp(dependent, { status: 'blocked', block_kind: 'dependency' });
  stamp(rough, { status: 'triage' });
  seeded.push({ board: 'default', group: 'running', id: running }, { board: 'default', group: 'scheduled', id: dependent }, { board: 'other', group: 'scheduled', id: rough });
  // A task archived is not on the board, and so in no group.
  const archived = await made('default', 'Archived', (id) => ['archive', id]);

  const [timed, paused] = await Promise.all([schedule('Nightly', '0 23 * * *'), schedule('Weekly', '0 9 * * 1')]);
  const pause = await hermes.backend.fetch(`/api/cron/jobs/${paused}/pause?profile=default`, { method: 'POST' });
  expect(pause.status).toBe(200);

  // Two chat runs: one that has finished (its turn ran to the end) and one held mid-reply.
  const openChat = async () => {
    const page = openGatewayConnection(server!.url, cookie);
    pages.push(page);
    await page.until((status) => status.state === 'connected');
    const chat = createChat(page.connection, { history: page.rest, cwd: work });
    chats.push(chat);
    return chat;
  };
  const [done, going] = [await openChat(), await openChat()];
  llm.nextReply({ chunks: ['All ', 'done.'] });
  await done.send('Finish this one');
  await done.until((state) => !state.running && state.turn === undefined && state.messages.length >= 2);
  const held = llm.nextReply({ chunks: ['Still ', 'working.'], pauseAfter: 1 });
  await going.send('Keep going on this one');
  await held.paused;

  // Hermes lists a session as live until it has released it, a moment after its turn is over: the page's list is read when the finished chat has left it.
  let inbox: InboxState | undefined;
  for (;;) {
    const event = await stream.next();
    if (event.event !== 'inbox') continue;
    const state = event.data as InboxState;
    const liveIds = state.running.map((run) => run.storedSessionId);
    if (liveIds.includes(going.state.storedId) && !liveIds.includes(done.state.storedId) && state.activity.some((event) => event.storedSessionId === done.state.storedId)) {
      inbox = state;
      break;
    }
  }

  const read = async (route: string) => (await fetch(`${server!.url}${route}`, { headers: { cookie } })).json();
  const boards = await Promise.all(readBoards(await read('/api/plugins/kanban/boards')).boards.map(async ({ slug }) => ({ slug, tasks: parseBoard(await read(`/api/plugins/kanban/board?board=${slug}`)).tasks })));
  const jobs = parseJobs(await read('/api/cron/jobs?profile=all'));
  const ready = async () => {
    const state: ReadyState = await read('/_caduceus/api/today/ready');
    return state.items;
  };
  const { groups, settled } = groupWork({ boards, runs: inbox.running, ready: await ready(), jobs });

  const rows = WORK_GROUPS.flatMap((id) => groups[id].map((row) => ({ key: row.key, group: id })));
  // Exactly one: no row twice, and none left out.
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  expect(settled).toBe(0);
  const wanted = [
    ...seeded.map((task) => `task:${task.board}/${task.id}`),
    `job:default/${timed}`,
    `job:default/${paused}`,
    `run:${inbox.running.find((run) => run.storedSessionId === going.state.storedId)!.sessionId}`,
    `finished:${done.state.storedId}`,
  ];
  // The tasks, the schedules and the two chats are all that Hermes has: Hermes's own list says which tasks (an archived one is not a task of the board).
  const listedByHermes = async (slug: string): Promise<string[]> => (JSON.parse(await hermes.cli('kanban', '--board', slug, 'list', '--json')) as { id: string }[]).map((task) => `task:${slug}/${task.id}`);
  const hermesTasks = [...(await listedByHermes('default')), ...(await listedByHermes('other'))];
  expect(hermesTasks).not.toContain(`task:default/${archived}`);
  expect(hermesTasks.sort()).toEqual(wanted.filter((key) => key.startsWith('task:')).sort());
  expect(rows.map((row) => row.key).sort()).toEqual([...wanted].sort());

  // And each is in the group of what it is.
  const groupOf = Object.fromEntries(rows.map((row) => [row.key, row.group]));
  for (const task of seeded) expect(groupOf[`task:${task.board}/${task.id}`], `${task.board}/${task.id}`).toBe(task.group);
  expect(groupOf[`job:default/${timed}`]).toBe('scheduled');
  expect(groupOf[`job:default/${paused}`]).toBe('scheduled');
  expect(groups.scheduled.find((row) => row.job?.id === paused)?.action).toBe('resume');
  expect(groups.scheduled.find((row) => row.job?.id === timed)?.action).toBe('pause');
  expect(groups.running.map((row) => row.source).sort()).toEqual(['run', 'task']);
  expect(groups.review.some((row) => row.key === `finished:${done.state.storedId}`)).toBe(true);

  // Opening a finished row tells Caduceus, and the row leaves Ready for review: the task is settled, on the Board and in Tasks and in no group.
  const finishedTask = groups.review.find((row) => row.source === 'task')!;
  const marked = await fetch(`${server.url}/_caduceus/api/today/ready/opened`, { method: 'POST', headers: { ...json, origin: server.url, cookie }, body: JSON.stringify(finishedTask.opened) });
  expect(marked.status).toBe(200);
  const after = groupWork({ boards, runs: inbox.running, ready: await ready(), jobs });
  expect(after.groups.review.map((row) => row.key)).not.toContain(finishedTask.key);
  expect(after.groups.review).toHaveLength(groups.review.length - 1);
  expect(after.settled).toBe(1);
}, HERMES_WORK_TIMEOUT_MS * 2);
