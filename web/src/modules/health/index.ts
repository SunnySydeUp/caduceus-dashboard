import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

export const healthModule: AppModule = {
  id: 'health',
  title: 'Health',
  icon: 'heartbeat',
  desk: 'control',
  group: 'observe',
  // Health is Hermes's and Caduceus's subsystems, not one agent's (information architecture §6).
  allProfiles: true,
  path: '/observe/health',
  key: 'e',
  summary: 'Every subsystem’s state, and the Repairs to fix',
  routes: [{ path: '/observe/health', screen: lazy(() => import('./Health.tsx').then((m) => ({ default: m.Health }))) }],
  help: () => import('./help.ts').then((m) => m.healthHelp),
};
