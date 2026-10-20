import type { AppModule, AppRegistry, Screen } from '../app-registry.ts';
import { createModuleRegistry } from '../module-registry.ts';
import { artifactsModule } from './artifacts/index.ts';
import { channelsModule } from './channels/index.ts';
import { chatModule } from './chat/index.ts';
import { checkpointsModule } from './checkpoints/index.ts';
import { configModule } from './config/index.ts';
import { filesModule } from './files/index.ts';
import { gatewayModule } from './gateway/index.ts';
import { gitModule } from './git/index.ts';
import { healthModule } from './health/index.ts';
import { insightsModule } from './insights/index.ts';
import { keysModule } from './keys/index.ts';
import { logsModule } from './logs/index.ts';
import { maintenanceModule } from './maintenance/index.ts';
import { memoryModule } from './memory/index.ts';
import { modelsModule } from './models/index.ts';
import { noticesModule } from './notices/index.ts';
import { onboardingModule } from './onboarding/index.ts';
import { pairingModule } from './pairing/index.ts';
import { pluginsModule } from './plugins/index.ts';
import { profilesModule } from './profiles/index.ts';
import { skillsModule } from './skills/index.ts';
import { terminalModule } from './terminal/index.ts';
import { todayModule } from './today/index.ts';
import { toolsModule } from './tools/index.ts';
import { settingsModule } from './settings/index.ts';
import { projectsModule, schedulesModule, tasksModule, playbooksModule, workDeskModule, workModule } from './work/index.ts';
import { webhooksModule } from './webhooks/index.ts';

/** The modules the app ships with. A new feature area is one more entry here, plus its own folder; the shell is untouched. */
export const builtInModules: AppModule[] = [
  todayModule,
  chatModule,
  noticesModule,
  workDeskModule,
  workModule,
  tasksModule,
  schedulesModule,
  playbooksModule,
  projectsModule,
  profilesModule,
  modelsModule,
  skillsModule,
  memoryModule,
  toolsModule,
  gatewayModule,
  channelsModule,
  pairingModule,
  webhooksModule,
  filesModule,
  gitModule,
  checkpointsModule,
  terminalModule,
  artifactsModule,
  insightsModule,
  logsModule,
  healthModule,
  configModule,
  keysModule,
  pluginsModule,
  maintenanceModule,
  settingsModule,
  onboardingModule,
];

export function createAppRegistry(modules: AppModule[] = builtInModules): AppRegistry {
  const registry = createModuleRegistry<Screen>();
  modules.forEach((module) => registry.register(module));
  // The sign-in screen, More and how the shell works belong to no module.
  registry.addHelp('shell', () => import('../shell/shell-help.ts').then((m) => m.shellHelp));
  return registry;
}
