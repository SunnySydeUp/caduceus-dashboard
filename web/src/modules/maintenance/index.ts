import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Updates = lazy(() => import('./Maintenance.tsx').then((m) => ({ default: m.UpdatesScreen })));
const Diagnostics = lazy(() => import('./Diagnostics.tsx').then((m) => ({ default: m.Diagnostics })));
const Backup = lazy(() => import('./Backup.tsx').then((m) => ({ default: m.Backup })));
const Console = lazy(() => import('./Console.tsx').then((m) => ({ default: m.Console })));
const ApiReference = lazy(() => import('./ApiReference.tsx').then((m) => ({ default: m.ApiReference })));

/**
 * System › Maintenance: keeping Hermes and Caduceus current and in good order. Updates (M5 #12): the check, the update with its drain, live log and receipt,
 * Caduceus's own update, and What's New. Diagnostics, the console and the API reference (M5 #13). Backup (M5 #14): make, download and restore a backup, and prune checkpoints.
 */
export const maintenanceModule: AppModule = {
  id: 'maintenance',
  title: 'Maintenance',
  icon: 'tool',
  desk: 'control',
  group: 'system',
  path: '/system/maintenance',
  order: 4,
  summary: 'Update Hermes and Caduceus, run diagnostics, back up and restore, restart, the console and the API reference',
  routes: [
    { path: '/system/maintenance', screen: Updates },
    { path: '/system/maintenance/diagnostics', screen: Diagnostics, title: 'Diagnostics', parent: '/system/maintenance' },
    { path: '/system/maintenance/backup', screen: Backup, title: 'Backup', parent: '/system/maintenance' },
    { path: '/system/maintenance/console', screen: Console, title: 'Console', parent: '/system/maintenance' },
    { path: '/system/maintenance/api', screen: ApiReference, title: 'API reference', parent: '/system/maintenance' },
  ],
  help: () => import('./help.ts').then((m) => m.maintenanceHelp),
};
