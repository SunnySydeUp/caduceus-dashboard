import { describe, expect, test } from 'vitest';
import { groupByProject, parseProjects, parseProjectTree, PROJECT_TONES, projectTone } from '../src/modules/chat/sessions-projects.ts';
import { parseSessions, type SessionItem } from '../src/modules/chat/sessions-model.ts';

// What the sessions list knows of Hermes's projects (`projects.list`, `projects.tree`), read defensively, and the list grouped by them.
const project = (id: string, over: Record<string, unknown> = {}) => ({ id, slug: id, name: id.toUpperCase(), color: null, primary_path: null, archived: false, folders: [], ...over });
const sessions = (...ids: [string, Record<string, unknown>?][]): SessionItem[] =>
  parseSessions({ sessions: ids.map(([id, over]) => ({ id, title: id, source: 'cli', started_at: 100, last_active: 100, ...over })), total: ids.length }).items;

describe('Hermes’s projects', () => {
  test('are read from projects.list: a name, a tone only when it is one of ours, the primary folder, and whether it is archived', () => {
    expect(
      parseProjects({
        projects: [
          project('p_a', { name: 'Trip', color: 'success', primary_path: '/work/trip' }),
          project('p_b', { name: 'Desktop colour', color: '#ff0000' }),
          project('p_c', { name: 'Old', archived: true }),
          { name: 'No id' },
        ],
        active_id: null,
      }),
    ).toEqual([
      { id: 'p_a', name: 'Trip', tone: 'success', folder: '/work/trip', archived: false },
      { id: 'p_b', name: 'Desktop colour', tone: undefined, folder: undefined, archived: false },
      { id: 'p_c', name: 'Old', tone: undefined, folder: undefined, archived: true },
    ]);
    expect(parseProjects(undefined)).toEqual([]);
    expect(parseProjects({ projects: 'nope' })).toEqual([]);
  });

  test('the palette is the design system’s status tones, and a project’s tone is one of them or none', () => {
    expect(PROJECT_TONES).toEqual(['info', 'success', 'warning', 'danger', 'running', 'paused', 'blocked', 'neutral']);
    expect(projectTone('paused')).toBe('paused');
    expect(projectTone('#ff0000')).toBeUndefined();
    expect(projectTone(null)).toBeUndefined();
  });

  test('own the sessions the tree lists under them; the Home bucket and the folders Hermes found on its own are no project of the owner’s', () => {
    expect(
      parseProjectTree({
        projects: [
          { id: 'p_a', isAuto: false, isNoProject: false, sessionIds: ['s1', 's2'] },
          { id: '/work/repo', isAuto: true, isNoProject: false, sessionIds: ['s3'] },
          { id: '__no_project__', isAuto: false, isNoProject: true, sessionIds: ['s4'] },
          { id: 'p_b', isAuto: false, isNoProject: false, sessionIds: ['s5'] },
        ],
      }),
    ).toEqual({ s1: 'p_a', s2: 'p_a', s5: 'p_b' });
    expect(parseProjectTree({})).toEqual({});
  });
});

describe('the list grouped by project', () => {
  const projects = parseProjects({ projects: [project('p_a', { name: 'Trip' }), project('p_b', { name: 'Acme' }), project('p_old', { name: 'Old', archived: true })] });
  const rows = sessions(['s1'], ['s2', { pinned: true }], ['s3'], ['s4'], ['s5']);
  const groups = groupByProject(rows, projects, { s1: 'p_a', s2: 'p_a', s3: 'p_b', s4: 'gone' });

  test('is a group for every project that is not archived, in name order, each with its sessions pinned first, and last the sessions in no project', () => {
    expect(groups.map((group) => [group.id, group.label, group.items.map((item) => item.id)])).toEqual([
      ['project:p_b', 'Acme', ['s3']],
      ['project:p_a', 'Trip', ['s2', 's1']],
      ['no-project', 'No project', ['s4', 's5']],
    ]);
    // A session whose project Hermes no longer lists is in no project.
    expect(groups.at(-1)!.items.map((item) => item.id)).toContain('s4');
  });

  test('keeps a project with nothing in it, so that it can be seen and moved into, and leaves out a "No project" group with nothing in it', () => {
    const empty = groupByProject(sessions(['s1']), projects, { s1: 'p_a' });
    expect(empty.map((group) => [group.id, group.items.length])).toEqual([
      ['project:p_b', 0],
      ['project:p_a', 1],
    ]);
  });

  test('a group of a project carries the project, for its header', () => {
    expect(groups[0]!.project).toEqual({ id: 'p_b', name: 'Acme', tone: undefined, folder: undefined, archived: false });
    expect(groups.at(-1)!.project).toBeUndefined();
  });
});
