import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RunDetail } from '@caduceus/contracts/playbook-runs';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

// Deep Research and the Artifacts store (M6 #05), through the Caduceus server's HTTP API in front of a real Hermes Kanban in a throwaway HERMES_HOME. A test
// plays the worker the way Hermes's own `kanban_attach` tool does (an upload to the task) and finishes stages through Hermes's own status change; no model runs.
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

interface Owner {
  url: string;
  cookie: string;
  call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Record<string, any> }>;
  /** Resolves after the engine's next pass over a board. */
  passed(): Promise<void>;
  /** Resolves once this many captures of finished deliverables into Artifacts have run since the server started (one follows each pass), */
  captured(count: number): Promise<void>;
  /** How many have run. */
  captures(): number;
}

async function start(clock?: { now: number }, fileRoots?: readonly string[]): Promise<Owner> {
  let looked = Promise.withResolvers<void>();
  let captures = 0;
  let capturing = Promise.withResolvers<void>();
  server = await startCaduceusServer({
    backend: hermes.backend,
    hermesRoot: hermes.home,
    inboxPollMs: 60_000,
    inboxReadMs: 60_000,
    ...(clock === undefined ? {} : { now: () => clock.now }),
    ...(fileRoots === undefined ? {} : { fileRoots }),
    playbookEngine: {
      sweepMs: 0,
      looked: () => {
        looked.resolve();
        looked = Promise.withResolvers<void>();
      },
      captured: () => {
        captures += 1;
        capturing.resolve();
        capturing = Promise.withResolvers<void>();
      },
    },
  });
  const { url } = server;
  const cookie = await ownerCookie(url);
  return {
    url,
    cookie,
    passed: () => looked.promise,
    async captured(count) {
      while (captures < count) await capturing.promise;
    },
    captures: () => captures,
    async call(method, route, body) {
      const response = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : undefined };
    },
  };
}

const RUNS = '/_caduceus/api/work/playbook-runs';
const DEEP = '/_caduceus/api/work/playbooks/deep-research/runs';

