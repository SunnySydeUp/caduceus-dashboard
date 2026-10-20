import { describe, expect, test } from 'vitest';
import { BOARD_STATUSES, UNASSIGNED, briefExcerpt, currentLane, filterTasks, lanesFor, parseBoard, parsePeek, phoneLanes, readView, viewSearch } from '../src/modules/work/board-model.ts';

// What Hermes's `GET /api/plugins/kanban/board` answers (plugin_api.py `get_board`), trimmed to what a card needs.
const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  body: null,
  assignee: null,
  status,
  priority: 0,
  tenant: null,
  project_id: null,
  block_kind: null,
  created_at: 1_700_000_000,
  latest_summary: null,
  link_counts: { parents: 0, children: 0 },
  comment_count: 0,
  progress: null,
  ...extra,
});

const hermesBoard = {
  columns: BOARD_STATUSES.map((name) => ({ name, tasks: [] as unknown[] })),
  tenants: ['acme'],
  assignees: ['coder', 'writer'],
  latest_event_id: 41,
  now: 1_700_000_100,
};

describe('parseBoard', () => {
  test('keeps every Hermes status column, in lifecycle order, with its tasks and the event cursor', () => {
    const board = parseBoard({
      ...hermesBoard,
      columns: hermesBoard.columns.map((column) => ({
        ...column,
        tasks: column.name === 'ready' ? [task('t_1', 'ready', { assignee: 'coder', priority: 2 }), task('t_2', 'ready')] : column.name === 'done' ? [task('t_3', 'done')] : [],
      })),
    });

    expect(board.columns.map((column) => column.status)).toEqual(['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done']);
    expect(board.columns.map((column) => column.tasks.length)).toEqual([0, 0, 0, 2, 0, 0, 0, 1]);
    expect(board.columns[3].tasks[0]).toMatchObject({ id: 't_1', title: 'Task t_1', assignee: 'coder', priority: 2, status: 'ready' });
    expect(board.latestEventId).toBe(41);
    expect(board.tasks.map((t) => t.id)).toEqual(['t_1', 't_2', 't_3']);
  });
});

describe('filters', () => {
  const tasks = parseBoard({
    ...hermesBoard,
    columns: [
      { name: 'ready', tasks: [task('t_1', 'ready', { assignee: 'coder', priority: 2, tenant: 'acme', project_id: 'p_site', title: 'Fix the login page' }), task('t_2', 'ready', { title: 'Write release notes', assignee: 'writer' })] },
      { name: 'running', tasks: [task('t_3', 'running', { assignee: 'coder', tenant: 'globex', title: 'Login audit' })] },
    ],
  }).tasks;
  const ids = (found: typeof tasks) => found.map((t) => t.id);

  test('each filter narrows the tasks, and together they all apply', () => {
    expect(ids(filterTasks(tasks, {}))).toEqual(['t_1', 't_2', 't_3']);
    expect(ids(filterTasks(tasks, { assignee: 'coder' }))).toEqual(['t_1', 't_3']);
    expect(ids(filterTasks(tasks, { assignee: UNASSIGNED }))).toEqual([]);
    expect(ids(filterTasks(tasks, { priority: 2 }))).toEqual(['t_1']);
    expect(ids(filterTasks(tasks, { priority: 0 }))).toEqual(['t_2', 't_3']);
    expect(ids(filterTasks(tasks, { project: 'p_site' }))).toEqual(['t_1']);
    expect(ids(filterTasks(tasks, { tenant: 'globex' }))).toEqual(['t_3']);
    expect(ids(filterTasks(tasks, { assignee: 'coder', tenant: 'acme' }))).toEqual(['t_1']);
  });

  test('text matches the title, the id, the assignee and the tenant, every word, ignoring case', () => {
    expect(ids(filterTasks(tasks, { text: 'LOGIN' }))).toEqual(['t_1', 't_3']);
    expect(ids(filterTasks(tasks, { text: 'login acme' }))).toEqual(['t_1']);
    expect(ids(filterTasks(tasks, { text: 't_2' }))).toEqual(['t_2']);
    expect(ids(filterTasks(tasks, { text: 'writer' }))).toEqual(['t_2']);
    expect(ids(filterTasks(tasks, { text: '   ' }))).toEqual(['t_1', 't_2', 't_3']);
  });
});

describe('the view in the URL', () => {
  test('filters, lanes and the chosen lane read back as they were written', () => {
    const view = { lanes: 'profile' as const, lane: 'coder', filters: { assignee: 'coder', priority: 2, project: 'p_site', tenant: 'acme', text: 'login page' } };
    const search = viewSearch(view);
    expect(search).toEqual({ lanes: 'profile', lane: 'coder', assignee: 'coder', priority: '2', project: 'p_site', tenant: 'acme', q: 'login page' });
    expect(readView(search)).toEqual(view);
  });

  test('the default view leaves the URL bare, and a damaged one reads as the default', () => {
    expect(viewSearch({ lanes: 'status', filters: {} })).toEqual({});
    expect(readView({})).toEqual({ lanes: 'status', filters: {} });
    expect(readView({ lanes: 'sideways', priority: 'urgent', q: '  ' })).toEqual({ lanes: 'status', filters: {} });
  });

  test('a priority of 0 is a filter of its own: the normal ones', () => {
    expect(readView({ priority: '0' }).filters).toEqual({ priority: 0 });
    expect(viewSearch({ lanes: 'status', filters: { priority: 0 } })).toEqual({ priority: '0' });
  });
});

