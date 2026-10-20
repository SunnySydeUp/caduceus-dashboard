import { describe, expect, test } from 'vitest';
import { briefProblems, createPlan, durationSeconds, durationText, needsCli, newBriefFields, scheduledFields, type BriefFields } from '../src/modules/work/brief-task.ts';

const profiles = ['coder', 'reviewer'];
const ok: BriefFields = { ...newBriefFields(), title: 'Ship it' };
const problems = (patch: Partial<BriefFields>, mode: Parameters<typeof briefProblems>[1]['mode'] = 'queue', editing = false) => briefProblems({ ...ok, ...patch }, { mode, profiles, editing });

describe('durations', () => {
  test('read seconds and the shorthand Hermes’s CLI takes, and write the shortest exact form', () => {
    expect(['300', '90s', '30m', '2h', '1d', ' 15m '].map(durationSeconds)).toEqual([300, 90, 1800, 7200, 86_400, 900]);
    expect(['', '0', '0m', '1.5h', 'soon', '-5', '2w'].map(durationSeconds)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    expect([7200, 90, 60, 86_400, 3601].map(durationText)).toEqual(['2h', '90s', '1m', '1d', '3601s']);
  });
});

describe('what is wrong with the fields', () => {
  test('a task with only a title is fine to save in any mode that needs no profile', () => {
    expect(problems({}, 'draft')).toEqual({});
    expect(problems({}, 'queue')).toEqual({});
  });

  test('Run now needs a profile that exists, because a task nobody has cannot start', () => {
    expect(problems({}, 'run-now').assignee).toContain('cannot start');
    expect(problems({ assignee: 'nobody' }, 'queue').assignee).toBe('There is no profile called “nobody”.');
    expect(problems({ assignee: 'coder' }, 'run-now')).toEqual({});
  });

  test('a title is required and is one line', () => {
    expect(problems({ title: '  ' }).title).toBe('Give the task a title.');
    expect(problems({ title: 'a\nb' }).title).toBe('A title is one line.');
  });

  test.each([
    ['maxRuntime', { maxRuntime: 'soon' }],
    ['maxRetries', { maxRetries: 0 }],
    ['goalMaxTurns', { goalMaxTurns: 1.5 }],
    ['completionContract', { completionContract: 'not a contract' }],
    ['workspace', { workspace: { kind: 'dir', path: '' } as const }],
    ['branch', { workspace: { kind: 'worktree', branch: '--bad' } as const }],
    ['model', { provider: 'openai' }],
    ['project', { project: 'site' }],
    ['priority', { priority: 1.5 }],
    ['skills', { skills: ['bad skill'] }],
    ['parents', { parents: ['not an id!'] }],
  ])('says what is wrong with %s', (name, patch) => {
    expect(problems(patch)[name]).toBeTruthy();
  });

  test('accepts the contracts Hermes accepts', () => {
    for (const completionContract of ['local-only', 'acme/widgets', 'https://github.com/acme/widgets/pull/12']) expect(problems({ completionContract })).toEqual({});
  });

  test('a task that exists is checked only for what can still change', () => {
    expect(problems({ maxRuntime: 'soon', maxRetries: 0, completionContract: 'nope' }, 'queue', true)).toEqual({});
    expect(problems({ title: '' }, 'queue', true).title).toBeTruthy();
  });
});

describe('which way a task is created', () => {
  test('the plugin makes it unless a branch, a retry limit or a completion contract is wanted', () => {
    expect(needsCli(ok)).toBe(false);
    expect(needsCli({ ...ok, workspace: { kind: 'worktree' } })).toBe(false);
    expect(needsCli({ ...ok, workspace: { kind: 'worktree', branch: 'wt/x' } })).toBe(true);
    expect(needsCli({ ...ok, maxRetries: 2 })).toBe(true);
    expect(needsCli({ ...ok, completionContract: 'local-only' })).toBe(true);
  });
});

describe('what is sent to Hermes', () => {
  const everything: BriefFields = {
    ...ok,
    assignee: 'coder',
    model: 'gpt-5',
    provider: 'openai',
    reasoningEffort: 'high',
    skills: ['translation'],
    workspace: { kind: 'worktree', path: '/r', branch: 'wt/x' },
    project: 'site',
    priority: 2,
    maxRuntime: '2h',
    maxRetries: 3,
    goalMode: true,
    goalMaxTurns: 5,
    completionContract: 'acme/widgets',
    parents: ['t_1'],
  };

  test('is only fields Hermes’s task has, never a toolset: toolsets belong to the assignee’s profile', () => {
    for (const via of [createPlan(everything, 'queue'), createPlan({ ...everything, workspace: { kind: 'scratch' }, project: '', maxRetries: undefined, completionContract: '' }, 'queue')]) {
      const keys = Object.keys(via.create.body ?? {});
      expect(keys.filter((key) => /tool/i.test(key))).toEqual([]);
      expect(keys.sort()).toEqual(expect.arrayContaining(['title', 'assignee', 'skills', 'model_override', 'provider_override']));
    }
  });

  test('a draft goes in as triage whatever else is set, so nothing can claim it before it is moved', () => {
    expect(createPlan(everything, 'draft', { draft: 'todo' }).create.body).toMatchObject({ triage: true });
    expect(createPlan(everything, 'queue').create.body).not.toHaveProperty('triage');
  });

  test('the board and the profile scope the request and a profile named default does not', () => {
    expect(createPlan(everything, 'queue', { board: 'ops', profile: 'coder' }).create.path).toBe('/_caduceus/api/work/tasks?profile=coder&board=ops');
    expect(createPlan(everything, 'queue', { profile: 'default' }).create.path).toBe('/_caduceus/api/work/tasks');
  });
});

describe('Schedule mode', () => {
  test('hands the Create-task job the fields its script can carry', () => {
    const fields: BriefFields = {
      ...ok,
      brief: { kind: 'sections', sections: { ...ok.brief.kind === 'sections' ? ok.brief.sections : { goal: '', context: '', references: '', constraints: '', expected: '', scope: '' }, goal: 'Summarise the week.' } },
      assignee: 'coder',
      model: 'gpt-5',
      provider: 'openai',
      reasoningEffort: 'high',
      maxRuntime: '30m',
      goalMode: true,
      goalMaxTurns: 4,
    };

    expect(scheduledFields(fields)).toEqual({
      title: 'Ship it',
      brief: '## Goal\n\nSummarise the week.\n',
      assignee: 'coder',
      triage: false,
      skills: [],
      model: 'gpt-5',
      provider: 'openai',
      workspace: { kind: 'scratch' },
      maxRuntime: '30m',
      goalMode: true,
      goalMaxTurns: 4,
    });
  });
});

describe('what Queue says it will do', () => {
  test('a task nobody has is said to wait in Ready, not to be given to a worker', () => {
    expect(createPlan({ ...ok, assignee: '' }, 'queue').confirm.text).toContain('waits in Ready until you assign a profile');
    expect(createPlan({ ...ok, assignee: 'coder' }, 'queue').confirm.text).toContain('gives it to a worker of coder');
  });
});