async function finish(id: string): Promise<void> {
  const response = await hermes.backend.fetch(`/api/plugins/kanban/tasks/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done', result: 'finished', summary: 'finished' }) });
  expect(response.status).toBe(200);
}

/** What a worker's `kanban_attach` does: a file on the task. */
async function attach(task: string, name: string, content: string | Uint8Array<ArrayBuffer>, type: string): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), name);
  form.append('uploaded_by', 'researcher');
  const response = await hermes.backend.fetch(`/api/plugins/kanban/tasks/${task}/attachments`, { method: 'POST', body: form });
  expect(response.status).toBe(200);
}

const timelineOf = async (owner: Owner, root: string) => ((await owner.call('GET', `${RUNS}/${root}`)).body.run as RunDetail).timeline;

/** Waits, on the engine's passes, until `done()` holds. */
async function until(owner: Owner, done: () => Promise<boolean>): Promise<void> {
  for (let held = await done(); !held; held = await done()) await owner.passed();
}

describe('Deep Research', () => {
  test('the seed is in the library, and a run’s first brief is shaped by the depth and the breadth the owner chose', async () => {
    const owner = await start();
    const { seeds } = (await owner.call('GET', '/_caduceus/api/work/playbooks')).body;
    const seed = seeds.find((candidate: { id: string }) => candidate.id === 'deep-research');
    expect(seed.stages.map((stage: { key: string }) => stage.key)).toEqual(['plan', 'search', 'synthesise']);
    expect(seed.inputs.map((input: { key: string; default?: string }) => [input.key, input.default])).toEqual([['question', undefined], ['depth', '2'], ['breadth', '4']]);

    const started = await owner.call('POST', DEEP, { inputs: { question: 'How do tidal turbines age?', depth: '3', breadth: '6' } });
    expect(started.status).toBe(201);
    const task = (await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${started.body.root}`)).json()).task;
    expect(task.title).toBe('Plan the research: How do tidal turbines age?');
    expect(task.body).toMatch(/6 sub-questions/);
    await owner.passed();
    await finish(started.body.root);
    await until(owner, async () => (await timelineOf(owner, started.body.root)).length === 2);
    const search = (await timelineOf(owner, started.body.root))[1];
    const searchTask = (await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${search.taskId}`)).json()).task;
    expect(searchTask.body).toMatch(/Do 3 rounds for each/);

    // Left out, they take the seed's defaults.
    const defaults = await owner.call('POST', DEEP, { inputs: { question: 'Defaults please' } });
    const plain = (await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${defaults.body.root}`)).json()).task;
    expect(plain.body).toMatch(/4 sub-questions/);
    await finish(defaults.body.root);
    await until(owner, async () => (await timelineOf(owner, defaults.body.root)).length === 2);
    const second = (await timelineOf(owner, defaults.body.root))[1];
    expect((await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${second.taskId}`)).json()).task.body).toMatch(/Do 2 rounds for each/);
  });
});

const REPORT = '# Tidal turbines at five years\n\nBlades lose 3% of their output a year [1], mostly to biofouling [2].\n\n## Sources\n\n1. https://example.org/blades — Blade wear\n2. https://example.org/fouling — Biofouling\n';

/** Runs Deep Research to its last stage and returns the root, the last stage's task and the finished plan and search tasks. */
async function researchTo(owner: Owner, question: string): Promise<{ root: string; synthesise: string }> {
  const { root } = (await owner.call('POST', DEEP, { inputs: { question } })).body;
  await owner.passed();
  await finish(root);
  await until(owner, async () => (await timelineOf(owner, root)).length === 2);
  await finish((await timelineOf(owner, root))[1].taskId);
  await until(owner, async () => (await timelineOf(owner, root)).length === 3);
  return { root, synthesise: (await timelineOf(owner, root))[2].taskId };
}

/** Waits, on the captures that follow the engine's passes, until the store lists `count` artifacts. */
async function kept(owner: Owner, count: number, query = ''): Promise<Record<string, any>[]> {
  for (;;) {
    const before = owner.captures();
    const { artifacts } = (await owner.call('GET', `/_caduceus/api/artifacts${query}`)).body;
    if (artifacts.length >= count) return artifacts;
    await owner.captured(before + 1);
  }
}

describe('capturing a research report', () => {
  test('the report attached to the last stage is kept when that task is done, with its metadata and the run it came from, and the task itself is not copied', async () => {
    const owner = await start();
    const { root, synthesise } = await researchTo(owner, 'How do tidal turbines age?');
    await attach(synthesise, 'report.md', REPORT, 'text/markdown');
    expect((await owner.call('GET', `/_caduceus/api/artifacts?sourceId=${root}`)).body.artifacts).toEqual([]);
    await finish(synthesise);
    const [artifact] = await kept(owner, 1, `?source=run&sourceId=${root}`);
    expect(artifact).toMatchObject({
      name: 'report.md',
      title: 'Tidal turbines at five years',
      kind: 'markdown',
      mime: 'text/markdown; charset=utf-8',
      size: Buffer.byteLength(REPORT),
      pinned: false,
      source: { type: 'run', id: root, board: 'default', playbook: 'deep-research', taskId: synthesise, label: 'Deep Research' },
    });
    expect(Math.abs(artifact.createdAt - Date.now())).toBeLessThan(60_000);
    expect(Object.keys(artifact).sort()).toEqual(['createdAt', 'id', 'kind', 'mime', 'name', 'pinned', 'size', 'source', 'title']);

    const content = await fetch(`${owner.url}/_caduceus/api/artifacts/${artifact.id}/content`, { headers: { cookie: owner.cookie } });
    expect(await content.text()).toBe(REPORT);
    expect(content.headers.get('content-type')).toBe('text/markdown; charset=utf-8');

    // Hermes still holds the task and its file: the store holds a file and a name, not a second copy of the task.
    const attachments = (await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${synthesise}/attachments`)).json()).attachments;
    expect(attachments).toHaveLength(1);
  });

  test('only a stage marked as a deliverable is captured, and a restart keeps nothing twice, nor what the owner deleted', async () => {
    const owner = await start();
    const { root, synthesise } = await researchTo(owner, 'Restarts');
    const search = (await timelineOf(owner, root))[1].taskId;
    await attach(search, 'notes.md', '# Scratch notes', 'text/markdown');
    await attach(synthesise, 'report.md', REPORT, 'text/markdown');
    await attach(synthesise, 'appendix.txt', 'raw numbers', 'text/plain');
    await finish(synthesise);
    const mine = `?source=run&sourceId=${root}`;
    const first = await kept(owner, 2, mine);
    expect(first.map((artifact) => artifact.name).sort()).toEqual(['appendix.txt', 'report.md']);

    // The owner deletes the appendix; the server restarts and sweeps the board again.
    const appendix = first.find((artifact) => artifact.name === 'appendix.txt')!;
    expect((await owner.call('DELETE', `/_caduceus/api/artifacts/${appendix.id}`)).status).toBe(200);
    await server!.close();
    server = undefined;
    const again = await start();
    // The first pass over the board after the restart sees the finished run again.
    await again.captured(1);
    expect((await again.call('GET', `/_caduceus/api/artifacts${mine}`)).body.artifacts.map((artifact: { name: string }) => artifact.name)).toEqual(['report.md']);
  });
});

