import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseStageTag, type RunDetail, type RunSummary } from '@caduceus/contracts/playbook-runs';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { openEventStream } from './fixtures/event-stream.ts';
import type { InboxNotice, InboxState } from '@caduceus/contracts/inbox';

// Running a playbook through the Caduceus server (M6 #02): the HTTP API as the browser calls it, in front of a real Hermes Kanban in a throwaway
// HERMES_HOME, with the engine on. Stage tasks have no assignee, so Hermes's dispatcher leaves them alone, and no model is called: a test finishes a stage
// the way a worker's completion would, through Hermes's own status change. The server restarts mid-run, with and without its store.
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
  call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> & { run: RunDetail; runs: RunSummary[]; problems: string[]; root: string; board: string; ref: string } }>;
  /** Resolves after the engine's next pass over a board. */
  passed(): Promise<void>;
}

async function start(previous?: Owner): Promise<Owner> {
  let looked = Promise.withResolvers<void>();
  server = await startCaduceusServer({
    backend: hermes.backend,
    hermesRoot: hermes.home,
    inboxPollMs: 25,
    inboxReadMs: 60_000,
    playbookEngine: {
      sweepMs: 0,
      looked: () => {
        looked.resolve();
        looked = Promise.withResolvers<void>();
      },
    },
  });
  const { url } = server;
  const cookie = await ownerCookie(url);
  void previous;
  return {
    url,
    cookie,
    passed: () => looked.promise,
    async call(method, route, body) {
      const response = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : undefined };
    },
  };
}

const RUNS = '/_caduceus/api/work/playbook-runs';
const RESEARCH = '/_caduceus/api/work/playbooks/research-summarise/runs';

