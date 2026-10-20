import { describe, expect, test } from 'vitest';
import { parseStageTag, stageTag, type RunTask, type StageTag } from '@caduceus/contracts/playbook-runs';
import { readPlaybook, type Playbook } from '@caduceus/contracts/playbooks';
import { groupRuns, planRun, runState } from '../src/playbook-plan.ts';

// What the playbook engine decides, as a pure function of the tasks Kanban holds (M6 #02): which stage tasks to make next, which run a task
// belongs to, and how a run stands. The engine keeps no state, so everything it does is this function applied to what Hermes says.
const chain: Playbook = (() => {
  const reading = readPlaybook({
    id: 'chain',
    version: 3,
    name: 'Chain',
    category: 'general',
    inputs: [],
    stages: ['a', 'b', 'c'].map((key) => ({ key, title: `Stage ${key}`, brief: { goal: key } })),
    edges: [{ from: 'a', to: 'b', when: 'on_done' }, { from: 'b', to: 'c', when: 'on_done' }],
  });
  return reading.playbook!;
})();

const ROOT = 't_root0001';
function task(id: string, stage: string, status: string, more: Partial<RunTask> & { attempt?: number; run?: string } = {}): RunTask {
  const { attempt = 1, run = ROOT, ...rest } = more;
  const tag: StageTag = { playbook: 'chain', version: 3, run, stage, attempt };
  return { id, status, title: `Stage ${stage}`, assignee: null, tag, children: [], createdAt: 1, completedAt: null, result: null, blockKind: null, failures: 0, lastFailure: null, ...rest };
}

describe('the tag in a task’s idempotency key', () => {
  test('names the playbook, its version, the run, the stage and the attempt, and reads back; anything else is not a playbook task', () => {
    const tag: StageTag = { playbook: 'software-delivery', version: 2, run: 't_ab12cd34', stage: 'design_review', attempt: 3 };
    expect(stageTag(tag)).toBe('caduceus-playbook:software-delivery@2:t_ab12cd34:design_review:3');
    expect(parseStageTag(stageTag(tag))).toEqual(tag);
    expect(parseStageTag(stageTag({ ...tag, run: 'root-0123456789ab' }))?.run).toBe('root-0123456789ab');
    for (const other of [null, undefined, '', 'mine', 'caduceus-playbook:x@0:t_1:a:1', 'caduceus-playbook:x@1:t_1:A:1', 'caduceus-playbook:x@1:t_1:a:0', 7]) expect(parseStageTag(other), String(other)).toBeUndefined();
  });
});

describe('planning a run', () => {
  test('a finished stage leads to the next, linked to it as its parent, and the key says which stage and attempt', () => {
    const plan = planRun(chain, [task('t_a', 'a', 'done')], ROOT).drafts;
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ attempt: 1, parents: ['t_a'], stage: { key: 'b' } });
    expect(stageTag(plan[0].tag)).toBe('caduceus-playbook:chain@3:t_root0001:b:1');
  });

  test('nothing is made while the stage is not done, or once its successor exists', () => {
    for (const status of ['ready', 'running', 'todo', 'blocked', 'review']) expect(planRun(chain, [task('t_a', 'a', status)], ROOT).drafts, status).toEqual([]);
    expect(planRun(chain, [task('t_a', 'a', 'done', { children: ['t_b'] }), task('t_b', 'b', 'ready')], ROOT).drafts).toEqual([]);
  });

  test('every finished stage is followed, so a missed event is made up for', () => {
    const tasks = [task('t_a', 'a', 'done', { children: ['t_b'] }), task('t_b', 'b', 'done')];
    expect(planRun(chain, tasks, ROOT).drafts.map((draft) => [draft.stage.key, draft.parents])).toEqual([['c', ['t_b']]]);
  });

  test('the last stage leads nowhere, and an `always` edge is followed like a done one', () => {
    expect(planRun(chain, [task('t_a', 'a', 'done', { children: ['t_b'] }), task('t_b', 'b', 'done', { children: ['t_c'] }), task('t_c', 'c', 'done')], ROOT).drafts).toEqual([]);
    const always = readPlaybook({ ...chain, edges: [{ from: 'a', to: 'b', when: 'always' }, { from: 'b', to: 'c', when: 'on_done' }] }).playbook!;
    expect(planRun(always, [task('t_a', 'a', 'done')], ROOT).drafts.map((draft) => draft.stage.key)).toEqual(['b']);
  });

  test('a task of another run, or of a stage the version does not have, is ignored', () => {
    expect(planRun(chain, [task('t_x', 'a', 'done', { run: 't_other' })], ROOT).drafts).toEqual([]);
    expect(planRun(chain, [task('t_z', 'zz', 'done')], ROOT).drafts).toEqual([]);
  });
});

