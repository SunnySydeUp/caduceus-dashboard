import { describe, expect, test } from 'vitest';
import { parseProjectTree } from '../src/modules/work/projects-model.ts';

// Hermes's tree as it answers when some sessions belong to no project: a "Home" bucket whose one repo has no folder (`path: null`) and the id
// `__no_project__`. Git, Checkpoints and Files offer the tree's repositories as folders to open, so a repo that is no folder must not be one of them.
const HOME_BUCKET = {
  id: '__no_project__',
  label: 'Home',
  path: null,
  isAuto: false,
  isNoProject: true,
  sessionCount: 4,
  repos: [{ id: '__no_project__', label: 'Home', path: null, sessionCount: 4 }],
};
const SITE = { id: '/work/site', label: 'site', path: '/work/site', isAuto: true, isNoProject: false, sessionCount: 2, repos: [{ id: '/work/site', label: 'site', path: '/work/site', sessionCount: 2 }] };

describe('the projects tree', () => {
  test('the Home bucket has no repositories: it is sessions, not a folder', () => {
    const tree = parseProjectTree({ projects: [SITE, HOME_BUCKET] });
    expect(tree.projects.map((project) => [project.id, project.repos.map((repo) => repo.path)])).toEqual([
      ['/work/site', ['/work/site']],
      ['__no_project__', []],
    ]);
  });
});
