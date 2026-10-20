// The service worker (M0 #12). It caches the app's own files, so the shell opens offline, and nothing else: every decision
// about what is the app's own is `cache-rules.ts`, which has the tests. The build bundles this file as `/sw.js` and injects the
// list of files and the build's version (`web/pwa/vite-plugin.ts`).
//
// Only the types this file uses are declared here: the `WebWorker` library cannot be loaded beside the `DOM` one the app uses.
import { applyBadge, type BadgeApi } from '../app-badge.ts';
import { handlingOf, isStorable, obsoleteCaches, shellCacheName } from './cache-rules.ts';
import { clickTarget, readPush } from './push-rules.ts';

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface ExtendableMessageEvent extends ExtendableEvent {
  readonly data: unknown;
}
interface PushEvent extends ExtendableEvent {
  readonly data: { text(): string } | null;
}
interface NotificationEvent extends ExtendableEvent {
  readonly notification: { close(): void; readonly data: unknown };
}
interface WindowClient {
  readonly url: string;
  readonly focused: boolean;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
}
declare const self: {
  readonly location: Location;
  readonly clients: { claim(): Promise<void>; matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClient[]>; openWindow(url: string): Promise<unknown> };
  readonly registration: { showNotification(title: string, options: { body: string; data: { url: string }; icon: string; badge: string }): Promise<void> };
  readonly navigator: BadgeApi;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'push', listener: (event: PushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: NotificationEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: ExtendableMessageEvent) => void): void;
};

/** The addresses this build stores (`web/pwa/precache.ts`) and the name of this build, both written in by the build. */
declare const __PRECACHE_URLS__: string[];
declare const __BUILD_VERSION__: string;

const CACHE = shellCacheName(__BUILD_VERSION__);
const SHELL = '/index.html';

/** How long a page load waits for the network before the cached shell opens instead: a Caduceus that does not answer should not leave a blank screen. */
const PAGE_LOAD_PATIENCE_MS = 4_000;

/** Stores the whole build or none of it: a half-filled cache would serve a shell whose scripts are missing. */
async function fillCache(): Promise<void> {
  const cache = await caches.open(CACHE);
  try {
    await Promise.all(
      __PRECACHE_URLS__.map(async (url) => {
        // Past the browser's own cache: what is stored is what the server has now.
        const res = await fetch(url, { cache: 'reload' });
        if (!isStorable({ status: res.status, redirected: res.redirected, cacheControl: res.headers.get('cache-control') })) {
          throw new Error(`${url} was not stored: ${res.redirected ? 'redirected' : `HTTP ${res.status}`}`);
        }
        await cache.put(url, res);
      }),
    );
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
}

async function pageOrShell(request: Request): Promise<Response> {
  try {
    return await fetch(request, { signal: AbortSignal.timeout(PAGE_LOAD_PATIENCE_MS) });
  } catch (error) {
    const shell = await (await caches.open(CACHE)).match(SHELL);
    if (shell) return shell;
    throw error;
  }
}

async function fromCache(url: string, request: Request): Promise<Response> {
  return (await (await caches.open(CACHE)).match(url)) ?? fetch(request);
}

self.addEventListener('install', (event) => {
  // The new worker waits (it is not skipped) until the owner accepts "Update available": a page never meets a new build halfway.
  event.waitUntil(fillCache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(obsoleteCaches(await caches.keys(), CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (typeof event.data === 'object' && event.data !== null && 'type' in event.data && event.data.type === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const handling = handlingOf(event.request, __PRECACHE_URLS__, self.location.origin);
  if (handling.kind === 'precache') event.respondWith(fromCache(handling.url, event.request));
  else if (handling.kind === 'shell') event.respondWith(pageOrShell(event.request));
  // `network`: no `respondWith`, so the browser does what it would have done without a worker.
});

// Web Push (M2 #03). A browser that draws declarative messages itself never wakes this; the others hand over the same JSON, and it is shown here. Every push
// shows a notification (`userVisibleOnly`: a browser takes the subscription away from a worker that stays silent). The app badge follows the message's count.
self.addEventListener('push', (event) => {
  const shown = readPush(event.data?.text(), self.location.origin);
  if (shown.badge !== undefined) applyBadge(self.navigator, shown.badge);
  event.waitUntil(self.registration.showNotification(shown.title, { body: shown.body, data: { url: shown.url }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url } = event.notification.data as { url: string };
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = clickTarget(url, windows);
      if (target.kind === 'open') return self.clients.openWindow(url);
      const window = windows[target.index]!;
      await window.navigate(url);
      return window.focus();
    })(),
  );
});
