import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Pairing = lazy(() => import('./Pairing.tsx').then((m) => ({ default: m.Pairing })));

/** Connect › Pairing: the people who asked a bot for access and the people who have it, for the profile this tab is scoped to. */
export const pairingModule: AppModule = {
  id: 'pairing',
  title: 'Pairing',
  icon: 'user-plus',
  desk: 'control',
  group: 'connect',
  path: '/connect/pairing',
  order: 3,
  summary: 'Approve or revoke the people who message your bots',
  profileScoped: true,
  routes: [{ path: '/connect/pairing', screen: Pairing }],
  help: () => import('./help.ts').then((m) => m.pairingHelp),
};