describe('which run a task is in', () => {
  test('the root’s nonce makes the root task its own run, and every other task is in the run its key names', () => {
    const root = task('t_root0001', 'a', 'done', { run: 'root-0123456789ab' });
    const second = task('t_b', 'b', 'ready');
    const stranger = task('t_s', 'a', 'ready', { run: 't_elsewhere' });
    const groups = groupRuns([root, second, stranger]);
    expect([...groups.keys()].sort()).toEqual(['t_elsewhere', 't_root0001']);
    expect(groups.get('t_root0001')?.map((entry) => entry.id)).toEqual(['t_root0001', 't_b']);
  });
});

describe('how a run stands', () => {
  test('running until its last stage is done, then done', () => {
    expect(runState(chain, [task('t_a', 'a', 'running')])).toBe('running');
    expect(runState(chain, [task('t_a', 'a', 'done', { children: ['t_b'] }), task('t_b', 'b', 'ready')])).toBe('running');
    // The first stage is done and the second not made yet: still going, not finished.
    expect(runState(chain, [task('t_a', 'a', 'done')])).toBe('running');
    const all = [task('t_a', 'a', 'done', { children: ['t_b'] }), task('t_b', 'b', 'done', { children: ['t_c'] }), task('t_c', 'c', 'done')];
    expect(runState(chain, all)).toBe('done');
  });
});

// Gates, verdicts and loops (M6 #03): recorded Kanban states in, the next steps out.
const reviewLoop: Playbook = readPlaybook({
  id: 'loop',
  version: 1,
  name: 'Loop',
  category: 'general',
  inputs: [],
  stages: [
    { key: 'draft', title: 'Draft', brief: { goal: 'd' }, max_attempts: 3 },
    { key: 'review', title: 'Review', brief: { goal: 'r' }, gate: 'approval' },
    { key: 'ask', title: 'Ask', brief: { goal: 'q' }, gate: 'clarify' },
    { key: 'ship', title: 'Ship', brief: { goal: 's' } },
    { key: 'again', title: 'Again', brief: { goal: 'a' } },
  ],
  edges: [
    { from: 'draft', to: 'review', when: 'on_done' },
    { from: 'draft', to: 'draft', when: 'on_fail' },
    { from: 'review', to: 'ship', when: 'on_approve' },
    { from: 'review', to: 'draft', when: 'on_reject' },
    { from: 'ship', to: 'ask', when: 'on_done' },
    { from: 'ask', to: 'again', when: 'on_done' },
  ],
}).playbook!;

describe('gates', () => {
  test('an approved gate follows on_approve and not on_reject; a gate still in review waits', () => {
    expect(planRun(reviewLoop, [task('t_r', 'review', 'done', { result: 'Approved by the owner from Caduceus.' })], ROOT).drafts.map((draft) => draft.stage.key)).toEqual(['ship']);
    const waiting = planRun(reviewLoop, [task('t_r', 'review', 'review')], ROOT);
    expect(waiting).toEqual({ drafts: [], settle: [], prepare: [] });
    expect(runState(reviewLoop, [task('t_r', 'review', 'review')])).toBe('waiting');
  });

  test('a gate the Inbox sent back to ready is settled as rejected, and once settled leads to the rework with the note in its brief', () => {
    expect(planRun(reviewLoop, [task('t_r', 'review', 'ready')], ROOT).settle).toEqual([{ taskId: 't_r', kind: 'rejected' }]);
    const plan = planRun(reviewLoop, [task('t_d', 'draft', 'done', { children: ['t_r'] }), task('t_r', 'review', 'done', { result: 'VERDICT: REJECTED\n\nToo formal. Shorter.' })], ROOT);
    expect(plan.drafts).toHaveLength(1);
    expect(plan.drafts[0]).toMatchObject({ stage: { key: 'draft' }, attempt: 2, parents: ['t_r'], feedback: { heading: 'Review note', text: 'Too formal. Shorter.' } });
  });

  test('a gate made in Triage is prepared, a question the Inbox answered is settled as answered, and one still blocked waits', () => {
    expect(planRun(reviewLoop, [task('t_r', 'review', 'triage'), task('t_a', 'ask', 'triage')], ROOT).prepare).toEqual([{ taskId: 't_r', gate: 'approval' }, { taskId: 't_a', gate: 'clarify' }]);
    expect(planRun(reviewLoop, [task('t_a', 'ask', 'ready')], ROOT).settle).toEqual([{ taskId: 't_a', kind: 'answered' }]);
    expect(planRun(reviewLoop, [task('t_a', 'ask', 'blocked', { blockKind: 'needs_input' })], ROOT)).toEqual({ drafts: [], settle: [], prepare: [] });
    expect(planRun(reviewLoop, [task('t_a', 'ask', 'done', { result: 'ANSWERED\n\nBlue.' })], ROOT).drafts.map((draft) => draft.stage.key)).toEqual(['again']);
  });
});

