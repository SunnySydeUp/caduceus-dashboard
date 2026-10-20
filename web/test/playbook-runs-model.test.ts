import { describe, expect, test } from 'vitest';
import type { Playbook } from '@caduceus/contracts/playbooks';
import { parseBoard } from '../src/modules/work/board-model.ts';
import { boardSignature, boardsOf, groupRuns, latestAttemptIds, rawRowsOf, readRun, readRuns, RUN_STATE, rerunConfirmation, runPathOf, runsOf, startedText, STOPPED_TEXT, stagesText, taskStatusChip, VERDICT_CHIP, waitingAtGate } from '../src/modules/work/playbook-runs-model.ts';

const BRIEF = { brief: { goal: 'Do it.' } };
const DEFINITION: Playbook = {
  id: 'release',
  version: 2,
  name: 'Release',
  category: 'engineering',
  inputs: [{ key: 'feature', label: 'Which feature?', required: true }],
  stages: [
    { key: 'build', title: 'Build {{feature}}', ...BRIEF },
    { key: 'review', title: 'Review {{feature}}', ...BRIEF, gate: 'approval' },
    { key: 'ship', title: 'Ship it', ...BRIEF },
  ],
  edges: [
    { from: 'build', to: 'review', when: 'on_done' },
    { from: 'review', to: 'ship', when: 'on_approve' },
  ],
};

const summary = (over: Record<string, unknown> = {}) => ({ root: 't_1', board: 'default', playbook: { id: 'release', version: 2, name: 'Release' }, title: 'Build search', state: 'running', stagesDone: 1, stagesTotal: 3, startedAt: 1000, ...over });
const entry = (over: Record<string, unknown> = {}) => ({ stage: 'build', title: 'Build search', attempt: 1, taskId: 't_1', status: 'done', assignee: 'coder', createdAt: 1000, completedAt: 1500, ...over });

describe('reading what the server answers', () => {
  test('the list keeps the runs that are runs and drops anything else', () => {
    const runs = readRuns({ runs: [summary(), summary({ root: 't_2', state: 'sleeping' }), { nonsense: true }, summary({ root: 't_3', startedAt: null })] });
    expect(runs.map((run) => [run.root, run.startedAt])).toEqual([['t_1', 1000], ['t_3', null]]);
    expect(readRuns('no')).toEqual([]);
  });

  test('a run has its definition, its timeline and its inputs; a body without a valid definition is not a run', () => {
    const run = readRun({ run: { ...summary(), definition: DEFINITION, timeline: [entry(), { broken: true }, entry({ stage: 'review', taskId: 't_2', status: 'review', assignee: null, completedAt: null })], inputs: { feature: 'search', skip: 3 } } });
    expect(run?.timeline.map((item) => [item.stage, item.assignee, item.completedAt])).toEqual([['build', 'coder', 1500], ['review', null, null]]);
    expect(run?.inputs).toEqual({ feature: 'search' });
    expect(run?.definition.name).toBe('Release');
    expect(readRun({ run: { ...summary(), definition: { id: 'Bad' }, timeline: [], inputs: {} } })).toBeUndefined();
    expect(readRun({})).toBeUndefined();
  });
});

describe('a run’s path', () => {
  test('what has happened comes oldest first, then the stages with no task, in the definition’s order, with the answers filled into their titles', () => {
    const detail = readRun({ run: { ...summary(), definition: DEFINITION, timeline: [entry()], inputs: { feature: 'search' } } })!;
    const path = runPathOf(detail);
    expect(path.attempts.map((item) => item.stage)).toEqual(['build']);
    expect(path.pending).toEqual([{ stage: 'review', title: 'Review search' }, { stage: 'ship', title: 'Ship it' }]);
  });

  test('a stage that was tried twice is one stage: it is not listed as not started', () => {
    const detail = readRun({ run: { ...summary(), definition: DEFINITION, timeline: [entry(), entry({ stage: 'review', taskId: 't_2' }), entry({ stage: 'build', attempt: 2, taskId: 't_3' })], inputs: { feature: 'search' } } })!;
    expect(runPathOf(detail).pending.map((stage) => stage.stage)).toEqual(['ship']);
  });
});

