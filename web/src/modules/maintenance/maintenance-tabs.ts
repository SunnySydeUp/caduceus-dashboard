// The tabs of System › Maintenance, in their order (M5 #12 Updates, #13 Diagnostics, Console and API reference, #14 Backup). The console
// is a terminal, which a phone is not made for: its tab is not shown there (`consoleHiddenOn`), and Diagnostics offers it through "open anyway".
import type { IconName } from '../../icons.tsx';

export interface MaintenanceTab {
  id: 'updates' | 'diagnostics' | 'backup' | 'console' | 'api';
  label: string;
  icon: IconName;
  path: string;
}

export const MAINTENANCE_TABS: readonly MaintenanceTab[] = [
  { id: 'updates', label: 'Updates', icon: 'download', path: '/system/maintenance' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'heartbeat', path: '/system/maintenance/diagnostics' },
  { id: 'backup', label: 'Backup', icon: 'archive', path: '/system/maintenance/backup' },
  { id: 'console', label: 'Console', icon: 'terminal', path: '/system/maintenance/console' },
  { id: 'api', label: 'API reference', icon: 'code', path: '/system/maintenance/api' },
];
