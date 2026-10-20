import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Config = lazy(() => import('./Config.tsx').then((m) => ({ default: m.Config })));
const ConfigYaml = lazy(() => import('./ConfigYaml.tsx').then((m) => ({ default: m.ConfigYaml })));

/** System › Config: Hermes's configuration as a form made from Hermes's own schema, for the profile this tab is scoped to; the save is Tier 3. The raw YAML editor, import / export, reset and config migrate share its toolbar. */
export const configModule: AppModule = {
  id: 'config',
  title: 'Config',
  icon: 'sliders',
  desk: 'control',
  group: 'system',
  path: '/system/config',
  key: 'o',
  order: 1,
  summary: 'Hermes’s settings: search, compare with the defaults, edit the YAML, import and export',
  profileScoped: true,
  routes: [
    { path: '/system/config', screen: Config },
    { path: '/system/config/yaml', screen: ConfigYaml, title: 'Config YAML', parent: '/system/config' },
    { path: '/system/config/:category', screen: Config, title: 'Config', parent: '/system/config' },
  ],
  help: () => import('./help.ts').then((m) => m.configHelp),
};
