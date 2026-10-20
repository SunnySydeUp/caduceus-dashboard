import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Logs = lazy(() => import('./Logs.tsx').then((m) => ({ default: m.Logs })));

/** Observe › Logs: Hermes's log files with filters, search and a live tail (the log relay, R12); Truncate file is a guarded file operation (R11, T3). */
export const logsModule: AppModule = {
  id: 'logs',
  title: 'Logs',
  icon: 'log',
  desk: 'control',
  group: 'observe',
  path: '/observe/logs',
  key: 'l',
  order: 2,
  summary: 'Hermes’s log files: filters, search and a live tail',
  profileScoped: true,
  routes: [{ path: '/observe/logs', screen: Logs }],
  help: () => import('./help.ts').then((m) => m.logsHelp),
};