describe('the runs list', () => {
  const runs = readRuns({
    runs: [
      summary({ root: 'a', startedAt: 100 }),
      summary({ root: 'b', startedAt: 300 }),
      summary({ root: 'c', startedAt: 200, playbook: { id: 'audit', version: 1, name: 'Audit' } }),
      summary({ root: 'd', startedAt: 50, playbook: { id: 'release', version: 1, name: 'Release' }, board: 'other' }),
    ],
  });

  test('is grouped by playbook and version: the group of the newest run first, and the newest run first in a group', () => {
    expect(groupRuns(runs).map((group) => [group.ref, group.runs.map((run) => run.root)])).toEqual([
      ['release@2', ['b', 'a']],
      ['audit@1', ['c']],
      ['release@1', ['d']],
    ]);
  });

  test('a playbook’s own runs cover every version, and the boards to watch are the distinct ones', () => {
    expect(runsOf(runs, 'release').map((run) => run.root)).toEqual(['b', 'a', 'd']);
    expect(boardsOf(runs)).toEqual(['default', 'other']);
  });

  test('has no groups when there are no runs', () => {
    expect(groupRuns([])).toEqual([]);
  });
});

describe('words', () => {
  test('stages are counted in words and a task status keeps the Kanban board’s name and tone', () => {
    expect(stagesText(2, 5)).toBe('2 of 5 stages');
    expect(stagesText(0, 1)).toBe('0 of 1 stage');
    expect(taskStatusChip('running')).toEqual({ label: 'Running', tone: 'running' });
    expect(taskStatusChip('done')).toEqual({ label: 'Done', tone: 'success' });
    expect(taskStatusChip('review')).toEqual({ label: 'Review', tone: 'warning' });
    expect(taskStatusChip('blocked')).toEqual({ label: 'Blocked', tone: 'blocked' });
    expect(taskStatusChip('ready')).toEqual({ label: 'Ready', tone: undefined });
    expect(taskStatusChip('odd')).toEqual({ label: 'odd', tone: undefined });
  });

  test('a start is said as how long ago, and nothing when it is not known', () => {
    expect(startedText(null, 1000)).toBe('');
    expect(startedText(990, 1000)).toBe('started just now');
    expect(startedText(1000 - 3 * 3600, 1000)).toBe('started 3h ago');
  });
});

