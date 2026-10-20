// What Work › Tasks knows about a list of Kanban tasks, free of the DOM and of React: which tasks a filter selects and what Hermes is
// asked for them. Everything comes from Hermes's answers (D1); a filter is only a definition (`contracts/task-filters.ts`).
import type { FilterDefinition, SavedFilter } from '@caduceus/contracts/task-filters';
import { BOARD_STATUSES, UNASSIGNED, filterTasks, type BoardTask } from './board-model.ts';
import { matchesPlaybook, playbookOfTask } from './task-playbook.ts';

export type { FilterDefinition };

/**
 * The query string that makes Hermes do the filtering it can. The Kanban board endpoint takes `tenant`; every other condition has no parameter
 * there, so `selectTasks` applies it to what Hermes answers. That includes the playbook: while Hermes cannot set `workflow_template_id`, a
 * playbook's tasks are known by the tag in `idempotency_key` (`task-playbook.ts`), which Hermes cannot filter on. When Hermes fills the native
 * fields on tasks it is asked by this engine, `workflow_template_id` can be added here and nothing else changes.
 */
export function hermesQuery(definition: FilterDefinition): string {
  const query = new URLSearchParams();
  if (definition.tenant !== undefined) query.set('tenant', definition.tenant);
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

/** A task waits for the owner when its worker asked for a review or asked a question. */
export const waitsForOwner = (task: BoardTask) => task.status === 'review' || (task.status === 'blocked' && task.blockKind === 'needs_input');

/** The latest run failed, or Hermes gave up on the task. Hermes clears its failure record when a task finishes. */
export const hasFailed = (task: BoardTask) => task.status !== 'done' && (task.failures > 0 || task.lastFailureError !== null);

/** The tasks of `tasks` that meet every condition of `definition`, in their order. The conditions Hermes answered already (`hermesQuery`) hold again, harmlessly. */
export function selectTasks(tasks: readonly BoardTask[], definition: FilterDefinition): BoardTask[] {
  const { assignee, statuses, waiting, failed, playbook, project, tenant, priority, text } = definition;
  const selected = tasks.filter(
    (task) =>
      (assignee === undefined || (assignee === UNASSIGNED ? task.assignee === null : task.assignee === assignee)) &&
      (statuses === undefined || statuses.includes(task.status)) &&
      (!waiting || waitsForOwner(task)) &&
      (!failed || hasFailed(task)) &&
      (playbook === undefined || matchesPlaybook(task, playbook)) &&
      (project === undefined || task.projectId === project) &&
      (tenant === undefined || task.tenant === tenant) &&
      (priority === undefined || task.priority === priority),
  );
  return text === undefined ? selected : filterTasks(selected, { text });
}

/** The filter that is on: one of the built-in ones, or one the owner saved. The address names it, so a bookmark or a link from Today or Notices opens it. */
export type ActiveFilter =
  | { kind: 'mine' }
  | { kind: 'waiting' }
  | { kind: 'failed' }
  /** By playbook: the tasks of one `workflow_template_id`. */
  | { kind: 'playbook'; id: string }
  /** By project: the tasks of one Hermes project. */
  | { kind: 'project'; id: string }
  | { kind: 'saved'; id: string };

export const SORT_COLUMNS = ['title', 'status', 'assignee', 'priority', 'project', 'template', 'updated', 'outcome'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

export interface SortSpec {
  column: SortColumn;
  direction: 'asc' | 'desc';
}

/** What the address of Work › Tasks carries: the filter, the sort and the search words. */
export interface TasksView {
  filter?: ActiveFilter;
  sort: SortSpec;
  /** Words that must each appear in a task's id, title, assignee or tenant. */
  text: string;
}

export const DEFAULT_SORT: SortSpec = { column: 'updated', direction: 'desc' };

const isSortColumn = (value: string): value is SortColumn => SORT_COLUMNS.some((column) => column === value);

const nonBlank = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** Reads `filter=` (`mine`, `waiting`, `failed`, `playbook:<id>`, `project:<id>`, `saved:<id>`); anything else is no filter. */
function readFilter(value: unknown): ActiveFilter | undefined {
  const raw = nonBlank(value);
  if (raw === undefined) return undefined;
  if (raw === 'mine' || raw === 'waiting' || raw === 'failed') return { kind: raw };
  const colon = raw.indexOf(':');
  const kind = raw.slice(0, colon);
  const id = raw.slice(colon + 1);
  if (colon > 0 && id.trim() !== '' && (kind === 'playbook' || kind === 'project' || kind === 'saved')) return { kind, id };
  return undefined;
}

/** Reads the view from the address's query; anything damaged is as if it were not there. */
export function readTasksView(search: Record<string, unknown>): TasksView {
  const filter = readFilter(search.filter);
  const sort = typeof search.sort === 'string' ? search.sort : '';
  const column = sort.replace(/^-/, '');
  return {
    ...(filter === undefined ? {} : { filter }),
    sort: isSortColumn(column) ? { column, direction: sort.startsWith('-') ? 'desc' : 'asc' } : DEFAULT_SORT,
    text: nonBlank(search.q)?.trim() ?? '',
  };
}

/** The query that carries a view; the default view (every task, newest activity first) is no query at all. */
export function tasksSearch({ filter, sort, text }: TasksView): Record<string, string> {
  const search: Record<string, string> = {};
  if (filter !== undefined) search.filter = filter.kind === 'playbook' || filter.kind === 'project' || filter.kind === 'saved' ? `${filter.kind}:${filter.id}` : filter.kind;
  if (sort.column !== DEFAULT_SORT.column || sort.direction !== DEFAULT_SORT.direction) search.sort = `${sort.direction === 'desc' ? '-' : ''}${sort.column}`;
  if (text.trim() !== '') search.q = text.trim();
  return search;
}

export interface FilterContext {
  /** The profile in scope: what Mine means. */
  profile: string;
  saved: readonly SavedFilter[];
}

/** The conditions a view puts on tasks: its filter's, with the search words added. `undefined` when the filter is a saved one that no longer exists. */
export function definitionOf({ filter, text }: TasksView, { profile, saved }: FilterContext): FilterDefinition | undefined {
  let definition: FilterDefinition = {};
  if (filter?.kind === 'mine') definition = { assignee: profile };
  else if (filter?.kind === 'waiting') definition = { waiting: true };
  else if (filter?.kind === 'failed') definition = { failed: true };
  else if (filter?.kind === 'playbook') definition = { playbook: filter.id };
  else if (filter?.kind === 'project') definition = { project: filter.id };
  else if (filter?.kind === 'saved') {
    const found = saved.find((candidate) => candidate.id === filter.id);
    if (found === undefined) return undefined;
    definition = { ...found.definition };
  }
  const words = [definition.text, text].filter((part): part is string => part !== undefined && part !== '').join(' ');
  if (words === '') return definition;
  return { ...definition, text: words };
}

/** When something last happened to a task. Hermes keeps no `updated_at`, so it is the latest of the times it does keep. */
export function updatedAt(task: BoardTask): number {
  return Math.max(task.createdAt, task.startedAt ?? 0, task.completedAt ?? 0, task.lastHeartbeatAt ?? 0);
}

export interface RunOutcome {
  label: string;
  /** The `data-tone` a badge shows it in. */
  tone: 'neutral' | 'running' | 'success' | 'warning' | 'blocked' | 'danger';
  /** What Hermes recorded for a failure. */
  detail?: string;
}

/**
 * How the task's last run ended, as far as the board can say. The board endpoint lists tasks, not their runs, so this reads what
 * Hermes keeps on the task itself: its status, its block kind and its failure record. The run's own outcome row is in the task page.
 */
export function lastRun(task: BoardTask): RunOutcome {
  if (hasFailed(task)) return { label: 'Failed', tone: 'danger', ...(task.lastFailureError === null ? {} : { detail: task.lastFailureError }) };
  if (task.status === 'running') return { label: 'Running', tone: 'running' };
  if (task.status === 'done') return { label: 'Completed', tone: 'success' };
  if (task.startedAt === null) return { label: 'Not run yet', tone: 'neutral' };
  if (task.status === 'review') return { label: 'Awaiting review', tone: 'warning' };
  if (task.status === 'blocked') return task.blockKind === 'needs_input' ? { label: 'Asked a question', tone: 'warning' } : { label: 'Blocked', tone: 'blocked' };
  return { label: 'Not finished', tone: 'neutral' };
}

const STATUS_ORDER = new Map<string, number>(BOARD_STATUSES.map((status, index) => [status, index]));

/** The value a column sorts on; `null` for a task that has none (it comes last in either direction). */
function sortKey(task: BoardTask, column: SortColumn, projectNames: Record<string, string>): string | number | null {
  switch (column) {
    case 'title':
      return task.title;
    case 'status':
      return STATUS_ORDER.get(task.status) ?? null;
    case 'assignee':
      return task.assignee;
    case 'priority':
      return task.priority;
    case 'project':
      return task.projectId === null ? null : (projectNames[task.projectId] ?? task.projectId);
    case 'template':
      return playbookOfTask(task)?.key ?? null;
    case 'updated':
      return updatedAt(task);
    case 'outcome':
      return lastRun(task).label;
  }
}

/** `tasks` ordered by the column. Equal values and ties keep the order of their ids, so the list never shuffles between loads. */
export function sortTasks(tasks: readonly BoardTask[], { column, direction }: SortSpec, projectNames: Record<string, string> = {}): BoardTask[] {
  const sign = direction === 'asc' ? 1 : -1;
  return tasks
    .map((task) => ({ task, key: sortKey(task, column, projectNames) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) return a.key === b.key ? a.task.id.localeCompare(b.task.id) : a.key === null ? 1 : -1;
      const order = typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : String(a.key).localeCompare(String(b.key), undefined, { sensitivity: 'base' });
      return order === 0 ? a.task.id.localeCompare(b.task.id) : order * sign;
    })
    .map(({ task }) => task);
}

export interface RowWindow {
  /** First row to put in the page. */
  start: number;
  /** One past the last row to put in the page. */
  end: number;
  /** Height standing in for the rows before `start` and after `end`. */
  before: number;
  after: number;
}

/** Which rows of a list of `count` rows, each `rowHeight` pixels tall, are in the page for a viewport at `scrollTop`, with `overscan` extra rows either side. Constant time. */
export function rowWindow({ count, rowHeight, scrollTop, viewport, overscan }: { count: number; rowHeight: number; scrollTop: number; viewport: number; overscan: number }): RowWindow {
  if (count === 0) return { start: 0, end: 0, before: 0, after: 0 };
  const first = Math.min(count - 1, Math.max(0, Math.floor(scrollTop / rowHeight)));
  const last = Math.min(count - 1, Math.max(first, Math.floor((scrollTop + viewport - 1) / rowHeight)));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, last + 1 + overscan);
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}

/** The columns whose first press puts the biggest or newest first. */
const DESCENDING_FIRST: readonly SortColumn[] = ['priority', 'updated'];

/** What pressing a column header does: sort by it (the way people expect for that column), or turn the order round when it is already the sort. */
export function nextSort(current: SortSpec, column: SortColumn): SortSpec {
  if (current.column === column) return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { column, direction: DESCENDING_FIRST.includes(column) ? 'desc' : 'asc' };
}

/** How long ago `seconds` (since the epoch) was, as a card says it: the biggest unit that fits. */
export function ageLabel(seconds: number, now: number): string {
  const age = Math.max(0, now - seconds);
  if (age < 60) return 'just now';
  if (age < 3600) return `${Math.floor(age / 60)}m`;
  if (age < 86_400) return `${Math.floor(age / 3600)}h`;
  if (age < 7 * 86_400) return `${Math.floor(age / 86_400)}d`;
  if (age < 365 * 86_400) return `${Math.floor(age / (7 * 86_400))}w`;
  return `${Math.floor(age / (365 * 86_400))}y`;
}

/** What a definition selects, one phrase per condition, for the save dialog and the chip that is on. `projectNames` turns a project id into its name. */
export function describeDefinition(definition: FilterDefinition, projectNames: Record<string, string> = {}): string[] {
  const phrases: string[] = [];
  if (definition.assignee !== undefined) phrases.push(definition.assignee === UNASSIGNED ? 'assigned to nobody' : `assigned to ${definition.assignee}`);
  if (definition.statuses !== undefined) phrases.push(`status ${definition.statuses.join(' or ')}`);
  if (definition.waiting) phrases.push('waiting for you');
  if (definition.failed) phrases.push('failed');
  if (definition.playbook !== undefined) phrases.push(`playbook ${definition.playbook}`);
  if (definition.project !== undefined) phrases.push(`project ${projectNames[definition.project] ?? definition.project}`);
  if (definition.tenant !== undefined) phrases.push(`tenant ${definition.tenant}`);
  if (definition.priority !== undefined) phrases.push(`priority ${definition.priority}`);
  if (definition.text !== undefined) phrases.push(`matching “${definition.text}”`);
  return phrases;
}
