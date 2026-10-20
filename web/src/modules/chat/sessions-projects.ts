// Hermes's projects as the sessions list uses them (M1 #14), free of the DOM and of React. A Hermes project is a named set of folders; a session
// belongs to the project whose folder holds its working folder, so "moving a session into a project" is Hermes re-homing the session's workspace
// (`session.workspace.move`). The project, its colour and its folders are Hermes's (`projects.*`): Caduceus keeps nothing of them (D1).
import type { SessionGroup, SessionItem } from './sessions-model.ts';

/** The colours a project can have: the design system's status tones, so that a project's colour is a token and never a raw value. */
export const PROJECT_TONES = ['info', 'success', 'warning', 'danger', 'running', 'paused', 'blocked', 'neutral'] as const;
export type ProjectTone = (typeof PROJECT_TONES)[number];

/** The tone a colour Hermes holds stands for; a colour set from somewhere else (a hex value, say) is none of ours. */
export const projectTone = (color: unknown): ProjectTone | undefined => PROJECT_TONES.find((tone) => tone === color);

/** One of the owner's projects, as the list shows it. */
export interface Project {
  id: string;
  name: string;
  tone: ProjectTone | undefined;
  /** The primary folder: where a session moved into the project goes. Absent for a project with no folder. */
  folder: string | undefined;
  archived: boolean;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The projects of `projects.list` (archived ones included: the list says which). A row with no id is not a project. */
export function parseProjects(result: unknown): Project[] {
  const { projects } = record(result);
  return (Array.isArray(projects) ? projects : []).flatMap((raw): Project[] => {
    const row = record(raw);
    if (typeof row.id !== 'string' || row.id === '') return [];
    const folder = typeof row.primary_path === 'string' && row.primary_path !== '' ? row.primary_path : undefined;
    return [{ id: row.id, name: typeof row.name === 'string' ? row.name : row.id, tone: projectTone(row.color), folder, archived: row.archived === true }];
  });
}

/** Which project owns which session, from `projects.tree`: the owner's own projects only, never the Home bucket or the folders Hermes found itself. */
export function parseProjectTree(result: unknown): Record<string, string> {
  const owner: Record<string, string> = {};
  const { projects } = record(result);
  for (const raw of Array.isArray(projects) ? projects : []) {
    const node = record(raw);
    if (node.isAuto === true || node.isNoProject === true || typeof node.id !== 'string') continue;
    for (const id of Array.isArray(node.sessionIds) ? node.sessionIds : []) if (typeof id === 'string') owner[id] = node.id;
  }
  return owner;
}

/** A group of the list that is a project, or (with no `project`) the sessions in none. */
export const NO_PROJECT_GROUP = 'no-project';

/**
 * The sessions grouped by project: a group for every project that is not archived (an empty one too, so that it can be seen and moved into), by name,
 * each with its pinned sessions first, and last the sessions that are in no project (a project Hermes no longer lists is none). The last group is left
 * out when it would be empty.
 */
export function groupByProject(items: readonly SessionItem[], projects: readonly Project[], projectOf: Readonly<Record<string, string>>): SessionGroup[] {
  const live = projects.filter((project) => !project.archived).sort((a, b) => a.name.localeCompare(b.name));
  const known = new Set(live.map((project) => project.id));
  const pinnedFirst = (rows: SessionItem[]) => [...rows.filter((row) => row.pinned), ...rows.filter((row) => !row.pinned)];
  const groups: SessionGroup[] = live.map((project) => ({ id: `project:${project.id}`, label: project.name, items: pinnedFirst(items.filter((item) => projectOf[item.id] === project.id)), project }));
  const loose = items.filter((item) => !known.has(projectOf[item.id] ?? ''));
  return loose.length === 0 ? groups : [...groups, { id: NO_PROJECT_GROUP, label: 'No project', items: pinnedFirst(loose) }];
}
