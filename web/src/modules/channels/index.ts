import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Channels = lazy(() => import('./Channels.tsx').then((m) => ({ default: m.Channels })));

/** Connect › Channels: every messaging platform Hermes supports, for the profile this tab is scoped to, and each one's behaviour settings. Pairing and Webhooks are modules of their own, in the same Connect group. */
export const channelsModule: AppModule = {
  id: 'channels',
  title: 'Channels',
  icon: 'plug',
  desk: 'control',
  group: 'connect',
  path: '/connect/channels',
  key: 'k',
  order: 2,
  summary: 'The chat apps Hermes answers you on: set up, test, enable',
  keywords: ['telegram', 'discord', 'slack', 'whatsapp', 'email', 'signal', 'matrix', 'sms', 'imessage', 'teams', 'messaging', 'chat apps', 'bot', 'platform'],
  profileScoped: true,
  routes: [{ path: '/connect/channels', screen: Channels }],
  help: () => import('./help.ts').then((m) => m.channelsHelp),
};
