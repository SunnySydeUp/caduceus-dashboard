import { useEffect } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { applyBadge } from './app-badge.ts';
import { inboxFeed } from './modules/inbox/inbox-feed.ts';
import { startPresence } from './presence.ts';
import { createAppRegistry } from './modules/index.ts';
import { afterPaint } from './settled.ts';
import { createAppRouter } from './router.tsx';
import { RegistryProvider } from './shell/registry-context.tsx';

const registry = createAppRegistry();
const router = createAppRouter(registry);

/** The signed-in app: the shell and the routes of every registered module. */
export default function App() {
  useEffect(() => {
    // Whether this page is in view (no push is sent while it is), and the app icon's badge: the Inbox's count of what needs a decision.
    // After the first paint, so that its request is not in front of what is being painted.
    let stopPresence: (() => void) | undefined;
    let gone = false;
    void afterPaint().then(() => {
      if (!gone) stopPresence = startPresence();
    });
    const feed = inboxFeed();
    const showBadge = () => {
      const { status, needsDecision } = feed.get();
      // Before the first list there is no count to show, and no news that it is zero.
      if (status === 'live') applyBadge(navigator, needsDecision);
    };
    const stopBadge = feed.subscribe(showBadge);
    return () => {
      gone = true;
      stopPresence?.();
      stopBadge();
    };
  }, []);
  return (
    <RegistryProvider registry={registry}>
      <RouterProvider router={router} />
    </RegistryProvider>
  );
}
