import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { parseStageTag } from '@caduceus/contracts/playbook-runs';
import { readPlaybook, type Playbook } from '@caduceus/contracts/playbooks';
import { createPlaybookEngine, StartRefused, type PlaybookEngine, type WorkflowCapabilities } from '../src/playbook-engine.ts';
import { hermesKanban, type KanbanPort } from '../src/playbook-kanban.ts';
import { createLease } from '../src/playbook-lease.ts';
import { SEED_PLAYBOOKS } from '../src/playbook-seeds.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

// The playbook engine (M6 #02) against a real Hermes Kanban in a throwaway HERMES_HOME: its stage tasks are made with Hermes's own create, finished
// with Hermes's own status change, and read back from the board. No worker runs (the stage tasks have no assignee, so Hermes's dispatcher leaves
// them alone) and no model is called. Every playbook has an id of its own, so the tasks of one test are never another's run.
let hermes: TestHermes;
let kanban: KanbanPort;
const temp: string[] = [];
const engines: PlaybookEngine[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  kanban = hermesKanban(hermes.backend);
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()));
  for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
/** A linear playbook of the given stages with an id no other test uses. */
function linear(stages: string[], more: Partial<Playbook['stages'][number]> = {}): Playbook {
  counter += 1;
  const reading = readPlaybook({
    id: `chain-${counter}`,
    version: 1,
    name: `Chain ${counter}`,
    category: 'general',
    inputs: [{ key: 'topic', label: 'Topic', required: true }],
    stages: stages.map((key) => ({ key, title: `${key}: {{topic}}`, brief: { goal: `Do ${key} for {{topic}}` }, ...more })),
    edges: stages.slice(1).map((key, index) => ({ from: stages[index], to: key, when: 'on_done' })),
  });
  if (reading.playbook === undefined) throw new Error(reading.problems.join(' '));
  return reading.playbook;
}

const NO_NATIVE: WorkflowCapabilities = { nativeTags: false, nativeRouting: false };

interface Rig {
  engine: PlaybookEngine;
  clock: { now: number };
}

function rig(playbooks: Playbook[], { lease = 'engine-a', dir, capabilities = NO_NATIVE, watch = false, port = kanban, clock = { now: 1_000_000 } }: { lease?: string; dir?: string; capabilities?: WorkflowCapabilities; watch?: boolean; port?: KanbanPort; clock?: { now: number } } = {}): Rig {
  const folder = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-engine-'));
  if (dir === undefined) temp.push(folder);
  const engine = createPlaybookEngine({
    kanban: port,
    source: { get: (id, version) => playbooks.find((playbook) => playbook.id === id && playbook.version === version) },
    lease: createLease({ file: path.join(folder, 'engine.lease'), owner: lease, ttlMs: 30_000, now: () => clock.now }),
    capabilities: () => capabilities,
    sweepMs: 0,
    watch,
    settleMs: 0,
  });
  engines.push(engine);
  return { engine, clock };
}

interface Row {
  id: string;
  status: string;
  title: string;
  body: string | null;
  key: string | null;
}

/** The board's tasks of one playbook, in stage order (then by attempt). */
async function tasksOf(playbook: Playbook): Promise<Row[]> {
  const { tasks } = await kanban.tasks('default');
  const place = (key: string | null) => {
    const tag = parseStageTag(key)!;
    return playbook.stages.findIndex((stage) => stage.key === tag.stage) * 1000 + tag.attempt;
  };
  return tasks
    .filter((task) => parseStageTag(task.idempotencyKey)?.playbook === playbook.id)
    .sort((a, b) => place(a.idempotencyKey) - place(b.idempotencyKey))
    .map((task) => ({ id: task.id, status: task.status, title: task.title, body: task.body, key: task.idempotencyKey }));
}

const stageOf = (row: Row) => parseStageTag(row.key)!.stage;

