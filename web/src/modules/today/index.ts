import { lazyRouteComponent } from '@tanstack/react-router';
import type { AppModule } from '../../app-registry.ts';
import { inboxBadge } from '../inbox/inbox-feed.ts';

/** Today is where the app opens (M8 #03): what needs the owner, what is ready for review, the day's routines and what happened while they were away. The count of what needs a decision sits on it. */
export const todayModule: AppModule = {
  id: 'today',
  title: 'Today',
  icon: 'home',
  desk: 'today',
  path: '/today',
  key: 'h',
  order: 0,
  badge: inboxBadge,
  summary: 'What needs you, what is ready, and what happened while you were away',
  // Today is always every profile's: the tab's profile never filters it, and its chip says All profiles (information architecture §6).
  allProfiles: true,
  // Today is where the app opens: its code is waited for by the router (not by a Suspense fallback), so the shell and Today first paint together.
  routes: [{ path: '/today', screen: lazyRouteComponent(() => import('./Today.tsx'), 'Today') }],
  // Home and the Inbox's decision list were what Today replaced (M8 #08): a bookmark, a notification that was sent before, or an old link lands here.
  redirects: [
    { from: '/home', to: '/today' },
    { from: '/inbox', to: '/today' },
    { from: '/inbox/:itemId', to: '/today' },
  ],
  help: () => import('./help.ts').then((m) => m.todayHelp),
};
