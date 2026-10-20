import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Files = lazy(() => import('./Files.tsx').then((m) => ({ default: m.Files })));

/** Workspace › Files: the managed root's folders, previews, text edits (snapshot first, T1 in a workspace and T3 elsewhere), upload, new folder, download and delete. */
export const filesModule: AppModule = {
  id: 'files',
  title: 'Files',
  icon: 'folder',
  desk: 'control',
  group: 'workspace',
  path: '/workspace/files',
  order: 1,
  summary: 'Browse, preview and edit the files Hermes works on',
  profileScoped: true,
  routes: [
    { path: '/workspace/files', screen: Files },
    { path: '/workspace/files/*path', screen: Files, parent: '/workspace/files' },
  ],
  help: () => import('./help.ts').then((m) => m.filesHelp),
};