/** Finishes a task the way a worker's completion does: through Hermes's own status change. */
async function finish(id: string): Promise<void> {
  const response = await hermes.backend.fetch(`/api/plugins/kanban/tasks/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done', result: 'finished', summary: 'finished' }) });
  expect(response.status).toBe(200);
}

describe('starting a run', () => {
  test('makes the first stage’s task with the stage’s text filled from the inputs, a key that names playbook, version, stage and attempt, and the inputs in its body', async () => {
    const playbook = linear(['plan', 'build']);
    const { engine } = rig([playbook]);
    const started = await engine.start(playbook, { topic: 'the export' });

    const [first, ...rest] = await tasksOf(playbook);
    expect(rest).toEqual([]);
    expect(started).toEqual({ root: first.id, board: 'default' });
    expect(first.title).toBe('plan: the export');
    expect(first.body).toMatch(/^## Goal\n\nDo plan for the export\n/);
    expect(first.key).toMatch(new RegExp(`^caduceus-playbook:${playbook.id}@1:root-[0-9a-f]{16}:plan:1$`));
    expect(first.body).toContain('<!-- caduceus-playbook-inputs: {"topic":"the export"} -->');
  });

  test('refuses inputs the playbook does not accept, and makes nothing', async () => {
    const playbook = linear(['plan']);
    const { engine } = rig([playbook]);
    await expect(engine.start(playbook, {})).rejects.toThrow(StartRefused);
    await expect(engine.start(playbook, { topic: 'x', colour: 'red' })).rejects.toMatchObject({ problems: ['“colour” is not one of this playbook’s questions.'] });
    await expect(engine.start(playbook, { topic: '   ' })).rejects.toMatchObject({ problems: ['Answer “Topic”.'] });
    expect(await tasksOf(playbook)).toEqual([]);
  });

  test('every run is its own: the same playbook started twice makes two roots', async () => {
    const playbook = linear(['plan']);
    const { engine } = rig([playbook]);
    const one = await engine.start(playbook, { topic: 'a' });
    const two = await engine.start(playbook, { topic: 'a' });
    expect(one.root).not.toBe(two.root);
    expect((await engine.runs()).filter((run) => run.playbook.id === playbook.id).map((run) => run.root).sort()).toEqual([one.root, two.root].sort());
  });

  test('a stage that sets what only the command line can set (a retry limit, a completion contract) is still made, once, with its key', async () => {
    const playbook = linear(['ship'], { max_retries: 2, completion_contract: 'local-only', reasoning_effort: 'low' });
    const { engine } = rig([playbook]);
    const { root } = await engine.start(playbook, { topic: 'x' });
    const detail = await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${root}`)).json();
    expect(detail.task).toMatchObject({ max_retries: 2, completion_contract: 'local-only', reasoning_effort: 'low', idempotency_key: expect.stringContaining(`${playbook.id}@1:root-`) });
  });
});

describe('a run started as a profile', () => {
  test('gives every stage that names no profile to that profile, on every later stage too, and leaves a stage with its own profile alone', async () => {
    const base = linear(['plan', 'build', 'check']);
    const playbook = readPlaybook({ ...base, stages: base.stages.map((stage) => (stage.key === 'build' ? { ...stage, assignee: 'reviewer' } : stage)) }).playbook!;
    const { engine } = rig([playbook]);
    const { root } = await engine.start(playbook, { topic: 'who' }, { profile: 'coder' });
    await finish(root);
    await engine.sweep();
    const [, build] = await tasksOf(playbook);
    await finish(build.id);
    await engine.sweep();
    const board = (await kanban.tasks('default')).tasks.filter((task) => parseStageTag(task.idempotencyKey)?.playbook === playbook.id);
    expect(Object.fromEntries(board.map((task) => [parseStageTag(task.idempotencyKey)!.stage, task.assignee]))).toEqual({ plan: 'coder', build: 'reviewer', check: 'coder' });
  });
});

