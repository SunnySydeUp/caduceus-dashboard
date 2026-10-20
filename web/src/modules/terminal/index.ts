import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Terminal = lazy(() => import('./Terminal.tsx').then((m) => ({ default: m.Terminal })));

/** Workspace › Terminal: a real shell the Caduceus server runs in a PTY, in a workspace folder, behind a passkey step-up (T2); the screen is offered on a tablet or computer. */
export const terminalModule: AppModule = {
  id: 'terminal',
  title: 'Terminal',
  icon: 'terminal',
  desk: 'control',
  group: 'workspace',
  path: '/workspace/terminal',
  order: 4,
  summary: 'A real shell on the Mac that runs Caduceus',
  profileScoped: true,
  routes: [{ path: '/workspace/terminal', screen: Terminal }],
  help: () => import('./help.ts').then((m) => m.terminalHelp),
};
