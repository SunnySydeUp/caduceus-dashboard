import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Checkpoints = lazy(() => import('./Checkpoints.tsx').then((m) => ({ default: m.Checkpoints })));

/** Workspace › Checkpoints: the agent's snapshots of a workspace (`rollback.list`), their diffs and a T3 Restore, through a session Caduceus attaches for the workspace. */
export const checkpointsModule: AppModule = {
  id: 'checkpoints',
  title: 'Checkpoints',
  icon: 'history',
  desk: 'control',
  group: 'workspace',
  path: '/workspace/checkpoints',
  order: 3,
  summary: 'The agent’s snapshots of a workspace: compare and restore',
  profileScoped: true,
  routes: [{ path: '/workspace/checkpoints', screen: Checkpoints }],
  help: () => import('./help.ts').then((m) => m.checkpointsHelp),
};
