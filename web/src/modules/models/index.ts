import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Models = lazy(() => import('./Models.tsx').then((m) => ({ default: m.Models })));

/** Agents › Models: the main model, the auxiliary slots, the fallback chain, Mixture-of-Agents presets and usage cards of a profile, and the local models Hermes can run on this Mac. */
export const modelsModule: AppModule = {
  id: 'models',
  title: 'Models',
  icon: 'cpu',
  desk: 'control',
  group: 'agents',
  path: '/agents/models',
  order: 2,
  summary: 'Main model, side-task models, fallback chain, Mixture of Agents, usage and local models',
  profileScoped: true,
  routes: [
    { path: '/agents/models', screen: Models },
    { path: '/agents/models/:tab', screen: Models, title: 'Models', parent: '/agents/models' },
  ],
  help: () => import('./help.ts').then((m) => m.modelsHelp),
};
