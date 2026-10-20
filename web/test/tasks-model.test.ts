import { describe, expect, test } from 'vitest';
import type { SavedFilter } from '@caduceus/contracts/task-filters';
import { parseBoard, type BoardTask } from '../src/modules/work/board-model.ts';
import { ageLabel, definitionOf, describeDefinition, lastRun, nextSort, readTasksView, rowWindow, selectTasks, sortTasks, tasksSearch, updatedAt, type SortColumn, type TasksView } from '../src/modules/work/tasks-model.ts';

describe('the Tasks view in the address', () => {
  test('the default view is no query at all, and what is in the query reads back as the same view', () => {
    expect(tasksSearch(readTasksView({}))).toEqual({});
    const views: TasksView[] = [
      { filter: { kind: 'mine' }, sort: { column: 'updated', direction: 'desc' }, text: '' },
      { filter: { kind: 'waiting' }, sort: { column: 'priority', direction: 'desc' }, text: 'release notes' },
      { filter: { kind: 'failed' }, sort: { column: 'title', direction: 'asc' }, text: '' },
      { filter: { kind: 'playbook', id: 'release:v2' }, sort: { column: 'status', direction: 'asc' }, text: '' },
      { filter: { kind: 'project', id: 'p_site' }, sort: { column: 'updated', direction: 'desc' }, text: 'x' },
      { filter: { kind: 'saved', id: 'abc-123' }, sort: { column: 'outcome', direction: 'asc' }, text: '' },
      { sort: { column: 'assignee', direction: 'asc' }, text: '' },
    ];
    for (const view of views) {
      const search = tasksSearch(view);
      // What the router hands back is the query's strings; a round trip through the address loses nothing.
      expect(readTasksView(Object.fromEntries(new URLSearchParams(new URLSearchParams(search).toString())))).toEqual(view);
    }
    expect(tasksSearch(views[1]!)).toEqual({ filter: 'waiting', sort: '-priority', q: 'release notes' });
  });

  test('a damaged query is as if it were not there', () => {
    expect(readTasksView({ filter: 'everything', sort: 'colour', q: '   ' })).toEqual({ sort: { column: 'updated', direction: 'desc' }, text: '' });
    expect(readTasksView({ filter: 'playbook:', sort: '--title' })).toEqual({ sort: { column: 'updated', direction: 'desc' }, text: '' });
    expect(readTasksView({ filter: ['mine', 'failed'], q: 3 })).toEqual({ sort: { column: 'updated', direction: 'desc' }, text: '' });
  });
});

describe('what a view asks of Hermes', () => {
  const saved: SavedFilter[] = [{ id: 'abc', name: 'Coder’s failures', definition: { assignee: 'coder', failed: true } }];

  test('each built-in filter is a definition: Mine is the profile in scope', () => {
    const context = { profile: 'writer', saved };
    expect(definitionOf({ filter: { kind: 'mine' }, sort: { column: 'updated', direction: 'desc' }, text: '' }, context)).toEqual({ assignee: 'writer' });
    expect(definitionOf({ filter: { kind: 'waiting' }, sort: { column: 'updated', direction: 'desc' }, text: '' }, context)).toEqual({ waiting: true });
    expect(definitionOf({ filter: { kind: 'failed' }, sort: { column: 'updated', direction: 'desc' }, text: '' }, context)).toEqual({ failed: true });
    expect(definitionOf({ filter: { kind: 'playbook', id: 'release' }, sort: { column: 'updated', direction: 'desc' }, text: '' }, context)).toEqual({ playbook: 'release' });
    expect(definitionOf({ filter: { kind: 'project', id: 'p_site' }, sort: { column: 'updated', direction: 'desc' }, text: '' }, context)).toEqual({ project: 'p_site' });
    expect(definitionOf({ filter: { kind: 'saved', id: 'abc' }, sort: { column: 'updated', direction: 'desc' }, text: '' }, context)).toEqual({ assignee: 'coder', failed: true });
  });

  test('the search words join the filter’s own; no filter and no words is no condition, and a filter that was deleted is not one', () => {
    const context = { profile: 'writer', saved: [{ id: 'abc', name: 'Release', definition: { text: 'release', statuses: ['ready' as const] } }] };
    const sort = { column: 'updated' as const, direction: 'desc' as const };
    expect(definitionOf({ sort, text: '' }, context)).toEqual({});
    expect(definitionOf({ sort, text: 'notes' }, context)).toEqual({ text: 'notes' });
    expect(definitionOf({ filter: { kind: 'saved', id: 'abc' }, sort, text: 'notes' }, context)).toEqual({ statuses: ['ready'], text: 'release notes' });
    expect(definitionOf({ filter: { kind: 'saved', id: 'deleted' }, sort, text: '' }, context)).toBeUndefined();
  });
});