describe('lanes', () => {
  const board = parseBoard({
    ...hermesBoard,
    columns: [
      { name: 'ready', tasks: [task('t_1', 'ready', { assignee: 'writer' }), task('t_2', 'ready')] },
      { name: 'running', tasks: [task('t_3', 'running', { assignee: 'coder' })] },
      { name: 'review', tasks: [task('t_4', 'review', { assignee: 'writer' })] },
    ],
  });

  test('by status there is a lane for every status, in lifecycle order, empty ones included', () => {
    const lanes = lanesFor(board.tasks, 'status');
    expect(lanes.map((lane) => [lane.key, lane.label, lane.tasks.length])).toEqual([
      ['triage', 'Triage', 0],
      ['todo', 'Todo', 0],
      ['scheduled', 'Scheduled', 0],
      ['ready', 'Ready', 2],
      ['running', 'Running', 1],
      ['blocked', 'Blocked', 0],
      ['review', 'Review', 1],
      ['done', 'Done', 0],
    ]);
  });

  test('by profile there is a lane for each assignee that has tasks, A to Z, with the unassigned last; tasks follow the lifecycle', () => {
    const lanes = lanesFor(board.tasks, 'profile');
    expect(lanes.map((lane) => [lane.key, lane.label, lane.tasks.map((t) => t.id)])).toEqual([
      ['coder', 'coder', ['t_3']],
      ['writer', 'writer', ['t_1', 't_4']],
      [UNASSIGNED, 'Unassigned', ['t_2']],
    ]);
  });

  test('a phone lists Triage, Ready, Running, Review, Blocked and Done, and Todo and Scheduled only while they hold tasks', () => {
    expect(phoneLanes(lanesFor(board.tasks, 'status')).map((lane) => lane.key)).toEqual(['triage', 'ready', 'running', 'review', 'blocked', 'done']);
    const withTodo = parseBoard({ ...hermesBoard, columns: [{ name: 'todo', tasks: [task('t_5', 'todo')] }, { name: 'scheduled', tasks: [task('t_6', 'scheduled')] }] });
    expect(phoneLanes(lanesFor(withTodo.tasks, 'status')).map((lane) => lane.key)).toEqual(['triage', 'todo', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done']);
    expect(phoneLanes(lanesFor(board.tasks, 'profile')).map((lane) => lane.key)).toEqual(['coder', 'writer', UNASSIGNED]);
  });

  test('the lane a phone opens on is the one asked for, else the first that needs the owner, else the first with tasks', () => {
    const lanes = phoneLanes(lanesFor(board.tasks, 'status'));
    expect(currentLane(lanes, 'ready').key).toBe('ready');
    expect(currentLane(lanes, undefined).key).toBe('review');
    expect(currentLane(lanes, 'nowhere').key).toBe('review');
    const quiet = phoneLanes(lanesFor(parseBoard({ ...hermesBoard, columns: [{ name: 'done', tasks: [task('t_7', 'done')] }] }).tasks, 'status'));
    expect(currentLane(quiet, undefined).key).toBe('done');
    expect(currentLane(phoneLanes(lanesFor([], 'status')), undefined).key).toBe('triage');
  });
});

describe('the task peek', () => {
  // What `GET /api/plugins/kanban/tasks/{id}` answers (plugin_api.py `get_task`).
  const answer = {
    task: { ...task('t_9', 'review', { assignee: 'coder', priority: 1, body: '## Goal\nFix the login page.\n\n## Context\nUsers on phones cannot sign in.', latest_summary: 'Patched the form.' }) },
    runs: [
      { id: 1, profile: 'coder', status: 'crashed', outcome: 'crashed', summary: null, error: 'worker exited with code 1', started_at: 1_700_000_100, ended_at: 1_700_000_160 },
      { id: 2, profile: 'coder', status: 'done', outcome: 'completed', summary: 'Patched the form and added a test.', error: null, started_at: 1_700_000_200, ended_at: 1_700_000_900 },
    ],
    comments: [{ id: 1 }, { id: 2 }],
  };

  test('reads the brief, the status, the assignee and the latest run’s outcome', () => {
    expect(parsePeek(answer)).toEqual({
      id: 't_9',
      title: 'Task t_9',
      status: 'review',
      assignee: 'coder',
      priority: 1,
      blockKind: null,
      brief: '## Goal\nFix the login page.\n\n## Context\nUsers on phones cannot sign in.',
      latestRun: { outcome: 'completed', status: 'done', summary: 'Patched the form and added a test.', error: null, profile: 'coder', startedAt: 1_700_000_200, endedAt: 1_700_000_900 },
      runCount: 2,
    });
  });

  test('a task that has not run has no latest run, and one that is not a task is no peek', () => {
    expect(parsePeek({ task: task('t_8', 'ready'), runs: [] })).toMatchObject({ latestRun: null, runCount: 0, brief: '' });
    expect(() => parsePeek({ error: 'nope' })).toThrow();
  });

  test('an excerpt keeps the start of the brief, cut between words, and says so when it cut', () => {
    expect(briefExcerpt('Short brief.', 40)).toEqual({ text: 'Short brief.', cut: false });
    expect(briefExcerpt('one two three four five', 12)).toEqual({ text: 'one two', cut: true });
    expect(briefExcerpt('  \n ', 40)).toEqual({ text: '', cut: false });
  });
});
