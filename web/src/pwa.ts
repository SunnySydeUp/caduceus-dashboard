// The page's side of the service worker (M0 #12; the worker is `sw/service-worker.ts`): registers it, notices a new build waiting,
// and applies it when the owner accepts. It is on the start-up path of every page, the sign-in screen's too, so it stays small.
import { useSyncExternalStore } from 'react';

let waiting: ServiceWorker | undefined;
/** The owner accepted "Update available": the next change of worker is the new build taking over, so reload into it. */
let applying = false;
const listeners = new Set<() => void>();

const publish = (next: ServiceWorker | undefined) => {
  waiting = next;
  listeners.forEach((notify) => notify());
};

/**
 * Registers the worker once the page has loaded (so it never competes with the page for the network), and from then on looks for a
 * new build whenever the app comes back to the foreground or the device comes back online, never on a timer. A new build installs in
 * the background and then waits: `useUpdateAvailable` says so, and `applyUpdate` lets it take over. Does nothing without
 * service worker support, or outside a production build (Vite's dev server has no `sw.js`).
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const { serviceWorker } = navigator;
  serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload();
  });
  window.addEventListener('load', async () => {
    let registration: ServiceWorkerRegistration;
    try {
      registration = await serviceWorker.register('/sw.js', { scope: '/' });
    } catch {
      // No worker (an insecure origin, a blocked browser): the app works as a website.
      return;
    }
    // A worker waiting while another controls the page is an update; with no controller it is the first install, which needs no prompt.
    const notice = () => {
      if (registration.waiting && serviceWorker.controller) publish(registration.waiting);
    };
    notice();
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => installing.state === 'installed' && notice());
    });
    const lookForUpdate = () => void registration.update().catch(() => undefined);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && lookForUpdate());
    window.addEventListener('online', lookForUpdate);
  });
}

/** Lets the waiting build take over; the page reloads into it as soon as it has. */
export function applyUpdate(): void {
  applying = true;
  waiting?.postMessage({ type: 'skip-waiting' });
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

/** Whether a new build is installed and waiting for the owner to accept it. */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(subscribe, () => waiting !== undefined);
}
