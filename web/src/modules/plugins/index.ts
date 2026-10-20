import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Installed = lazy(() => import('./Plugins.tsx').then((m) => ({ default: m.InstalledScreen })));
const Catalogue = lazy(() => import('./Plugins.tsx').then((m) => ({ default: m.CatalogueScreen })));

/** System › Plugins: Hermes's agent plugins (turn on or off, update, remove), installing from a git address or from Hermes's curated catalogue, with a live log. Hermes holds the plugins and their state; Caduceus keeps none. */
export const pluginsModule: AppModule = {
  id: 'plugins',
  title: 'Plugins',
  icon: 'puzzle',
  desk: 'control',
  group: 'system',
  path: '/system/plugins',
  order: 3,
  summary: 'Hermes plugins: turn them on or off, install from git or the catalogue, update and remove',
  routes: [
    { path: '/system/plugins', screen: Installed },
    { path: '/system/plugins/catalogue', screen: Catalogue, title: 'Plugin catalogue', parent: '/system/plugins' },
  ],
  help: () => import('./help.ts').then((m) => m.pluginsHelp),
};