describe('verdicts', () => {
  test('done passes; VERDICT: FAIL in the result routes on_fail with the reason; a stage Hermes blocked is settled as failed, a question or a wait is not', () => {
    expect(planRun(reviewLoop, [task('t_d', 'draft', 'done', { result: 'All good.' })], ROOT).drafts.map((draft) => draft.stage.key)).toEqual(['review']);
    const failed = planRun(reviewLoop, [task('t_d', 'draft', 'done', { result: 'Checked it.\nVERDICT: FAIL\nTests are red.' })], ROOT);
    expect(failed.drafts).toHaveLength(1);
    expect(failed.drafts[0]).toMatchObject({ stage: { key: 'draft' }, attempt: 2, feedback: { heading: 'Why the earlier attempt failed' } });
    expect(planRun(reviewLoop, [task('t_d', 'draft', 'blocked', { blockKind: null })], ROOT).settle).toEqual([{ taskId: 't_d', kind: 'failed' }]);
    expect(planRun(reviewLoop, [task('t_d', 'draft', 'blocked', { blockKind: 'capability' })], ROOT).settle).toHaveLength(1);
    expect(planRun(reviewLoop, [task('t_d', 'draft', 'blocked', { blockKind: 'needs_input' })], ROOT).settle).toEqual([]);
    expect(planRun(reviewLoop, [task('t_d', 'draft', 'running')], ROOT).settle).toEqual([]);
  });

  test('an attempt past max_attempts stops the run instead of making another, however it loops', () => {
    const tasks = [1, 2, 3].map((attempt) => task(`t_d${attempt}`, 'draft', 'done', { attempt, result: 'VERDICT: FAIL\nstill red' }));
    const plan = planRun(reviewLoop, tasks, ROOT);
    expect(plan.drafts).toEqual([]);
    expect(plan.failure).toMatchObject({ stage: 'draft', text: expect.stringContaining('all 3 of its attempts') });
    // With the stop made, nothing more is planned, and the run reads as failed.
    const stopped = [...tasks, task('t_x', 'run_failed', 'ready')];
    expect(planRun(reviewLoop, stopped, ROOT)).toEqual({ drafts: [], settle: [], prepare: [] });
    expect(runState(reviewLoop, stopped)).toBe('failed');
  });

  test('a failure or rejection with no edge for it stops the run too', () => {
    const noFail = readPlaybook({ ...chain, edges: chain.edges }).playbook!;
    expect(planRun(noFail, [task('t_a', 'a', 'done', { result: 'VERDICT: FAIL\nno' })], ROOT).failure).toMatchObject({ stage: 'a' });
  });

  test('an always edge follows a failure too', () => {
    const always = readPlaybook({ ...chain, edges: [{ from: 'a', to: 'b', when: 'always' }, { from: 'b', to: 'c', when: 'on_done' }] }).playbook!;
    expect(planRun(always, [task('t_a', 'a', 'done', { result: 'VERDICT: FAIL\nno' })], ROOT).drafts.map((draft) => draft.stage.key)).toEqual(['b']);
  });
});

// Parallel groups (M6 #04): several stages lead out of one, and a join waits for all of them.
const fork: Playbook = readPlaybook({
  id: 'fork',
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

describe('parallel groups', () => {
  test('every branch is made together, each linked to the stage that started them', () => {
    const plan = planRun(fork, [task('t_s', 'start', 'done')], ROOT);
    expect(plan.drafts.map((draft) => [draft.stage.key, draft.parents])).toEqual([['left', ['t_s']], ['right', ['t_s']]]);
  });

  test('the join waits until every branch has passed, then is made once with all of them as parents', () => {
    const base = [task('t_s', 'start', 'done', { children: ['t_l', 't_r'] })];
    expect(planRun(fork, [...base, task('t_l', 'left', 'done'), task('t_r', 'right', 'running')], ROOT).drafts).toEqual([]);
    const both = planRun(fork, [...base, task('t_l', 'left', 'done'), task('t_r', 'right', 'done')], ROOT).drafts;
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({ stage: { key: 'join' }, attempt: 1, parents: ['t_l', 't_r'] });
    const made = [...base, task('t_l', 'left', 'done', { children: ['t_j'] }), task('t_r', 'right', 'done', { children: ['t_j'] }), task('t_j', 'join', 'ready')];
    expect(planRun(fork, made, ROOT).drafts).toEqual([]);
  });

  test('a branch that fails follows its own on_fail and leaves the other alone; once it has passed the join is made from the latest passing attempts', () => {
    const base = [task('t_s', 'start', 'done', { children: ['t_l', 't_r'] }), task('t_l', 'left', 'done')];
    const failed = planRun(fork, [...base, task('t_r', 'right', 'done', { result: 'VERDICT: FAIL\nno' })], ROOT).drafts;
    expect(failed.map((draft) => draft.stage.key)).toEqual(['fixright']);
    const healed = [...base, task('t_r', 'right', 'done', { result: 'VERDICT: FAIL\nno', children: ['t_f'] }), task('t_f', 'fixright', 'done', { children: ['t_r2'] }), task('t_r2', 'right', 'done', { attempt: 2 })];
    expect(planRun(fork, healed, ROOT).drafts.map((draft) => [draft.stage.key, draft.parents])).toEqual([['join', ['t_l', 't_r2']]]);
  });
});