describe('advancing a linear run', () => {
  test('the sweep makes each next stage when one is done, linked to its predecessor, with the same inputs filled in, and a second sweep makes nothing more', async () => {
    const playbook = linear(['plan', 'build', 'check']);
    const { engine } = rig([playbook]);
    const { root } = await engine.start(playbook, { topic: 'the export' });
    await engine.sweep();
    expect(await tasksOf(playbook)).toHaveLength(1);

    await finish(root);
    await engine.sweep();
    await engine.sweep();
    const afterOne = await tasksOf(playbook);
    expect(afterOne.map(stageOf)).toEqual(['plan', 'build']);
    expect(afterOne[1].title).toBe('build: the export');
    expect(parseStageTag(afterOne[1].key)).toMatchObject({ run: root, stage: 'build', attempt: 1 });
    expect((await kanban.detail('default', root))?.children).toEqual([afterOne[1].id]);

    await finish(afterOne[1].id);
    await engine.sweep();
    await finish((await tasksOf(playbook))[2].id);
    await engine.sweep();
    expect((await tasksOf(playbook)).map((row) => [stageOf(row), row.status])).toEqual([['plan', 'done'], ['build', 'done'], ['check', 'done']]);
    expect((await engine.runs()).find((run) => run.root === root)).toMatchObject({ state: 'done', stagesDone: 3, stagesTotal: 3, playbook: { id: playbook.id, version: 1 } });
  });

  test('the Kanban events stream moves a run along by itself, with no sweep', async () => {
    const playbook = linear(['plan', 'build']);
    const { engine } = rig([playbook], { watch: true });
    const { root } = await engine.start(playbook, { topic: 'live' });
    // The first pass sees the stage and starts watching the board from its latest event.
    const first = once(engine, 'reconciled');
    engine.begin();
    await first;

    await finish(root);
    for (let made = (await tasksOf(playbook)).length; made < 2; made = (await tasksOf(playbook)).length) await once(engine, 'reconciled');
    expect((await tasksOf(playbook)).map(stageOf)).toEqual(['plan', 'build']);
  });

  test('a missed event is made up for by the next sweep: with no stream, finishing a stage moves nothing until the sweep', async () => {
    const playbook = linear(['plan', 'build']);
    const { engine } = rig([playbook], { watch: false });
    const { root } = await engine.start(playbook, { topic: 'quiet' });
    engine.begin();
    await once(engine, 'reconciled');
    await finish(root);
    expect(await tasksOf(playbook)).toHaveLength(1);
    await engine.sweep();
    expect((await tasksOf(playbook)).map(stageOf)).toEqual(['plan', 'build']);
  });

  test('a run keeps no state of its own: a second engine that never saw it takes it up where the first left it, with no duplicate stage task', async () => {
    const playbook = linear(['plan', 'build', 'check']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-engine-'));
    temp.push(dir);
    const first = rig([playbook], { dir });
    const { root } = await first.engine.start(playbook, { topic: 'restart' });
    await finish(root);
    await first.engine.sweep();
    await first.engine.stop();

    // A new engine, a new lease owner, nothing in memory: it reads Hermes and goes on.
    const second = rig([playbook], { dir, lease: 'engine-b' });
    await second.engine.sweep();
    await second.engine.sweep();
    const [, build] = await tasksOf(playbook);
    expect((await tasksOf(playbook)).map(stageOf)).toEqual(['plan', 'build']);
    await finish(build.id);
    await second.engine.sweep();
    expect((await tasksOf(playbook)).map(stageOf)).toEqual(['plan', 'build', 'check']);
    expect(new Set((await tasksOf(playbook)).map((row) => row.key)).size).toBe(3);
  });

  test('two passes at once (the second engine’s sweep racing the first’s) still make each stage once', async () => {
    const playbook = linear(['plan', 'build']);
    const clock = { now: 1_000_000 };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-engine-'));
    temp.push(dir);
    const a = rig([playbook], { dir, clock });
    const b = rig([playbook], { dir, clock, lease: 'engine-b' });
    const { root } = await a.engine.start(playbook, { topic: 'race' });
    await finish(root);
    await Promise.all([a.engine.sweep(), b.engine.sweep(), a.engine.sweep()]);
    expect((await tasksOf(playbook)).map(stageOf)).toEqual(['plan', 'build']);
  });
});

describe('the single-writer lease', () => {
  test('a second engine stays passive while the first holds the lease, and takes over once it has expired', async () => {
    const playbook = linear(['plan', 'build']);
    const clock = { now: 1_000_000 };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-engine-'));
    temp.push(dir);
    const a = rig([playbook], { dir, clock });
    const b = rig([playbook], { dir, clock, lease: 'engine-b' });
    const { root } = await a.engine.start(playbook, { topic: 'lease' });
    await a.engine.sweep();
    await finish(root);

    await b.engine.sweep();
    expect(await tasksOf(playbook)).toHaveLength(1);

    clock.now += 31_000;
    await b.engine.sweep();
    expect((await tasksOf(playbook)).map(stageOf)).toEqual(['plan', 'build']);
    // The first has lost it and stays out while the second keeps it.
    const [, build] = await tasksOf(playbook);
    await finish(build.id);
    await a.engine.sweep();
    expect(await tasksOf(playbook)).toHaveLength(2);
  });
});

describe('handing routing to Hermes', () => {
  test('when Hermes routes workflows natively the engine stops advancing runs, and picks them up again if that goes away; the definition does not change', async () => {
    const playbook = linear(['plan', 'build']);
    const capabilities = { ...NO_NATIVE };
    const { engine } = rig([playbook], { capabilities });
    const { root } = await engine.start(playbook, { topic: 'native' });
    await finish(root);

    capabilities.nativeRouting = true;
    await engine.sweep();
    expect(await tasksOf(playbook)).toHaveLength(1);

    capabilities.nativeRouting = false;
    await engine.sweep();
    expect(await tasksOf(playbook)).toHaveLength(2);
  });

  test('when Hermes accepts the native workflow fields on create the engine writes them too, and does not while it does not', async () => {
    const playbook = linear(['plan', 'build']);
    const created: Record<string, unknown>[] = [];
    const recording: KanbanPort = { ...kanban, create: (board, fields, options) => (created.push(fields), kanban.create(board, fields, options)) };
    const capabilities = { ...NO_NATIVE };
    const { engine } = rig([playbook], { port: recording, capabilities });
    await engine.start(playbook, { topic: 'plain' });
    expect(created[0]).not.toHaveProperty('workflow_template_id');

    capabilities.nativeTags = true;
    const { root } = await engine.start(playbook, { topic: 'tagged' });
    expect(created[1]).toMatchObject({ workflow_template_id: `${playbook.id}@1`, current_step_key: 'plan' });
    await finish(root);
    await engine.sweep();
    expect(created.at(-1)).toMatchObject({ workflow_template_id: `${playbook.id}@1`, current_step_key: 'build' });
  });
});

// Gates, verdicts and loops (M6 #03), against Hermes Kanban: the owner's decisions are made the way the Inbox makes them (a comment by the owner, then
// Hermes's own status change), and the engine reads them back from Kanban alone.
function gated(more: Record<string, unknown> = {}): Playbook {
  counter += 1;
  const reading = readPlaybook({
    id: `gated-${counter}`,
    version: 1,
    name: `Gated ${counter}`,
    category: 'general',
    inputs: [{ key: 'topic', label: 'Topic', required: true }],
    stages: [
      { key: 'draft', title: 'Draft {{topic}}', brief: { goal: 'Write {{topic}}' }, max_attempts: 3 },
      { key: 'review', title: 'Review {{topic}}', brief: { goal: 'Decide' }, gate: 'approval' },
      { key: 'ship', title: 'Ship {{topic}}', brief: { goal: 'Ship' } },
    ],
    edges: [
      { from: 'draft', to: 'review', when: 'on_done' },
      { from: 'review', to: 'ship', when: 'on_approve' },
      { from: 'review', to: 'draft', when: 'on_reject' },
    ],
    ...more,
  });
  if (reading.playbook === undefined) throw new Error(reading.problems.join(' '));
  return reading.playbook;
}

async function patch(id: string, body: Record<string, unknown>): Promise<void> {
  const response = await hermes.backend.fetch(`/api/plugins/kanban/tasks/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status, await response.clone().text()).toBe(200);
}

/** The Inbox's Reject + note, as the server runs it: the note is a comment by the owner, and the task goes back to ready. */
async function reject(id: string, note: string): Promise<void> {
  await hermes.backend.fetch(`/api/plugins/kanban/tasks/${id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: note, author: 'owner' }) });
  await patch(id, { status: 'ready' });
}

