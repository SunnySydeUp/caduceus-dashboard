import { describe, expect, test } from 'vitest';
import { activityOf, availableActions, parseTaskDetail, runRows, tabOf, TASK_TABS } from '../src/modules/work/task-model.ts';

// What Hermes's `GET /api/plugins/kanban/tasks/{id}` answers (plugin_api.py `get_task`), trimmed to what the page reads.
const hermesTask = (extra: Record<string, unknown> = {}) => ({
  id: 't_1',
  title: 'Ship it',
  body: '# Brief\n\nDo the thing.',
  assignee: 'coder',
  status: 'running',
  priority: 2,
  created_by: 'owner',
  created_at: 1_700_000_000,
  started_at: 1_700_000_100,
  completed_at: null,
  workspace_kind: 'scratch',
  workspace_path: null,
  tenant: 'acme',
  project_id: null,
  result: null,
  max_runtime_seconds: 600,
  skills: ['git'],
  model_override: null,
  provider_override: null,
  reasoning_effort: null,
  goal_mode: false,
  goal_max_turns: null,
  block_kind: null,
  current_run_id: 7,
  consecutive_failures: 0,
  last_failure_error: null,
  latest_summary: null,
  ...extra,
});
const hermesDetail = (extra: Record<string, unknown> = {}) => ({
  task: hermesTask(),
  comments: [{ id: 1, task_id: 't_1', author: 'owner', body: 'Go ahead', created_at: 1_700_000_050 }],
  events: [
    { id: 10, task_id: 't_1', kind: 'created', payload: null, created_at: 1_700_000_000, run_id: null },
    { id: 11, task_id: 't_1', kind: 'status', payload: { status: 'ready' }, created_at: 1_700_000_090, run_id: null },
  ],
  attachments: [{ id: 3, task_id: 't_1', filename: 'notes.txt', content_type: 'text/plain', size: 12, uploaded_by: 'owner', created_at: 1_700_000_060 }],
  links: { parents: ['t_0'], children: ['t_2'] },
  child_results: [{ id: 't_2', title: 'Child', status: 'todo', latest_summary: null, result: null }],
  runs: [{ id: 7, task_id: 't_1', profile: 'coder', status: 'running', outcome: null, summary: null, error: null, metadata: null, started_at: 1_700_000_100, ended_at: null }],
  ...extra,
});

describe('parseTaskDetail', () => {
  test('reads a task with its brief, comments, events, runs, attachments and links', () => {
    const detail = parseTaskDetail(hermesDetail());
    expect(detail.task).toMatchObject({ id: 't_1', title: 'Ship it', status: 'running', assignee: 'coder', priority: 2, brief: '# Brief\n\nDo the thing.', currentRunId: 7, skills: ['git'], maxRuntimeSeconds: 600 });
    expect(detail.comments).toEqual([{ id: 1, author: 'owner', body: 'Go ahead', createdAt: 1_700_000_050 }]);
    expect(detail.events.map((event) => event.kind)).toEqual(['created', 'status']);
    expect(detail.attachments).toEqual([{ id: 3, filename: 'notes.txt', contentType: 'text/plain', size: 12, uploadedBy: 'owner', createdAt: 1_700_000_060 }]);
    expect(detail.links).toEqual({ parents: ['t_0'], children: ['t_2'] });
    expect(detail.runs).toHaveLength(1);
    expect(detail.latestEventId).toBe(11);
  });

  test('an answer that is not a task throws, so the page says so', () => {
    expect(() => parseTaskDetail({ detail: 'task t_9 not found' })).toThrow();
  });
});

describe('tabOf', () => {
  test('a known tab name is itself; anything else is the Brief', () => {
    expect(TASK_TABS.map((tab) => tab.id)).toEqual(['brief', 'runs', 'activity', 'links', 'attachments', 'settings']);
    expect(tabOf('links')).toBe('links');
    expect(tabOf('nope')).toBe('brief');
    expect(tabOf(undefined)).toBe('brief');
  });
});

describe('activityOf', () => {
  test('merges events and comments oldest first, leaving out the commented event and heartbeats', () => {
    const detail = parseTaskDetail(
      hermesDetail({
        events: [
          { id: 10, task_id: 't_1', kind: 'created', payload: null, created_at: 100, run_id: null },
          { id: 11, task_id: 't_1', kind: 'commented', payload: null, created_at: 120, run_id: null },
          { id: 12, task_id: 't_1', kind: 'heartbeat', payload: null, created_at: 130, run_id: 7 },
          { id: 13, task_id: 't_1', kind: 'status', payload: { status: 'ready' }, created_at: 150, run_id: null },
        ],
        comments: [{ id: 1, task_id: 't_1', author: 'owner', body: 'Go', created_at: 120 }],
      }),
    );
    expect(activityOf(detail).map((item) => (item.kind === 'comment' ? `comment:${item.comment.body}` : item.text))).toEqual(['Task created', 'comment:Go', 'Moved to ready']);
  });
});

describe('runRows', () => {
  test('lists runs newest first with outcome, duration and the cost a worker reported', () => {
    const detail = parseTaskDetail(
      hermesDetail({
        runs: [
          { id: 1, task_id: 't_1', profile: 'coder', status: 'done', outcome: 'crashed', started_at: 1000, ended_at: 1090, metadata: null },
          { id: 2, task_id: 't_1', profile: 'writer', status: 'done', outcome: 'completed', started_at: 2000, ended_at: 2030, metadata: { cost_usd: 0.42 } },
          { id: 3, task_id: 't_1', profile: 'coder', status: 'running', outcome: null, started_at: 3000, ended_at: null, metadata: null },
        ],
      }),
    );
    const rows = runRows(detail.runs, 3010);
    expect(rows.map((row) => [row.id, row.outcomeLabel, row.durationSeconds, row.costUsd, row.running])).toEqual([
      [3, 'Running', 10, null, true],
      [2, 'Completed', 30, 0.42, false],
      [1, 'Crashed', 90, null, false],
    ]);
  });
});

describe('availableActions', () => {
  const taskIn = (status: string, extra: Record<string, unknown> = {}) => parseTaskDetail(hermesDetail({ task: hermesTask({ status, ...extra }) }));
  test('a running task can be terminated or reclaimed, not run', () => {
    const { task, runs } = taskIn('running');
    expect(availableActions(task, runs)).toEqual(['terminate', 'reclaim', 'reassign', 'estimate']);
  });
  test('a blocked task can be retried; a ready task can be run now', () => {
    expect(availableActions(taskIn('blocked').task, [])).toContain('retry');
    expect(availableActions(taskIn('ready').task, [])).toContain('run-now');
  });
  test('only a triage task can be specified or decomposed', () => {
    expect(availableActions(taskIn('triage').task, [])).toEqual(expect.arrayContaining(['specify', 'decompose']));
    expect(availableActions(taskIn('todo').task, [])).not.toContain('specify');
  });
  test('an archived task has no actions', () => {
    expect(availableActions(taskIn('archived').task, [])).toEqual([]);
  });
});
