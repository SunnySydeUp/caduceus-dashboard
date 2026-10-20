import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '../../docs/design/tokens.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/sigil.css';
import './app.css';
import { registerServiceWorker } from './pwa.ts';
import { captureInstallEvents } from './shell/install.ts';
import { startThemeColorSync } from './shell/theme-color.ts';

// The shell and its modules load only for signed-in pages; the sign-in screen is a chunk of its own, so a signed-in first load carries none of it.
const SignIn = lazy(() => import('./SignIn.tsx').then((m) => ({ default: m.SignIn })));
// A share link's page is for visitors with no session: it loads the snapshot and nothing of the shell, the gateway or the owner's data.
const SharePage = lazy(() => import('./modules/shares/SharePage.tsx').then((m) => ({ default: m.SharePage })));

// Before anything renders, so that none of it is missed: the browser's install event, which can fire before the app has loaded,
// the service worker, and the title bar colour.
captureInstallEvents();
registerServiceWorker();
startThemeColorSync();

// The server sends signed-out page loads to /sign-in.
const signIn = location.pathname === '/sign-in';
const shared = location.pathname.startsWith('/share/');
const root = createRoot(document.getElementById('root')!);
if (signIn) {
  root.render(
    <StrictMode>
      <Suspense fallback={null}>
        <SignIn />
      </Suspense>
    </StrictMode>,
  );
} else if (shared) {
  root.render(
    <StrictMode>
      <Suspense fallback={null}>
        <SharePage />
      </Suspense>
    </StrictMode>,
  );
} else {
  // The shell is rendered once its code is in, not under a Suspense fallback: React holds back what follows a fallback for 300 ms, and the first
  // screen would wait for that (the chunk is fetched beside this file, so it is in a moment later).
  void import('./App.tsx').then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