const APPROVED = 'Approved by the owner from Caduceus.';
const rowOf = async (playbook: Playbook, stage: string, attempt = 1) => (await tasksOf(playbook)).find((row) => parseStageTag(row.key)?.stage === stage && parseStageTag(row.key)?.attempt === attempt);

describe('a human gate', () => {
  test('is made in review, unassigned, once the stage before it is done; approving it moves the run on to on_approve', async () => {
    const playbook = gated();
    const { engine } = rig([playbook]);
    const { root } = await engine.start(playbook, { topic: 'post' });
    await finish(root);
    await engine.sweep();
    const gate = (await rowOf(playbook, 'review'))!;
    expect(gate.status).toBe('review');
    const detail = await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${gate.id}`)).json();
    expect(detail.task.assignee).toBeNull();
    expect((await engine.runs()).find((run) => run.root === root)?.state).toBe('waiting');

    await patch(gate.id, { status: 'done', result: APPROVED, summary: APPROVED });
    await engine.sweep();
    expect((await tasksOf(playbook)).map(stageOf)).toEqual(['draft', 'review', 'ship']);
  });

  test('rejecting with a note makes a rework attempt whose brief carries the note, and the rejection is kept in Kanban as a verdict', async () => {
    const playbook = gated();
    const { engine } = rig([playbook]);
    const { root } = await engine.start(playbook, { topic: 'post' });
    await finish(root);
    await engine.sweep();
    const gate = (await rowOf(playbook, 'review'))!;
    await reject(gate.id, 'Too formal. Make it shorter.');
    await engine.sweep();

    const rework = (await rowOf(playbook, 'draft', 2))!;
    expect(rework.body).toContain('## Review note\n\nToo formal. Make it shorter.');
    expect(rework.status).toBe('ready');
    expect((await rowOf(playbook, 'review'))!.status).toBe('done');
    const run = (await engine.run('default', root))!;
    expect(run.timeline.map((entry) => [entry.stage, entry.attempt, entry.verdict ?? null])).toEqual([['draft', 1, 'passed'], ['review', 1, 'rejected'], ['draft', 2, null]]);
    expect(run.timeline[1].note).toBe('Too formal. Make it shorter.');
    // Doing it again makes nothing more.
    await engine.sweep();
    expect((await tasksOf(playbook)).filter((row) => stageOf(row) === 'draft')).toHaveLength(2);
  });

  test('rejections are counted from the stage’s tasks in Kanban: the attempt that would be over max_attempts stops the run with a failed task for the Inbox, and nothing loops on', async () => {
    const playbook = gated();
    const { engine } = rig([playbook]);
    const { root } = await engine.start(playbook, { topic: 'loop' });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await finish((await rowOf(playbook, 'draft', attempt))!.id);
      await engine.sweep();
      await reject((await rowOf(playbook, 'review', attempt))!.id, `Not yet ${attempt}`);
      await engine.sweep();
    }
    expect(await rowOf(playbook, 'draft', 4)).toBeUndefined();
    const stopped = (await tasksOf(playbook)).filter((row) => stageOf(row) === 'run_failed');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].title).toBe(`Playbook run stopped: Draft loop`);
    expect(stopped[0].body).toContain('all 3 of its attempts');
    await engine.sweep();
    await engine.sweep();
    expect((await tasksOf(playbook)).filter((row) => stageOf(row) === 'run_failed')).toHaveLength(1);
    expect((await engine.run('default', root))!.state).toBe('failed');
  });

  test('a restart in the middle of a gate and of a loop loses nothing: a new engine reads the same decisions and makes no duplicate', async () => {
    const playbook = gated();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-engine-'));
    temp.push(dir);
    const first = rig([playbook], { dir });
    const { root } = await first.engine.start(playbook, { topic: 'restart' });
    await finish(root);
    await first.engine.sweep();
    await first.engine.stop();
    // Mid-gate: the owner rejects while no engine is running.
    await reject((await rowOf(playbook, 'review'))!.id, 'Redo it.');
    const second = rig([playbook], { dir, lease: 'engine-b' });
    await second.engine.sweep();
    await second.engine.stop();
    // Mid-loop: a third engine finds the rework and the settled gate and adds nothing.
    const third = rig([playbook], { dir, lease: 'engine-c' });
    await third.engine.sweep();
    await third.engine.sweep();
    expect((await tasksOf(playbook)).map((row) => `${stageOf(row)}:${parseStageTag(row.key)!.attempt}`)).toEqual(['draft:1', 'draft:2', 'review:1']);
  });
});

describe('verdicts', () => {
  test('VERDICT: FAIL in a finished stage’s result routes on_fail, with why in the next attempt’s brief; a stage Hermes blocked is settled as failed and routed the same way', async () => {
    const playbook = linear(['build', 'check']);
    const withFail = readPlaybook({ ...playbook, stages: playbook.stages.map((stage) => ({ ...stage, max_attempts: 3 })), edges: [{ from: 'build', to: 'check', when: 'on_done' }, { from: 'check', to: 'build', when: 'on_fail' }, { from: 'build', to: 'build', when: 'on_fail' }] }).playbook!;
    const { engine } = rig([withFail]);
    const { root } = await engine.start(withFail, { topic: 'v' });
    await finish(root);
    await engine.sweep();
    const check = (await rowOf(withFail, 'check'))!;
    await patch(check.id, { status: 'done', result: 'Ran the suite.\nVERDICT: FAIL\n3 tests are red.', summary: 'failed' });
    await engine.sweep();
    const again = (await rowOf(withFail, 'build', 2))!;
    expect(again.body).toContain('## Why the earlier attempt failed');
    expect(again.body).toContain('3 tests are red.');

    // Hermes blocking the stage (its goal judge or contract gave up) is the same failure.
    await hermes.backend.fetch(`/api/plugins/kanban/tasks/${again.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'BLOCKED: turn budget exhausted', author: 'worker' }) });
    await patch(again.id, { status: 'blocked' });
    await engine.sweep();
    expect((await rowOf(withFail, 'build', 2))!.status).toBe('done');
    const third = (await rowOf(withFail, 'build', 3))!;
    expect(third.body).toContain('turn budget exhausted');
  });

  test('a failure with no on_fail edge stops the run for the Inbox', async () => {
    const playbook = linear(['one', 'two']);
    const { engine } = rig([playbook]);
    const { root } = await engine.start(playbook, { topic: 'x' });
    await patch(root, { status: 'done', result: 'VERDICT: FAIL\nnope', summary: 'x' });
    await engine.sweep();
    expect((await tasksOf(playbook)).filter((row) => stageOf(row) === 'run_failed')).toHaveLength(1);
  });
});