describe('sorting and what the columns say', () => {
  const task = (fields: Partial<BoardTask> & { id: string }): BoardTask => ({
    title: fields.id,
    status: 'ready',
    assignee: null,
    priority: 0,
    tenant: null,
    projectId: null,
    blockKind: null,
    summary: null,
    commentCount: 0,
    createdAt: 100,
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
  const order = (tasks: BoardTask[], column: SortColumn, direction: 'asc' | 'desc', names?: Record<string, string>) => sortTasks(tasks, { column, direction }, names).map((t) => t.id);

  test('a task was updated when something last happened to it', () => {
    expect(updatedAt(task({ id: 'a', createdAt: 100 }))).toBe(100);
    expect(updatedAt(task({ id: 'a', createdAt: 100, startedAt: 300, lastHeartbeatAt: 250 }))).toBe(300);
    expect(updatedAt(task({ id: 'a', createdAt: 100, startedAt: 300, completedAt: 400 }))).toBe(400);
  });

  test('the last run’s outcome is read from what Hermes keeps on the task', () => {
    expect(lastRun(task({ id: 'a' }))).toEqual({ label: 'Not run yet', tone: 'neutral' });
    expect(lastRun(task({ id: 'a', status: 'running', startedAt: 5 }))).toEqual({ label: 'Running', tone: 'running' });
    expect(lastRun(task({ id: 'a', status: 'done', startedAt: 5, completedAt: 9 }))).toEqual({ label: 'Completed', tone: 'success' });
    expect(lastRun(task({ id: 'a', status: 'review', startedAt: 5 }))).toEqual({ label: 'Awaiting review', tone: 'warning' });
    expect(lastRun(task({ id: 'a', status: 'blocked', startedAt: 5, blockKind: 'needs_input' }))).toEqual({ label: 'Asked a question', tone: 'warning' });
    expect(lastRun(task({ id: 'a', status: 'blocked', startedAt: 5 }))).toEqual({ label: 'Blocked', tone: 'blocked' });
    expect(lastRun(task({ id: 'a', status: 'ready', startedAt: 5, failures: 1, lastFailureError: 'crashed' }))).toEqual({ label: 'Failed', tone: 'danger', detail: 'crashed' });
    expect(lastRun(task({ id: 'a', status: 'blocked', startedAt: 5, failures: 3, lastFailureError: 'spawn_failed' }))).toEqual({ label: 'Failed', tone: 'danger', detail: 'spawn_failed' });
  });

  test('every column sorts both ways, equal values keep a steady order, and a task with no value comes last either way', () => {
    const tasks = [
      task({ id: 'c', title: 'Banana', status: 'done', assignee: 'writer', priority: 2, projectId: 'p2', workflowTemplateId: 'release', createdAt: 300 }),
      task({ id: 'a', title: 'apple', status: 'running', assignee: 'coder', priority: 5, projectId: 'p1', workflowTemplateId: 'research', createdAt: 100 }),
      task({ id: 'b', title: 'Cherry', status: 'triage', assignee: null, priority: -1, projectId: null, workflowTemplateId: null, createdAt: 200 }),
    ];
    const names = { p1: 'Zeta site', p2: 'Alpha docs' };
    expect(order(tasks, 'title', 'asc')).toEqual(['a', 'c', 'b']);
    expect(order(tasks, 'title', 'desc')).toEqual(['b', 'c', 'a']);
    expect(order(tasks, 'status', 'asc')).toEqual(['b', 'a', 'c']);
    expect(order(tasks, 'assignee', 'asc')).toEqual(['a', 'c', 'b']);
    expect(order(tasks, 'assignee', 'desc')).toEqual(['c', 'a', 'b']);
    expect(order(tasks, 'priority', 'desc')).toEqual(['a', 'c', 'b']);
    expect(order(tasks, 'priority', 'asc')).toEqual(['b', 'c', 'a']);
    expect(order(tasks, 'project', 'asc', names)).toEqual(['c', 'a', 'b']);
    expect(order(tasks, 'project', 'desc', names)).toEqual(['a', 'c', 'b']);
    expect(order(tasks, 'template', 'asc')).toEqual(['c', 'a', 'b']);
    expect(order(tasks, 'updated', 'desc')).toEqual(['c', 'b', 'a']);
    expect(order(tasks, 'outcome', 'asc')).toEqual(['c', 'b', 'a']);
    const same = [task({ id: 'x', priority: 1 }), task({ id: 'w', priority: 1 })];
    expect(order(same, 'priority', 'asc')).toEqual(['w', 'x']);
    expect(order(same, 'priority', 'desc')).toEqual(['w', 'x']);
  });
});

describe('2,000 tasks', () => {
  // A stub of Hermes's board endpoint with 2,000 tasks spread over the lifecycle, as the page would be given them.
  const STATUSES = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done'];
  const stubBoard = () => ({
    columns: STATUSES.map((name, column) => ({
      name,
      tasks: Array.from({ length: 250 }, (_, index) => {
        const n = column * 250 + index;
        return {
          id: `t_${n.toString(16).padStart(8, '0')}`,
          title: `Task number ${n} for the ${['site', 'docs', 'api', 'infra'][n % 4]} project`,
          assignee: n % 5 === 0 ? null : ['coder', 'writer', 'reviewer'][n % 3],
          priority: n % 7,
          tenant: null,
          project_id: `p_${n % 4}`,
          workflow_template_id: n % 3 === 0 ? 'release' : null,
          created_at: 1_700_000_000 + n,
          started_at: n % 2 === 0 ? 1_700_000_100 + n : null,
          consecutive_failures: n % 11 === 0 ? 1 : 0,
          last_failure_error: n % 11 === 0 ? 'crashed' : null,
          block_kind: name === 'blocked' && n % 2 === 0 ? 'needs_input' : null,
        };
      }),
    })),
    tenants: [],
    assignees: ['coder', 'writer', 'reviewer'],
    latest_event_id: 1,
  });

  test('reading, filtering and sorting them takes a fraction of a second, and only a screenful of rows is ever on show', () => {
    const body = stubBoard();
    const started = performance.now();
    const { tasks } = parseBoard(body);
    expect(tasks).toHaveLength(2000);
    const waiting = selectTasks(tasks, { waiting: true });
    const everything = sortTasks(tasks, { column: 'updated', direction: 'desc' });
    const byTitle = sortTasks(tasks, { column: 'title', direction: 'asc' }, { p_0: 'Site' });
    const searched = selectTasks(tasks, { text: 'number 19 docs' });
    const elapsed = performance.now() - started;
    expect(waiting.length).toBeGreaterThan(0);
    expect(everything).toHaveLength(2000);
    expect(byTitle).toHaveLength(2000);
    expect(searched.length).toBeGreaterThan(0);
    // Generous for a busy machine: this is about 10 ms on an idle one. A pass that loops over the tasks per task would be seconds.
    expect(elapsed).toBeLessThan(1000);

    const shown = rowWindow({ count: 2000, rowHeight: 44, scrollTop: 44 * 900 + 10, viewport: 800, overscan: 5 });
    expect(shown).toEqual({ start: 895, end: 895 + 5 + 19 + 5, before: 895 * 44, after: (2000 - 924) * 44 });
    expect(rowWindow({ count: 2000, rowHeight: 44, scrollTop: 0, viewport: 800, overscan: 5 })).toMatchObject({ start: 0, before: 0 });
    expect(rowWindow({ count: 2000, rowHeight: 44, scrollTop: 10_000_000, viewport: 800, overscan: 5 })).toMatchObject({ end: 2000, after: 0 });
    expect(rowWindow({ count: 0, rowHeight: 44, scrollTop: 0, viewport: 800, overscan: 5 })).toEqual({ start: 0, end: 0, before: 0, after: 0 });
  });
});

describe('column headers and ages', () => {
  test('pressing a header sorts by it, the first time in the direction people expect; pressing it again turns it round', () => {
    const updated = { column: 'updated' as const, direction: 'desc' as const };
    expect(nextSort(updated, 'title')).toEqual({ column: 'title', direction: 'asc' });
    expect(nextSort(updated, 'priority')).toEqual({ column: 'priority', direction: 'desc' });
    expect(nextSort(updated, 'updated')).toEqual({ column: 'updated', direction: 'asc' });
    expect(nextSort({ column: 'updated', direction: 'asc' }, 'updated')).toEqual({ column: 'updated', direction: 'desc' });
  });

  test('an age is the biggest unit that fits, and never negative', () => {
    const now = 1_000_000;
    expect(ageLabel(now - 20, now)).toBe('just now');
    expect(ageLabel(now - 59 * 60, now)).toBe('59m');
    expect(ageLabel(now - 3 * 3600 - 100, now)).toBe('3h');
    expect(ageLabel(now - 2 * 86_400 - 5, now)).toBe('2d');
    expect(ageLabel(now - 45 * 86_400, now)).toBe('6w');
    expect(ageLabel(now - 400 * 86_400, now)).toBe('1y');
    expect(ageLabel(now + 500, now)).toBe('just now');
  });
});

describe('saying what a filter selects', () => {
  test('each condition is a phrase, in words the owner would use, with a project by its name', () => {
    expect(describeDefinition({ assignee: 'coder', failed: true })).toEqual(['assigned to coder', 'failed']);
    expect(describeDefinition({ assignee: 'none', statuses: ['ready', 'running'], priority: 2 })).toEqual(['assigned to nobody', 'status ready or running', 'priority 2']);
    expect(describeDefinition({ waiting: true, playbook: 'release', tenant: 'acme', text: 'notes' })).toEqual(['waiting for you', 'playbook release', 'tenant acme', 'matching “notes”']);
    expect(describeDefinition({ project: 'p_site' }, { p_site: 'Website' })).toEqual(['project Website']);
    expect(describeDefinition({ project: 'p_other' }, { p_site: 'Website' })).toEqual(['project p_other']);
    expect(describeDefinition({})).toEqual([]);
  });
});
