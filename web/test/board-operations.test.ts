import { describe, expect, test } from 'vitest';
import { UNASSIGNED, type BoardTask } from '../src/modules/work/board-model.ts';
import { PRIORITY_CHOICES, cardMenu, dispatcherMode, dropChange, readDispatch, readSettings, readSide, type DispatcherSettings } from '../src/modules/work/board-ops.ts';
import { READ_ONLY_MESSAGE } from '../src/tiered-fetch.ts';

const task = (fields: Partial<BoardTask> = {}): BoardTask => ({
  id: 't_1',
  title: 'A task',
  status: 'ready',
  assignee: 'coder',
  priority: 0,
  tenant: null,
  projectId: null,
  blockKind: null,
  summary: null,
  commentCount: 0,
  createdAt: 0,
  workflowTemplateId: null,
  currentStepKey: null,
  idempotencyKey: null,
  startedAt: null,
  completedAt: null,
  lastHeartbeatAt: null,
  failures: 0,
  lastFailureError: null,
  ...fields,
});

describe('a card’s menu', () => {
  test('offers Move to…, Assign… and Priority… on every card, and Reclaim only on a running one, whose Move and Assign wait for it', () => {
    const entries = (fields: Partial<BoardTask>) => cardMenu(task(fields), { readOnly: false }).map((entry) => `${entry.id}${entry.disabled ? ' (disabled)' : ''}`);

    expect(entries({ status: 'ready' })).toEqual(['move', 'assign', 'priority', 'select', 'open']);
    expect(entries({ status: 'review' })).toEqual(['move', 'assign', 'priority', 'select', 'open']);
    // A worker has it: Hermes refuses a new profile, and moving it would stop the worker, which is what Reclaim says it does.
    expect(entries({ status: 'running' })).toEqual(['move (disabled)', 'assign (disabled)', 'priority', 'reclaim', 'select', 'open']);
    const running = cardMenu(task({ status: 'running' }), { readOnly: false });
    expect(running.find((entry) => entry.id === 'move')?.disabled).toMatch(/worker has it.*Reclaim/);
  });

  test('in read-only mode every entry that changes Hermes is disabled with the read-only explanation, and the ones that only look still work', () => {
    for (const status of ['triage', 'ready', 'running', 'done'] as const) {
      const menu = cardMenu(task({ status }), { readOnly: true });
      for (const entry of menu.filter((candidate) => candidate.writes)) expect(entry.disabled, `${status} ${entry.id}`).toBe(READ_ONLY_MESSAGE);
      expect(menu.filter((candidate) => !candidate.writes).map((candidate) => [candidate.id, candidate.disabled])).toEqual([['select', undefined], ['open', undefined]]);
    }
  });
});

describe('dropping a card on a lane', () => {
  test('by status it moves the card, by profile it assigns it, and a drop that changes nothing, or that Hermes would refuse, is no change', () => {
    expect(dropChange(task({ status: 'ready' }), 'status', 'blocked')).toEqual({ kind: 'move', to: 'blocked' });
    expect(dropChange(task({ status: 'ready' }), 'status', 'ready')).toBeUndefined();
    // Running is not a place to drop a card; a card that is running does not move.
    expect(dropChange(task({ status: 'ready' }), 'status', 'running')).toBeUndefined();
    expect(dropChange(task({ status: 'running' }), 'status', 'ready')).toBeUndefined();
    // Done is not reachable from Triage.
    expect(dropChange(task({ status: 'triage' }), 'status', 'done')).toBeUndefined();

    expect(dropChange(task({ assignee: 'coder' }), 'profile', 'writer')).toEqual({ kind: 'assign', to: 'writer' });
    expect(dropChange(task({ assignee: 'coder' }), 'profile', UNASSIGNED)).toEqual({ kind: 'assign', to: null });
    expect(dropChange(task({ assignee: 'coder' }), 'profile', 'coder')).toBeUndefined();
    expect(dropChange(task({ assignee: null }), 'profile', UNASSIGNED)).toBeUndefined();
    expect(dropChange(task({ status: 'running', assignee: 'coder' }), 'profile', 'writer')).toBeUndefined();
  });
});

describe('priorities', () => {
  test('are offered from lowest to highest, with the normal one named', () => {
    expect(PRIORITY_CHOICES.map((choice) => choice.value)).toEqual([...PRIORITY_CHOICES.map((choice) => choice.value)].sort((a, b) => a - b));
    expect(PRIORITY_CHOICES.find((choice) => choice.value === 0)?.label).toBe('Normal');
  });
});