describe('a clarify gate', () => {
  test('is blocked with needs_input; answering it (a comment and an unblock) lets the run continue with the answer kept in Kanban', async () => {
    const playbook = readPlaybook({ ...linear(['plan', 'build']), stages: [{ key: 'ask', title: 'Question', brief: { goal: 'What colour?' }, gate: 'clarify' }, { key: 'build', title: 'Build', brief: { goal: 'Build' } }], edges: [{ from: 'ask', to: 'build', when: 'on_done' }], id: `ask-${counter}`, inputs: [] }).playbook!;
    const { engine } = rig([playbook]);
    await engine.start(playbook, {});
    await engine.sweep();
    const question = (await rowOf(playbook, 'ask'))!;
    expect(question.status).toBe('blocked');
    const shown = await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${question.id}`)).json();
    expect(shown.task.block_kind).toBe('needs_input');

    await reject(question.id, 'Blue.');
    await engine.sweep();
    expect((await rowOf(playbook, 'ask'))!.status).toBe('done');
    expect((await tasksOf(playbook)).map(stageOf)).toEqual(['ask', 'build']);
    expect((await engine.runs()).find((run) => run.playbook.id === playbook.id)?.state).toBe('running');
  });
});

describe('re-running from a stage', () => {
  test('makes a new attempt of that stage and leaves completed stages as they are', async () => {
    const playbook = linear(['plan', 'build', 'check']);
    const { engine } = rig([playbook]);
    const { root } = await engine.start(playbook, { topic: 'again' });
    await finish(root);
    await engine.sweep();
    const build = (await rowOf(playbook, 'build'))!;
    await finish(build.id);
    await engine.sweep();
    const before = (await tasksOf(playbook)).map((row) => [row.id, row.status]);

    const made = await engine.rerun('default', root, 'build');
    expect(made).toMatchObject({ stage: 'build', attempt: 2 });
    const after = await tasksOf(playbook);
    expect(after.map(stageOf)).toEqual(['plan', 'build', 'build', 'check']);
    expect(after.filter((row) => before.some(([id, status]) => id === row.id && status !== row.status))).toEqual([]);
    expect((await rowOf(playbook, 'build', 2))!.status).toBe('ready');
    await expect(engine.rerun('default', root, 'nowhere')).rejects.toThrow(StartRefused);
  });
});

describe('the Software delivery seed', () => {
  test('runs end to end against a real board with fake workers, through its clarify gate, its design approval, one rejection of the release (a loop back to implement with the note), and the release approval', async () => {
    const seed = SEED_PLAYBOOKS.find((candidate) => candidate.id === 'software-delivery')!;
    const { engine } = rig([seed]);
    const { root } = await engine.start(seed, { request: 'Add an export button', repo: '/tmp/none' });
    let rejectedRelease = false;
    for (let pass = 0; pass < 80; pass += 1) {
      await engine.sweep();
      const run = (await engine.run('default', root))!;
      if (run.state === 'done') break;
      for (const entry of run.timeline) {
        const stage = seed.stages.find((candidate) => candidate.key === entry.stage)!;
        if (entry.status === 'done') continue;
        if (stage.gate === 'clarify' && entry.status === 'blocked') await reject(entry.taskId, 'Use the existing style.');
        else if (stage.gate === 'approval' && entry.status === 'review') {
          if (entry.stage === 'release_approval' && !rejectedRelease) {
            rejectedRelease = true;
            await reject(entry.taskId, 'Add a changelog line first.');
          } else await patch(entry.taskId, { status: 'done', result: APPROVED, summary: APPROVED });
        } else if (stage.gate === undefined && entry.status === 'ready') await patch(entry.taskId, { status: 'done', result: 'Done.', summary: 'Done.' });
      }
    }
    const run = (await engine.run('default', root))!;
    expect(run.state).toBe('done');
    const stages = run.timeline.map((entry) => entry.stage);
    expect(new Set(stages).size).toBe(16);
    // The release was rejected once: implement ran twice, with the note in the second brief, and the checks after it ran again.
    expect(run.timeline.filter((entry) => entry.stage === 'implement').map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(run.timeline.find((entry) => entry.stage === 'release_approval' && entry.attempt === 1)).toMatchObject({ verdict: 'rejected', note: 'Add a changelog line first.' });
    expect((await rowOf(seed as unknown as Playbook, 'implement', 2))?.body).toContain('Add a changelog line first.');
    expect(run.timeline.filter((entry) => entry.stage === 'deploy')).toHaveLength(1);
  }, 120_000);
});

describe('parallel groups', () => {
  test('the branches are made together, the join starts only when every branch is done and has them all as parents, and a failing branch does not disturb the other', async () => {
    counter += 1;
    const playbook = readPlaybook({
      id: `fork-${counter}`,
      version: 1,
      name: 'Fork',
      category: 'general',
      inputs: [],
      stages: ['start', 'left', 'right', 'join', 'fixright'].map((key) => ({ key, title: key, brief: { goal: key }, ...(key === 'right' ? { max_attempts: 3 } : {}) })),
      edges: [
        { from: 'start', to: 'left', when: 'on_done' },
        { from: 'start', to: 'right', when: 'on_done' },
        { from: 'left', to: 'join', when: 'on_done' },
        { from: 'right', to: 'join', when: 'on_done' },
        { from: 'right', to: 'fixright', when: 'on_fail' },
        { from: 'fixright', to: 'right', when: 'on_done' },
      ],
    }).playbook!;
    const { engine } = rig([playbook]);
    const { root } = await engine.start(playbook, {});
    await finish(root);
    await engine.sweep();
    expect((await tasksOf(playbook)).map(stageOf)).toEqual(['start', 'left', 'right']);

    const left = (await rowOf(playbook, 'left'))!;
    const right = (await rowOf(playbook, 'right'))!;
    await finish(left.id);
    await engine.sweep();
    expect(await rowOf(playbook, 'join')).toBeUndefined();

    await patch(right.id, { status: 'done', result: 'VERDICT: FAIL\nthe tests are red', summary: 'x' });
    await engine.sweep();
    expect(await rowOf(playbook, 'join')).toBeUndefined();
    expect((await rowOf(playbook, 'left'))!.status).toBe('done');
    const fix = (await rowOf(playbook, 'fixright'))!;
    await finish(fix.id);
    await engine.sweep();
    const right2 = (await rowOf(playbook, 'right', 2))!;
    await finish(right2.id);
    await engine.sweep();
    const join = (await rowOf(playbook, 'join'))!;
    const shown = await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${join.id}`)).json();
    expect(shown.links.parents.sort()).toEqual([left.id, right2.id].sort());
    await engine.sweep();
    expect((await tasksOf(playbook)).filter((row) => stageOf(row) === 'join')).toHaveLength(1);
  });
});
