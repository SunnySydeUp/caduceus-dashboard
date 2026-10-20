import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

/**
 * The setup wizard (M5 #16): the first-sign-in guide through Hermes and device checks, a provider with the recommended model, a default workspace and
 * notifications. Progress is the owner's, kept on the Caduceus server, so it resumes on any device. Today offers it until it is finished or skipped, and
 * Settings › Setup guide opens it again: the wizard is that Settings panel's screen, so there is one route and "back" leads to Settings.
 */
export const onboardingModule: AppModule = {
  id: 'onboarding',
  title: 'Setup guide',
  icon: 'flag',
  desk: 'control',
  group: 'settings',
  path: '/onboarding',
  summary: 'Check Hermes and this device, set up a provider, a default folder and notifications',
  // The provider, the model and the default folder are the profile's.
  profileScoped: true,
  routes: [],
  settings: [
    {
      id: 'setup',
      title: 'Setup guide',
      summary: 'First-time setup: checks, a provider, a default folder and notifications. Open it again any time',
      icon: 'flag',
      path: '/onboarding',
      parent: '/settings',
      screen: lazy(() => import('./Onboarding.tsx').then((m) => ({ default: m.Onboarding }))),
      fields: [{ id: 'guide', label: 'Setup guide', description: 'Open the first-time setup again: checks, provider, default folder and notifications', keywords: ['onboarding', 'wizard', 'first run', 'getting started', 'welcome', 'set up', 'reopen'] }],
    },
  ],
  help: () => import('./help.ts').then((m) => m.onboardingHelp),
};
