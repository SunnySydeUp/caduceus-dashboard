import { isRecord } from './policy/guards.ts';

// What a saved task filter is (M3 #03): a definition and nothing else. Caduceus keeps definitions in its own store; the tasks they
// select always come from Hermes. The server checks a definition with `readFilterDefinition` before it stores one, and the web
// app reads what the server answers with the same function, so the two never disagree about what a filter may hold.

/** Hermes's task lifecycle as a filter may name it (`archived` is never listed). */
export const FILTER_STATUSES = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done'] as const;
export type FilterStatus = (typeof FILTER_STATUSES)[number];

/** Every condition set must hold for a task to be selected. At least one is set. */
export interface FilterDefinition {
  /** A profile name, or `none` for tasks nobody has. */
  assignee?: string;
  /** Any of these statuses. */
  statuses?: FilterStatus[];
  /** Tasks that wait for the owner: in review, or blocked with a question (`needs_input`). */
  waiting?: true;
  /** Tasks whose latest run failed, or that Hermes gave up on. */
  failed?: true;
  /** `workflow_template_id`: the playbook the task came from. */
  playbook?: string;
  /** A Hermes project id. */
  project?: string;
  tenant?: string;
  /** Hermes's integer priority. */
  priority?: number;
  /** Words that must each appear in the task's id, title, assignee or tenant. */
  text?: string;
}

/** A filter the owner saved. */
export interface SavedFilter {
  id: string;
  name: string;
  definition: FilterDefinition;
}

/** `GET /_caduceus/api/work/filters`. `POST` (a new filter) and `PUT /:id` (rename and/or a new definition) answer a `SavedFilter`. */
export interface SavedFilters {
  filters: SavedFilter[];
}

export const MAX_FILTER_NAME = 60;
export const MAX_FILTER_VALUE = 200;
export const MAX_SAVED_FILTERS = 50;

const isStatus = (value: unknown): value is FilterStatus => FILTER_STATUSES.some((status) => status === value);

const TEXT_KEYS = ['assignee', 'playbook', 'project', 'tenant', 'text'] as const;

/** The definition `value` holds, or `undefined` when it is not one: an unknown key, a wrong type, or nothing set. */
export function readFilterDefinition(value: unknown): FilterDefinition | undefined {
  if (!isRecord(value)) return undefined;
  const definition: FilterDefinition = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((TEXT_KEYS as readonly string[]).includes(key)) {
      if (typeof entry !== 'string' || entry.trim() === '' || entry.length > MAX_FILTER_VALUE) return undefined;
      definition[key as (typeof TEXT_KEYS)[number]] = entry;
    } else if (key === 'statuses') {
      if (!Array.isArray(entry) || entry.length === 0 || !entry.every(isStatus)) return undefined;
      definition.statuses = [...new Set(entry)];
    } else if (key === 'waiting' || key === 'failed') {
      if (entry !== true) return undefined;
      definition[key] = true;
    } else if (key === 'priority') {
      if (typeof entry !== 'number' || !Number.isSafeInteger(entry)) return undefined;
      definition.priority = entry;
    } else return undefined;
  }
  return Object.keys(definition).length === 0 ? undefined : definition;
}

/** A filter's name as it is stored: trimmed, and neither blank nor too long. */
export function readFilterName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name === '' || name.length > MAX_FILTER_NAME ? undefined : name;
}