describe('the dispatcher’s mode', () => {
  const settings = (fields: Partial<DispatcherSettings> = {}): DispatcherSettings => ({
    ...readSettings({ kanban: {} }, {}),
    ...fields,
  });

  test('is automatic while the gateway runs it, manual when Hermes does not dispatch by itself, and stopped while the gateway is down', () => {
    expect(dispatcherMode(settings(), true)).toMatchObject({ state: 'auto', label: 'Automatic', detail: expect.stringContaining('every 60 seconds') });
    expect(dispatcherMode(settings({ intervalSeconds: 120 }), true).detail).toContain('every 2 minutes');
    expect(dispatcherMode(settings({ dispatchInGateway: false }), true)).toMatchObject({ state: 'manual', label: 'Manual', detail: expect.stringMatching(/does not dispatch by itself/) });
    expect(dispatcherMode(settings(), false)).toMatchObject({ state: 'stopped', label: 'Stopped', detail: expect.stringMatching(/gateway.*not running/) });
    // Down beats manual: the gateway is what runs it, so a nudge is still the only way.
    expect(dispatcherMode(settings({ dispatchInGateway: false }), false).state).toBe('stopped');
  });

  test('says its limits: none set, one for all, one for each profile', () => {
    expect(dispatcherMode(settings(), true).limits).toBe('No limit of your own on workers running at once.');
    expect(dispatcherMode(settings({ maxInProgress: 3 }), true).limits).toBe('Up to 3 workers at once.');
    expect(dispatcherMode(settings({ maxInProgress: 1 }), true).limits).toBe('Up to 1 worker at once.');
    expect(dispatcherMode(settings({ maxInProgress: 4, maxInProgressPerProfile: 2 }), true).limits).toBe('Up to 4 workers at once, 2 for each profile.');
    expect(dispatcherMode(settings({ maxInProgressPerProfile: 1 }), true).limits).toBe('Up to 1 worker for each profile at once.');
  });
});

describe('what a dispatch says', () => {
  test('puts each task Hermes holds back with its reason, and the ready tasks it does not mention as waiting for a slot', () => {
    const report = readDispatch(
      {
        spawned: [['t_a', 'coder', '/w/a']],
        skipped_unassigned: ['t_b'],
        skipped_nonspawnable: ['t_c'],
        skipped_per_profile_capped: [['t_d', 'coder', 2]],
        respawn_guarded: [['t_e', 'recent_success'], ['t_f', 'blocker_auth']],
        reclaimed: 1,
        promoted: 2,
        crashed: ['t_x'],
        memory_pressure: 'elevated',
        skipped_locked: false,
      },
      ['t_a', 't_b', 't_c', 't_d', 't_e', 't_f', 't_g'],
    );

    expect(report.wouldStart).toEqual([{ taskId: 't_a', profile: 'coder' }]);
    expect(report.waiting.map((item) => item.taskId)).toEqual(['t_b', 't_c', 't_d', 't_e', 't_f', 't_g']);
    expect(report.waiting.find((item) => item.taskId === 't_d')?.why).toBe('coder already has 2 workers running, which is its limit.');
    expect(report.waiting.find((item) => item.taskId === 't_e')?.why).toMatch(/finished in the last hour/);
    expect(report.waiting.find((item) => item.taskId === 't_g')?.why).toMatch(/No worker slot is free/);
    expect(report.notes).toEqual(['1 task had an expired claim released.', '2 tasks moved from Todo to Ready, their parents being done.', '1 task lost its worker.', 'The Mac is low on memory, so at most one worker starts now.']);
  });

  test('is empty, not an error, for an answer with nothing in it', () => {
    expect(readDispatch({}, [])).toEqual({ wouldStart: [], waiting: [], notes: [] });
    expect(readDispatch('Hermes said no', ['t_1'])).toMatchObject({ wouldStart: [], waiting: [{ taskId: 't_1' }] });
  });
});

describe('the side panel’s data', () => {
  test('reads Hermes’s stats, diagnostics and active workers, busiest profile first, and does not break on what Hermes leaves out', () => {
    const side = readSide({
      stats: { by_status: { ready: 2, running: 1 }, by_assignee: { writer: { ready: 1 }, coder: { ready: 1, running: 1 } }, oldest_ready_age_seconds: 90 },
      diagnostics: {
        count: 2,
        diagnostics: [
          {
            task_id: 't_1',
            task_title: 'Stuck',
            task_status: 'running',
            task_assignee: 'coder',
            diagnostics: [
              { kind: 'repeated_crashes', severity: 'error', title: 'Worker keeps crashing', detail: 'Three crashes.', actions: [{ kind: 'reclaim', label: 'Reclaim task' }] },
              { kind: 'stuck_in_blocked', severity: 'odd', title: 'Blocked for a day', detail: '', actions: [] },
            ],
          },
          { task_id: 't_2', diagnostics: [] },
          { nothing: true },
        ],
      },
      workers: { workers: [{ run_id: 7, task_id: 't_1', task_title: 'Stuck', profile: 'coder', started_at: 100, last_heartbeat_at: null }, { run_id: 'x' }], count: 2 },
    });

    expect(side.byStatus).toEqual({ ready: 2, running: 1 });
    expect(side.byAssignee.map((row) => [row.name, row.total])).toEqual([['coder', 2], ['writer', 1]]);
    expect(side.oldestReadySeconds).toBe(90);
    expect(side.problemCount).toBe(2);
    expect(side.problems[0]).toMatchObject({ taskId: 't_1', title: 'Stuck', canReclaim: true, problems: [{ severity: 'error', title: 'Worker keeps crashing' }, { severity: 'warning' }] });
    expect(side.workers).toEqual([{ runId: 7, taskId: 't_1', title: 'Stuck', profile: 'coder', startedAt: 100, lastHeartbeatAt: null }]);
    expect(readSide({})).toEqual({ byStatus: {}, byAssignee: [], oldestReadySeconds: null, problemCount: 0, problems: [], workers: [] });
  });
});
