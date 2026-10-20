import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Webhooks = lazy(() => import('./Webhooks.tsx').then((m) => ({ default: m.Webhooks })));

/** Connect › Webhooks: Hermes's webhook receiver and the subscriptions of the profile this tab is scoped to, with each secret shown once at creation. */
export const webhooksModule: AppModule = {
  id: 'webhooks',
  title: 'Webhooks',
  icon: 'webhook',
  desk: 'control',
  group: 'connect',
  path: '/connect/webhooks',
  order: 4,
  summary: 'Addresses outside services post events to, with one-time secrets',
  profileScoped: true,
  routes: [{ path: '/connect/webhooks', screen: Webhooks }],
  help: () => import('./help.ts').then((m) => m.webhooksHelp),
};
