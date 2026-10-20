import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Git = lazy(() => import('./Git.tsx').then((m) => ({ default: m.Git })));

/** Workspace › Git: status, diffs, stage, commit (with an AI message), push, discard, branches and worktrees, through Hermes's git routes. */
export const gitModule: AppModule = {
  id: 'git',
  title: 'Git',
  icon: 'git',
  desk: 'control',
  group: 'workspace',
  path: '/workspace/git',
  order: 2,
  summary: 'Status, diffs, commits and branches of a repository',
  profileScoped: true,
  routes: [{ path: '/workspace/git', screen: Git }],
  help: () => import('./help.ts').then((m) => m.gitHelp),
};
