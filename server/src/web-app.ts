// The installable web app as the Caduceus server serves it (M0 #12): the built `web/dist` at `/`, which files anyone may load,
// and how each is cached.
import type { Context, Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import type { AuthEnv } from './auth-routes.ts';

/**
 * Files of the web app that a browser must be able to load without a session, because it asks for them without its cookies or
 * before anyone has signed in, and none of them holds anything but the app itself:
 * - the manifest (fetched without credentials unless the page says otherwise), and the icons it names;
 * - the service worker script (a redirect to the sign-in page would make its update check fail, and a browser never follows
 *   one for a worker script);
 * - the shell's `index.html`, which the service worker precaches (the sign-in page serves the same bytes) and the hashed
 *   files under `/assets/`.
 */
export function isPublicWebAsset(pathname: string): boolean {
  return pathname === '/manifest.webmanifest' || pathname === '/sw.js' || pathname === '/index.html' || pathname.startsWith('/icons/') || pathname.startsWith('/assets/');
}

/**
 * The app's hashed scripts, styles and fonts: files a browser loads as parts of a page and never shows or runs as a page of their own, so the headers
 * that are about a page (the content security policy, framing, the referrer policy) mean nothing on them.
 */
export function isSubresourceFile(pathname: string): boolean {
  return /^\/assets\/[^/]+\.(?:js|css|woff2?)$/.test(pathname);
}

/**
 * How long a browser may keep what it was served. Hashed files under `/assets/` never change, so they are kept for good.
 * Everything else (the HTML, the manifest, the service worker script, the icons) is revalidated on every use: a new build
 * must reach a browser at once, and the service worker script above all (a browser updates a worker only when its bytes change).
 */
export function cacheControlFor(pathname: string): string {
  return pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/**
 * The pages the app opens on (`/` goes to Today at once) and the one read Today waits for. The document's own answer tells the browser to start that read
 * (`Link: rel=preload`), so on a slow network it is in flight while the scripts download and is there when Today draws, instead of being asked for once they
 * have run (`npm run perf`: the largest paint of Today is that read's answer). The page's `fetch` of the same address takes it.
 */
const OPENING_READ = '</_caduceus/api/today/ready>; rel=preload; as=fetch; crossorigin';
const OPENING_PAGES: ReadonlySet<string> = new Set(['/', '/today']);

/**
 * Serves `webRoot` at `/` (files, precompressed `.br` / `.gz` siblings when the browser takes them) and answers every other
 * path with the app shell, since client-side routes all render it. A missing hashed asset is a plain 404, though: the shell
 * served in its place is HTML a browser would try to run as a script.
 */
export function mountWebApp(app: Hono<AuthEnv>, webRoot: string): void {
  const headers = (_file: string, c: Context) => {
    c.header('Cache-Control', cacheControlFor(c.req.path));
    // The worker controls the whole origin, whatever a proxy in front puts at its path.
    if (c.req.path === '/sw.js') c.header('Service-Worker-Allowed', '/');
    if (OPENING_PAGES.has(c.req.path)) c.header('Link', OPENING_READ);
  };
  app.use('*', serveStatic({ root: webRoot, precompressed: true, onFound: headers }));
  app.get('/assets/*', (c) => c.notFound());
  app.get('*', serveStatic({ path: path.join(webRoot, 'index.html'), precompressed: true, onFound: headers }));
}
