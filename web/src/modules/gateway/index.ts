import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';
import { runGatewayAction } from '../../gateway-actions.ts';
import { toast } from '../../shell/toasts.ts';

const Gateway = lazy(() => import('./Gateway.tsx').then((m) => ({ default: m.Gateway })));
const Migrate = lazy(() => import('./Migrate.tsx').then((m) => ({ default: m.Migrate })));

/** The profile this tab works on, from its address; the palette has no other way to know it. Without one, the root profile's gateway. */
function restartTabGateway(): void {
  const profile = new URLSearchParams(location.search).get('profile') ?? 'default';
  void runGatewayAction('restart', profile).then((outcome) => {
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    else if (outcome.kind === 'done') toast(`Restarting the gateway of ${profile}`, { detail: 'The Gateway page follows what Hermes reports.' });
  });
}

/** Connect › Gateway. Channels, Pairing and Webhooks are modules of their own, in the same Connect group. */
export const gatewayModule: AppModule = {
  id: 'gateway',
  title: 'Gateway',
  icon: 'broadcast',
  desk: 'control',
  group: 'connect',
  path: '/connect/gateway',
  key: 'n',
  order: 1,
  summary: 'Whether each profile’s messaging gateway runs; start, stop, restart',
  routes: [
    { path: '/connect/gateway', screen: Gateway },
    { path: '/connect/gateway/migrate', screen: Migrate, title: 'Move to one shared gateway', parent: '/connect/gateway' },
  ],
  paletteCommands: () => [{ id: 'restart-gateway', label: 'Restart gateway', icon: 'refresh', sub: 'The gateway of this tab’s profile', tier: 'T2', run: restartTabGateway }],
  help: () => import('./help.ts').then((m) => m.gatewayHelp),
};