async function finish(id: string): Promise<void> {
  const response = await hermes.backend.fetch(`/api/plugins/kanban/tasks/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done', result: 'finished', summary: 'finished' }) });
  expect(response.status).toBe(200);
}

/** The stages of a run's tasks, in the order the timeline lists them. */
const stagesOf = async (owner: Owner, root: string) => (await owner.call('GET', `${RUNS}/${root}`)).body.run.timeline.map((entry) => `${entry.stage}:${entry.attempt}:${entry.status}`);

/** Waits, on the engine's passes, until `done()` holds. */
async function until(owner: Owner, done: () => Promise<boolean>): Promise<void> {
  for (let held = await done(); !held; held = await done()) await owner.passed();
}

describe('running a playbook through the server', () => {
  test('starting the Research → summarise seed makes its first stage on the board with the topic filled in, the run is listed and shown, and the stages follow one another to the end on Kanban events alone', async () => {
    const owner = await start();
    const started = await owner.call('POST', RESEARCH, { inputs: { topic: 'tidal energy', audience: 'a board of directors' } });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ board: 'default', ref: 'research-summarise@1' });
    const root = started.body.root;

    const list = (await owner.call('GET', RUNS)).body.runs;
    expect(list.find((run) => run.root === root)).toMatchObject({ board: 'default', playbook: { id: 'research-summarise', version: 1, name: 'Research → summarise' }, state: 'running', stagesDone: 0, stagesTotal: 3, title: 'Plan the research: tidal energy' });
    const detail = (await owner.call('GET', `${RUNS}/${root}`)).body.run;
    expect(detail.inputs).toEqual({ topic: 'tidal energy', audience: 'a board of directors' });
    expect(detail.definition.stages.map((stage) => stage.key)).toEqual(['plan', 'research', 'summarise']);
    expect(detail.timeline).toEqual([expect.objectContaining({ stage: 'plan', attempt: 1, taskId: root, status: 'ready' })]);

    // The first pass of the engine has seen the board; from here a stage that ends is followed by its successor.
    await owner.passed();
    await finish(root);
    await until(owner, async () => (await stagesOf(owner, root)).length === 2);
    expect(await stagesOf(owner, root)).toEqual(['plan:1:done', 'research:1:ready']);
    const second = (await owner.call('GET', `${RUNS}/${root}`)).body.run.timeline[1];
    expect(second.title).toBe('Research: tidal energy');
    await finish(second.taskId);
    await until(owner, async () => (await stagesOf(owner, root)).length === 3);
    const third = (await owner.call('GET', `${RUNS}/${root}`)).body.run.timeline[2];
    await finish(third.taskId);
    await until(owner, async () => (await owner.call('GET', `${RUNS}/${root}`)).body.run.state === 'done');
    expect(await stagesOf(owner, root)).toEqual(['plan:1:done', 'research:1:done', 'summarise:1:done']);
  }, HERMES_WORK_TIMEOUT_MS);

  test('bad inputs, an unknown playbook and an unknown run are refused plainly', async () => {
    const owner = await start();
    expect(await owner.call('POST', RESEARCH, { inputs: {} })).toMatchObject({ status: 400, body: { problems: ['Answer “What do you want to know?”.'] } });
    expect(await owner.call('POST', RESEARCH, { inputs: { topic: 'x', mood: 'y' } })).toMatchObject({ status: 400, body: { problems: ['“mood” is not one of this playbook’s questions.'] } });
    expect(await owner.call('POST', RESEARCH, { inputs: { topic: 3 } })).toMatchObject({ status: 400 });
    expect((await owner.call('POST', '/_caduceus/api/work/playbooks/no-such/runs', { inputs: {} })).status).toBe(404);
    expect((await owner.call('POST', `${RESEARCH}`, { inputs: { topic: 'x' }, version: 7 })).status).toBe(404);
    expect((await owner.call('GET', `${RUNS}/t_missing`)).status).toBe(404);
  });

  test('killing the server mid-run and starting it again loses nothing, even with the Caduceus store deleted but for the definitions: no duplicate stage task', async () => {
    const first = await start();
    const { root } = (await first.call('POST', RESEARCH, { inputs: { topic: 'restarts' } })).body;
    await first.passed();
    await finish(root);
    await until(first, async () => (await stagesOf(first, root)).length === 2);
    await server!.close();
    server = undefined;

    // Only the definitions survive: the owner, the sessions and every other Caduceus file are gone.
    const caduceus = path.join(hermes.home, 'caduceus');
    for (const entry of fs.readdirSync(caduceus)) if (entry !== 'playbooks') fs.rmSync(path.join(caduceus, entry), { recursive: true, force: true });
    const second = await start();
    const research = (await second.call('GET', `${RUNS}/${root}`)).body.run.timeline[1];
    await finish(research.taskId);
    await until(second, async () => (await stagesOf(second, root)).length === 3);
    expect(await stagesOf(second, root)).toEqual(['plan:1:done', 'research:1:done', 'summarise:1:ready']);

    const board: { columns: { tasks: { id: string; idempotency_key: string | null }[] }[] } = await (await hermes.backend.fetch('/api/plugins/kanban/board')).json();
    // The root's own key carries a nonce, not the root's id (it cannot know it); every later task's key names the root.
    const keys = board.columns.flatMap((column) => column.tasks).filter((task) => task.id === root || parseStageTag(task.idempotency_key)?.run === root).map((task) => task.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(3);
  });
});

describe('the owner’s decisions from the Inbox', () => {
  test('a gate is an Inbox item with Approve and Reject + note; rejecting makes the rework with the note in its brief, a rejection past max_attempts stops the run with an Inbox item, and acknowledging clears it', async () => {
    const owner = await start();
    const stream = await openEventStream(owner.url, '/_caduceus/api/inbox/stream', owner.cookie);
    try {
      let state: InboxState | undefined;
      const inbox = async (match: (state: InboxState) => boolean): Promise<InboxState> => {
        for (;;) {
          if (state && match(state)) return state;
          const event = await stream.next();
          if (event.event === 'inbox') state = event.data as InboxState;
        }
      };
      const noticeFor = (state: InboxState, title: string) => state.items.find((item): item is InboxNotice => item.kind === 'notice' && item.title === title);
      const decide = async (item: InboxNotice, action: string, body?: Record<string, unknown>) => {
        const chosen = item.actions.find((candidate) => candidate.id === action)!;
        const res = await fetch(`${owner.url}${chosen.request.path}`, { method: chosen.request.method, headers: { cookie: owner.cookie, origin: owner.url, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        expect(res.status).toBe(200);
      };

      const made = await owner.call('POST', '/_caduceus/api/work/playbooks', {
        name: 'Gate in the inbox',
        category: 'general',
        inputs: [{ key: 'topic', label: 'Topic', required: true }],
        stages: [
          { key: 'draft', title: 'Draft {{topic}}', brief: { goal: 'Write it' }, max_attempts: 2 },
          { key: 'review', title: 'Decide {{topic}}', brief: { goal: 'Decide' }, gate: 'approval' },
        ],
        edges: [{ from: 'draft', to: 'review', when: 'on_done' }, { from: 'review', to: 'draft', when: 'on_reject' }],
      });
      expect(made.status).toBe(201);
      const { root } = (await owner.call('POST', '/_caduceus/api/work/playbooks/gate-in-the-inbox/runs', { inputs: { topic: 'launch' } })).body;
      await owner.passed();

      await finish(root);
      const first = noticeFor(await inbox((current) => noticeFor(current, 'Review: Decide launch') !== undefined), 'Review: Decide launch')!;
      expect(first.actions.map((action) => action.id)).toEqual(['approve', 'reject']);
      await decide(first, 'reject', { note: 'Lead with the date.' });
      await until(owner, async () => (await stagesOf(owner, root)).length === 3);
      const rework = (await owner.call('GET', `${RUNS}/${root}`)).body.run.timeline.find((entry) => entry.stage === 'draft' && entry.attempt === 2)!;
      const body = (await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${rework.taskId}`)).json()).task.body as string;
      expect(body).toContain('## Review note\n\nLead with the date.');

      await finish(rework.taskId);
      await until(owner, async () => (await stagesOf(owner, root)).some((line) => line.startsWith('review:2')));
      const gate2 = (await owner.call('GET', `${RUNS}/${root}`)).body.run.timeline.find((entry) => entry.stage === 'review' && entry.attempt === 2)!;
      const second = (await inbox((current) => current.items.some((item) => item.ref === `task:default:${gate2.taskId}`))).items.find((item) => item.ref === `task:default:${gate2.taskId}`) as InboxNotice;
      await decide(second, 'reject', { note: 'Still no.' });
      const stopped = noticeFor(await inbox((current) => noticeFor(current, 'Playbook run stopped: Draft launch') !== undefined), 'Playbook run stopped: Draft launch')!;
      expect(stopped).toMatchObject({ group: 'failed' });
      expect((await owner.call('GET', `${RUNS}/${root}`)).body.run.state).toBe('failed');
      await decide(stopped, 'acknowledge');
      await inbox((current) => noticeFor(current, 'Playbook run stopped: Draft launch') === undefined);
    } finally {
      stream.close();
    }
  }, 90_000);
});
