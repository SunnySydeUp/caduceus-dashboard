import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';
import { inboxFeed } from '../inbox/inbox-feed.ts';
import { failedLabel, failedNotices } from './notices-model.ts';

const Notices = lazy(() => import('./Notices.tsx').then((m) => ({ default: m.Notices })));

/** Notices: what the Inbox kept that is not a decision (a job that failed, a gateway that is down, an update) and the activity feed of runs that finished, in Control. Decisions are answered on Today and in the Talk tray. */
export const noticesModule: AppModule = {
  id: 'notices',
  title: 'Notices',
  icon: 'inbox',
  desk: 'control',
  group: 'main',
  path: '/notices',
  order: 3,
  summary: 'What failed or needs a look, and the runs that finished',
  // Notices are cross-profile: they offer "All profiles" (information architecture §6).
  crossProfile: true,
  // What failed, so that a failure is seen on the Notices entry without opening it.
  badge: { subscribe: (listener) => inboxFeed().subscribe(listener), count: () => failedNotices(inboxFeed().get().items), label: failedLabel },
  routes: [
    { path: '/notices', screen: Notices },
    { path: '/notices/:itemId', screen: Notices, title: 'Notices', parent: '/notices' },
  ],
  help: () => import('./help.ts').then((m) => m.noticesHelp),
};
