import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Artifacts = lazy(() => import('./Artifacts.tsx').then((m) => ({ default: m.Artifacts })));

/** Workspace › Artifacts: the reports and files runs, tasks and chats handed in (M6 #05), kept by Caduceus, filtered by source and kind, viewed, downloaded and deleted with an undo. */
export const artifactsModule: AppModule = {
  id: 'artifacts',
  title: 'Artifacts',
  icon: 'package',
  desk: 'control',
  group: 'workspace',
  path: '/workspace/artifacts',
  order: 5,
  summary: 'Reports and files that runs, tasks and chats handed in',
  routes: [{ path: '/workspace/artifacts', screen: Artifacts }],
  help: () => import('./help.ts').then((m) => m.artifactsHelp),
};
