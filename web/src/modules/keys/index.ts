import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Keys = lazy(() => import('./Keys.tsx').then((m) => ({ default: m.Keys })));

/** System › Keys: the provider keys, account sign-ins, credential pools and custom endpoints of the profile this tab is scoped to, and the Nous Portal account. A key is shown masked; the one way to see it is the audited reveal (Tier 3). */
export const keysModule: AppModule = {
  id: 'keys',
  title: 'Keys',
  icon: 'key',
  desk: 'control',
  group: 'system',
  path: '/system/keys',
  order: 2,
  summary: 'Provider keys, account sign-ins, pooled credentials and custom endpoints',
  profileScoped: true,
  routes: [{ path: '/system/keys', screen: Keys }],
  help: () => import('./help.ts').then((m) => m.keysHelp),
};