describe('verdicts, gates and re-runs', () => {
  test('an entry keeps a verdict and a note it was given and drops what is not one', () => {
    const run = readRun({ run: { ...summary(), definition: DEFINITION, inputs: {}, timeline: [entry({ verdict: 'rejected', note: 'Too slow.' }), entry({ stage: 'review', taskId: 't_2', verdict: 'maybe', note: '' }), entry({ stage: 'ship', taskId: 't_3' })] } })!;
    expect(run.timeline.map((item) => [item.verdict, item.note])).toEqual([['rejected', 'Too slow.'], [undefined, undefined], [undefined, undefined]]);
    expect('verdict' in run.timeline[2]!).toBe(false);
  });

  test('each verdict has its chip and the note under it its label; a stopped run is called Stopped and says what to do', () => {
    expect(Object.entries(VERDICT_CHIP).map(([key, chip]) => [key, chip.label])).toEqual([['passed', 'Passed'], ['failed', 'Failed'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['answered', 'Answered']]);
    expect(VERDICT_CHIP.rejected.noteLabel).toBe('Owner’s note');
    expect(VERDICT_CHIP.failed.noteLabel).toBe('Why it failed');
    expect(VERDICT_CHIP.answered.noteLabel).toBe('Owner’s answer');
    expect(RUN_STATE.waiting.label).toBe('Waiting for you');
    expect(RUN_STATE.failed).toEqual({ label: 'Stopped', badge: 'failed' });
    expect(STOPPED_TEXT).toBe('The run stopped, and a task for it is in Notices. Re-run a stage to continue.');
  });

  test('a stage waits at a gate when it has one, has no verdict yet, and its task is in Review or blocked', () => {
    expect(waitingAtGate({ stage: 'review', status: 'review' }, DEFINITION)).toBe(true);
    expect(waitingAtGate({ stage: 'review', status: 'blocked' }, DEFINITION)).toBe(true);
    expect(waitingAtGate({ stage: 'review', status: 'done', verdict: 'approved' }, DEFINITION)).toBe(false);
    expect(waitingAtGate({ stage: 'review', status: 'review', verdict: 'rejected' }, DEFINITION)).toBe(false);
    expect(waitingAtGate({ stage: 'build', status: 'blocked' }, DEFINITION)).toBe(false);
    expect(waitingAtGate({ stage: 'gone', status: 'review' }, DEFINITION)).toBe(false);
  });

  test('only the latest attempt of a stage offers a re-run', () => {
    const { timeline } = readRun({ run: { ...summary(), definition: DEFINITION, inputs: {}, timeline: [entry(), entry({ stage: 'review', taskId: 't_2' }), entry({ stage: 'build', attempt: 2, taskId: 't_3' })] } })!;
    expect([...latestAttemptIds(timeline)].sort()).toEqual(['t_2', 't_3']);
  });

  test('the confirmation names the stage and the run, and says the stages that are done are not touched', () => {
    expect(rerunConfirmation('Build search', 'Review search')).toEqual({
      title: 'Re-run from “Review search”?',
      text: 'This starts a new attempt of the stage “Review search” in the run “Build search”. The stages that are already done are not touched, and the run goes on from the new attempt.',
      object: 'Review search',
      confirmLabel: 'Re-run',
    });
  });
});

describe('telling a page that a task changed', () => {
  const board = (tasks: object[]) => parseBoard({ columns: [{ name: 'ready', tasks }] });

  test('the signature changes when a task is made, renamed, moved, assigned or finished, and not when nothing a run shows did', () => {
    const before = boardSignature(board([{ id: 'a', title: 'A' }]));
    expect(boardSignature(board([{ id: 'a', title: 'A', priority: 5 }]))).toBe(before);
    expect(boardSignature(board([{ id: 'a', title: 'A renamed' }]))).not.toBe(before);
    expect(boardSignature(board([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]))).not.toBe(before);
    expect(boardSignature(board([{ id: 'a', title: 'A', assignee: 'coder' }]))).not.toBe(before);
    expect(boardSignature(board([{ id: 'a', title: 'A', completed_at: 5 }]))).not.toBe(before);
    expect(boardSignature(parseBoard({ columns: [{ name: 'running', tasks: [{ id: 'a', title: 'A' }] }] }))).not.toBe(before);
  });
});

describe('the raw tasks of a run', () => {
  const ref = { id: 'release', version: 2, name: 'Release' };
  const tagged = (id: string, run: string, stage: string, over: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, idempotency_key: `caduceus-playbook:release@2:${run}:${stage}:1`, workflow_template_id: 'release@2', current_step_key: null, created_at: 10, ...over });
  const board = (tasks: object[]) => parseBoard({ columns: [{ name: 'done', tasks }] }).tasks;

  test('each task of the timeline comes in the timeline’s order with the board’s own fields, null where Hermes holds nothing', () => {
    const rows = rawRowsOf(
      { root: 't_1', playbook: ref, timeline: [entry(), entry({ stage: 'review', taskId: 't_2', status: 'review' })] as never },
      board([tagged('t_2', 't_1', 'review', { current_step_key: 'review' }), tagged('t_1', 'root-0123456789ab', 'build')]),
    );
    expect(rows).toEqual([
      { id: 't_1', title: 'Task t_1', status: 'done', idempotencyKey: 'caduceus-playbook:release@2:root-0123456789ab:build:1', workflowTemplateId: 'release@2', currentStepKey: null, stage: 'build', attempt: 1, onBoard: true },
      { id: 't_2', title: 'Task t_2', status: 'done', idempotencyKey: 'caduceus-playbook:release@2:t_1:review:1', workflowTemplateId: 'release@2', currentStepKey: 'review', stage: 'review', attempt: 1, onBoard: true },
    ]);
  });

  test('a task of the timeline the board no longer lists keeps what the timeline says and is marked', () => {
    const [row] = rawRowsOf({ root: 't_1', playbook: ref, timeline: [entry({ title: 'Build search', status: 'done' })] as never }, []);
    expect(row).toEqual({ id: 't_1', title: 'Build search', status: 'done', idempotencyKey: null, workflowTemplateId: null, currentStepKey: null, stage: 'build', attempt: 1, onBoard: false });
  });

  test('another task that carries the run’s tag is listed after, by when it was made, and tasks of other runs, versions or playbooks are not', () => {
    const rows = rawRowsOf(
      { root: 't_1', playbook: ref, timeline: [entry()] as never },
      board([
        tagged('t_9', 't_1', 'run_failed', { created_at: 30 }),
        tagged('t_8', 't_1', 'run_failed', { created_at: 20 }),
        tagged('t_7', 't_5', 'build'),
        tagged('t_6', 't_1', 'build', { idempotency_key: 'caduceus-playbook:release@1:t_1:build:1' }),
        tagged('t_4', 't_1', 'build', { idempotency_key: 'caduceus-playbook:other@2:t_1:build:1' }),
        { id: 't_3', title: 'No tag', created_at: 1 },
        tagged('t_1', 'root-0123456789ab', 'build'),
      ]),
    );
    expect(rows.map((row) => row.id)).toEqual(['t_1', 't_8', 't_9']);
    expect(rows[1].stage).toBeUndefined();
    expect(rows[1].onBoard).toBe(true);
  });
});