/** A plain Kanban task with a file attached, kept as an artifact through the owner's own route. */
async function keep(owner: Owner, title: string, name: string, content: string | Uint8Array<ArrayBuffer>, type: string): Promise<Record<string, any>> {
  const made = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, triage: true }) });
  const task = (await made.json()).task.id as string;
  await attach(task, name, content, type);
  const [attachment] = (await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${task}/attachments`)).json()).attachments;
  const kept = await owner.call('POST', '/_caduceus/api/artifacts/from-task', { board: 'default', taskId: task, attachmentId: attachment.id });
  expect(kept.status).toBe(201);
  return kept.body.artifact;
}

describe('the Artifacts store', () => {
  test('a task’s attachment the owner chooses to keep is an artifact of source task, the list filters by source and kind, and the same file is not kept twice', async () => {
    const owner = await start();
    const note = await keep(owner, 'Wiring notes', 'wiring.txt', 'red to red', 'text/plain');
    const picture = await keep(owner, 'Wiring photo', 'photo.png', new Uint8Array([137, 80, 78, 71]), 'image/png');
    expect(note).toMatchObject({ kind: 'text', title: 'wiring.txt', source: { type: 'task', board: 'default', label: 'Wiring notes' } });
    expect(picture).toMatchObject({ kind: 'image', mime: 'image/png', size: 4 });
    const ids = (query: string) => owner.call('GET', `/_caduceus/api/artifacts${query}`).then(({ body }) => body.artifacts.map((artifact: { id: string }) => artifact.id));
    expect(await ids('?source=task')).toEqual(expect.arrayContaining([note.id, picture.id]));
    expect(await ids('?source=task&kind=image')).toEqual([picture.id]);
    expect(await ids(`?sourceId=${note.source.id}`)).toEqual([note.id]);
    expect(await ids('?source=session')).toEqual([]);
    expect((await owner.call('GET', '/_caduceus/api/artifacts?kind=spreadsheet')).status).toBe(400);
    const again = await owner.call('POST', '/_caduceus/api/artifacts/from-task', { board: 'default', taskId: note.source.taskId, attachmentId: (await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${note.source.taskId}/attachments`)).json()).attachments[0].id });
    expect(again.status).toBe(409);
    expect((await owner.call('POST', '/_caduceus/api/artifacts/from-task', { board: 'default', taskId: note.source.taskId, attachmentId: 99999 })).status).toBe(404);
  });

  test('HTML is served sandboxed and only as itself, a download asks to be saved, and a file of an unknown kind can only be downloaded', async () => {
    const owner = await start();
    const page = await keep(owner, 'Landing page', 'index.html', '<script>parent.steal()</script><h1>Hi</h1>', 'text/html');
    const archive = await keep(owner, 'Backup', 'backup.zip', new Uint8Array([80, 75, 3, 4]), 'application/zip');
    const pdf = await keep(owner, 'Brief', 'brief.pdf', '%PDF-1.4', 'application/pdf');
    const get = (id: string, query = '') => fetch(`${owner.url}/_caduceus/api/artifacts/${id}/content${query}`, { headers: { cookie: owner.cookie } });

    const html = await get(page.id);
    expect(page.kind).toBe('html');
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(html.headers.get('content-security-policy')).toMatch(/^sandbox;.*; frame-ancestors 'self'$/);
    expect(html.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');

    expect(archive.kind).toBe('file');
    const zip = await get(archive.id);
    expect(zip.headers.get('content-type')).toBe('application/octet-stream');
    expect(zip.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''backup.zip");

    expect((await get(pdf.id, '?download=1')).headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''brief.pdf");
    expect((await get(pdf.id)).headers.get('content-security-policy')).toMatch(/^default-src 'self';.*; frame-ancestors 'self'$/);
    expect((await get('0123456789abcdef')).status).toBe(404);
    expect((await get('../../etc/passwd')).status).toBe(404);
  });

  test('deleting an artifact is a T1 with an undo: it leaves the list at once, comes back within a minute, and its file is gone after that', async () => {
    const clock = { now: Date.now() };
    const owner = await start(clock);
    const doomed = await keep(owner, 'Draft notes', 'notes.txt', 'half a thought', 'text/plain');
    const filesOf = () => fs.readdirSync(path.join(hermes.home, 'caduceus', 'artifacts'));
    expect(filesOf()).toContain(doomed.id);

    const deleted = await owner.call('DELETE', `/_caduceus/api/artifacts/${doomed.id}`);
    expect(deleted).toMatchObject({ status: 200, body: { undoMs: 60_000, artifact: { id: doomed.id } } });
    expect((await owner.call('GET', '/_caduceus/api/artifacts?source=task')).body.artifacts.map((artifact: { id: string }) => artifact.id)).not.toContain(doomed.id);
    expect((await fetch(`${owner.url}/_caduceus/api/artifacts/${doomed.id}/content`, { headers: { cookie: owner.cookie } })).status).toBe(404);

    const restored = await owner.call('POST', `/_caduceus/api/artifacts/${doomed.id}/restore`);
    expect(restored).toMatchObject({ status: 200, body: { artifact: { id: doomed.id, name: 'notes.txt' } } });
    expect((await fetch(`${owner.url}/_caduceus/api/artifacts/${doomed.id}/content`, { headers: { cookie: owner.cookie } })).status).toBe(200);

    await owner.call('DELETE', `/_caduceus/api/artifacts/${doomed.id}`);
    clock.now += 61_000;
    expect((await owner.call('POST', `/_caduceus/api/artifacts/${doomed.id}/restore`)).status).toBe(404);
    expect(filesOf()).not.toContain(doomed.id);
    expect((await owner.call('DELETE', `/_caduceus/api/artifacts/${doomed.id}`)).status).toBe(404);
  });

  test('retention: a size cap removes the oldest artifacts first and skips the pinned ones, and what it removed is not captured again', async () => {
    const clock = { now: Date.now() };
    const owner = await start(clock);
    const block = (letter: string) => letter.repeat(400 * 1024);
    const settings = await owner.call('PUT', '/_caduceus/api/artifacts-settings', { capBytes: 1024 * 1024 });
    expect(settings).toMatchObject({ status: 200, body: { capBytes: 1024 * 1024 } });
    expect((await owner.call('PUT', '/_caduceus/api/artifacts-settings', { capBytes: 10 })).status).toBe(400);

    const names = async () => (await owner.call('GET', '/_caduceus/api/artifacts?source=task')).body.artifacts.map((artifact: { name: string }) => artifact.name).filter((name: string) => /^block-/.test(name)).sort();
    const oldest = await keep(owner, 'Block A', 'block-a.txt', block('a'), 'text/plain');
    clock.now += 1000;
    const second = await keep(owner, 'Block B', 'block-b.txt', block('b'), 'text/plain');
    clock.now += 1000;
    expect((await owner.call('PUT', `/_caduceus/api/artifacts/${oldest.id}/pin`, { pinned: true })).body.artifact.pinned).toBe(true);
    await keep(owner, 'Block C', 'block-c.txt', block('c'), 'text/plain');
    // Three blocks are 1.2 MiB under a 1 MiB cap; the pinned oldest stays and the next oldest goes.
    expect(await names()).toEqual(['block-a.txt', 'block-c.txt']);
    clock.now += 1000;
    await keep(owner, 'Block D', 'block-d.txt', block('d'), 'text/plain');
    expect(await names()).toEqual(['block-a.txt', 'block-d.txt']);
    const { usage } = (await owner.call('GET', '/_caduceus/api/artifacts')).body;
    expect(usage.capBytes).toBe(1024 * 1024);
    expect(usage.bytes).toBeLessThanOrEqual(1024 * 1024);

    // What the cap removed can be kept again on purpose (the cap then removes the next oldest); the pinned one is never the one that goes.
    const [attachment] = (await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${second.source.taskId}/attachments`)).json()).attachments;
    clock.now += 1000;
    expect((await owner.call('POST', '/_caduceus/api/artifacts/from-task', { board: 'default', taskId: second.source.taskId, attachmentId: attachment.id })).status).toBe(201);
    expect(await names()).toEqual(['block-a.txt', 'block-b.txt']);
    clock.now += 1000;
    await keep(owner, 'Block E', 'block-e.txt', block('e'), 'text/plain');
    await keep(owner, 'Block F', 'block-f.txt', block('f'), 'text/plain');
    expect(await names()).toContain('block-a.txt');
    expect(fs.readdirSync(path.join(hermes.home, 'caduceus', 'artifacts'))).toHaveLength((await owner.call('GET', '/_caduceus/api/artifacts')).body.artifacts.length);
  });

  test('a file a chat session worked on is kept as an artifact of source session, and only from where the owner may browse', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-artifacts-workspace-'));
    try {
      fs.writeFileSync(path.join(workspace, 'plan.md'), '# The plan\n\nShip it.\n');
      fs.writeFileSync(path.join(workspace, '.env'), 'SECRET=1\n');
      const owner = await start(undefined, [workspace]);
      const kept = await owner.call('POST', '/_caduceus/api/artifacts/from-session', { sessionId: '20261019_070000_ab12cd', profile: 'default', title: 'Planning chat', path: path.join(workspace, 'plan.md') });
      expect(kept).toMatchObject({ status: 201, body: { artifact: { name: 'plan.md', title: 'The plan', kind: 'markdown', source: { type: 'session', id: '20261019_070000_ab12cd', profile: 'default', label: 'Planning chat' } } } });
      expect((await owner.call('GET', '/_caduceus/api/artifacts?source=session&sourceId=20261019_070000_ab12cd')).body.artifacts).toHaveLength(1);

      expect((await owner.call('POST', '/_caduceus/api/artifacts/from-session', { sessionId: 's1', path: path.join(workspace, '.env') })).status).toBe(403);
      expect((await owner.call('POST', '/_caduceus/api/artifacts/from-session', { sessionId: 's1', path: '/etc/hosts' })).status).toBe(403);
      expect((await owner.call('POST', '/_caduceus/api/artifacts/from-session', { sessionId: 's1', path: path.join(workspace, 'missing.md') })).status).toBe(404);
      expect((await owner.call('POST', '/_caduceus/api/artifacts/from-session', { sessionId: 's1', path: 'relative.md' })).status).toBe(400);

      // Hermes lists a changed file from the repository's root; a chat working in a folder below it still finds the file.
      fs.mkdirSync(path.join(workspace, 'docs'));
      fs.mkdirSync(path.join(workspace, 'app', 'src'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'docs', 'notes.md'), '# Notes from the root\n');
      const below = await owner.call('POST', '/_caduceus/api/artifacts/from-session', { sessionId: 's1', cwd: path.join(workspace, 'app', 'src'), path: 'docs/notes.md' });
      expect(below).toMatchObject({ status: 201, body: { artifact: { name: 'notes.md', title: 'Notes from the root' } } });
      expect((await owner.call('POST', '/_caduceus/api/artifacts/from-session', { sessionId: 's1', cwd: path.join(workspace, 'app'), path: 'docs/missing.md' })).status).toBe(404);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
