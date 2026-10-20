import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { requests, type Plain } from '../../web/src/modules/work/task-requests.ts';

// Task detail (M3 #04): what the task page writes to Hermes's Kanban through Caduceus, in front of the real Hermes.
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
  return { url: server.url, cookie };
}

async function createTask(title: string): Promise<string> {
  const response = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  const created: { task: { id: string } } = await response.json();
  return created.task.id;
}

/** The `hermes kanban` CLI of the temp home: how a worker (or the owner at a terminal) changes Hermes, outside Caduceus. */
const kanban = (...args: string[]) => hermes.cli('kanban', ...args);

/** Sends a request the way the page does: with the owner's cookie, to Caduceus. */
async function send(url: string, cookie: string, request: Plain): Promise<{ status: number; body: any }> {
  const response = await fetch(`${url}${request.path}`, {
    method: request.method,
    headers: { cookie, origin: url, ...(request.body ? { 'content-type': 'application/json' } : {}) },
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

interface Detail {
  task: { status: string; assignee: string | null; title: string; body: string | null; current_run_id: number | null };
  runs: { id: number; outcome: string | null; profile: string | null }[];
  links: { parents: string[]; children: string[] };
  comments: { author: string; body: string }[];
  attachments: { id: number; filename: string; uploaded_by: string }[];
}
async function detail(url: string, cookie: string, id: string): Promise<Detail> {
  return (await fetch(`${url}/api/plugins/kanban/tasks/${id}`, { headers: { cookie } })).json();
}

describe('comments and uploads carry the author Caduceus stamps', () => {
  test('a comment posted with a forged author field is stored with the stamped author', async () => {
    const { url, cookie } = await start();
    const id = await createTask('Forged comment');
    const posted = await fetch(`${url}/api/plugins/kanban/tasks/${id}/comments`, {
      method: 'POST',
      headers: { cookie, origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Looks good', author: 'the-ceo' }),
    });
    expect(posted.status).toBe(200);
    const { comments } = await detail(url, cookie, id);
    expect(comments).toMatchObject([{ body: 'Looks good', author: 'owner' }]);
  });

  test('an upload with a forged uploaded_by is stored as the owner’s, and the file survives intact', async () => {
    const { url, cookie } = await start();
    const id = await createTask('Forged upload');
    const form = new FormData();
    form.set('file', new Blob(['hello attachment'], { type: 'text/plain' }), 'notes.txt');
    form.set('uploaded_by', 'the-ceo');
    const posted = await fetch(`${url}/api/plugins/kanban/tasks/${id}/attachments`, { method: 'POST', headers: { cookie, origin: url }, body: form });
    expect(posted.status).toBe(200);
    const { attachments } = await detail(url, cookie, id);
    expect(attachments).toMatchObject([{ filename: 'notes.txt', uploaded_by: 'owner' }]);
    const file = await fetch(`${url}/api/plugins/kanban/attachments/${attachments[0].id}`, { headers: { cookie } });
    expect(await file.text()).toBe('hello attachment');
  });

  test('an escaped spelling of the comments path is stamped too', async () => {
    const { url, cookie } = await start();
    const id = await createTask('Escaped path');
    await fetch(`${url}/api/plugins/kanban/tasks/${id}/comm%65nts`, {
      method: 'POST',
      headers: { cookie, origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'sneaky', author: 'the-ceo' }),
    });
    expect((await detail(url, cookie, id)).comments.map((c) => c.author)).not.toContain('the-ceo');
  });
});

describe('the task page’s actions, against the real Hermes', () => {
  test('Run now: a task in Todo goes to Ready and the dispatcher nudge is accepted', async () => {
    const { url, cookie } = await start();
    const id = await createTask('Run me');
    await send(url, cookie, requests.setStatus(id, 'todo'));
    expect((await send(url, cookie, requests.setStatus(id, 'ready'))).status).toBe(200);
    expect((await send(url, cookie, requests.dispatch())).status).toBe(200);
    expect((await detail(url, cookie, id)).task.status).toBe('ready');
  });

  test('Terminate ends the current run as reclaimed and the task leaves Running; Reclaim does the same by task', async () => {
    const { url, cookie } = await start();
    const first = await createTask('Terminate me');
    await kanban('assign', first, 'coder');
    await kanban('claim', first);
    const running = await detail(url, cookie, first);
    expect(running.task.status).toBe('running');
    const runId = running.task.current_run_id!;
    expect((await send(url, cookie, requests.terminate(runId, 'because', undefined))).status).toBe(200);
    const after = await detail(url, cookie, first);
    expect(after.task.status).not.toBe('running');
    expect(after.runs.find((run) => run.id === runId)?.outcome).toBe('reclaimed');

    const second = await createTask('Reclaim me');
    await kanban('assign', second, 'coder');
    await kanban('claim', second);
    expect((await send(url, cookie, requests.reclaim(second, 'stuck'))).status).toBe(200);
    expect((await detail(url, cookie, second)).task.status).not.toBe('running');
  });

  test('Retry moves a blocked task back to Ready', async () => {
    const { url, cookie } = await start();
    const id = await createTask('Retry me');
    expect((await send(url, cookie, requests.setStatus(id, 'blocked'))).status).toBe(200);
    expect((await send(url, cookie, requests.setStatus(id, 'ready'))).status).toBe(200);
    expect((await detail(url, cookie, id)).task.status).toBe('ready');
  });

  test('Reassign changes the profile', async () => {
    const { url, cookie } = await start();
    const id = await createTask('Reassign me');
    expect((await send(url, cookie, requests.reassign(id, 'coder', false))).status).toBe(200);
    expect((await detail(url, cookie, id)).task.assignee).toBe('coder');
    expect((await send(url, cookie, requests.reassign(id, null, false))).status).toBe(200);
    expect((await detail(url, cookie, id)).task.assignee).toBeNull();
  });

  test('links are added and removed, parents and children both', async () => {
    const { url, cookie } = await start();
    const parent = await createTask('Parent');
    const child = await createTask('Child');
    expect((await send(url, cookie, requests.link(parent, child))).status).toBe(200);
    expect((await detail(url, cookie, child)).links.parents).toEqual([parent]);
    expect((await detail(url, cookie, parent)).links.children).toEqual([child]);
    expect((await send(url, cookie, requests.unlink(parent, child))).status).toBe(200);
    expect((await detail(url, cookie, child)).links.parents).toEqual([]);
  });

  test('an attachment is uploaded, downloaded and deleted', async () => {
    const { url, cookie } = await start();
    const id = await createTask('Attach');
    const form = new FormData();
    form.set('file', new Blob(['# hi'], { type: 'text/markdown' }), 'readme.md');
    const posted = await fetch(`${url}${requests.upload(id)}`, { method: 'POST', headers: { cookie, origin: url }, body: form });
    expect(posted.status).toBe(200);
    const [file] = (await detail(url, cookie, id)).attachments;
    expect((await send(url, cookie, requests.deleteAttachment(file.id))).status).toBe(200);
    expect((await detail(url, cookie, id)).attachments).toEqual([]);
  });

  test('Reject after a Specify puts the old title, brief and column back', async () => {
    const { url, cookie } = await start();
    const created = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Vague', body: 'old brief', triage: true }) });
    const id = ((await created.json()) as { task: { id: string } }).task.id;
    // What Specify leaves behind: a new title and brief, in Todo.
    await send(url, cookie, { method: 'PATCH', path: `/api/plugins/kanban/tasks/${id}`, body: { title: 'Precise', body: 'new brief' } });
    await send(url, cookie, requests.setStatus(id, 'todo'));
    const restored = await send(url, cookie, requests.restore(id, { title: 'Vague', brief: 'old brief', status: 'triage' }));
    expect(restored.status).toBe(200);
    expect((await detail(url, cookie, id)).task).toMatchObject({ title: 'Vague', body: 'old brief', status: 'triage' });
  });
});
