import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Profiles = lazy(() => import('./Profiles.tsx').then((m) => ({ default: m.Profiles })));
const ProfileBuilder = lazy(() => import('./ProfileBuilder.tsx').then((m) => ({ default: m.ProfileBuilder })));
const ProfileDetail = lazy(() => import('./ProfileDetail.tsx').then((m) => ({ default: m.ProfileDetail })));

/** Agents › Profiles. Skills, Memory, Models and Tools & MCP are modules of their own, in the same Agents group. */
export const profilesModule: AppModule = {
  id: 'profiles',
  title: 'Profiles',
  icon: 'agents',
  desk: 'control',
  group: 'agents',
  path: '/agents/profiles',
  key: 'p',
  order: 1,
  summary: 'Every Hermes profile: its gateway, model, numbers and settings',
  routes: [
    { path: '/agents/profiles', screen: Profiles },
    { path: '/agents/profiles/new', screen: ProfileBuilder, title: 'New profile', parent: '/agents/profiles' },
    { path: '/agents/profiles/:name', screen: ProfileDetail, title: 'Profile', parent: '/agents/profiles' },
    { path: '/agents/profiles/:name/:tab', screen: ProfileDetail, title: 'Profile', parent: '/agents/profiles' },
  ],
  help: () => import('./help.ts').then((m) => m.profilesHelp),
};
