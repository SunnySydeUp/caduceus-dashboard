// What the service worker does with a request (M0 #12). Pure: no `self`, no caches, no network, so `web/test/sw-cache-rules.test.ts`
// decides every case. `service-worker.ts` only carries the decisions out.

/**
 * What the worker does with a request:
 * - `precache`: the app's own file, answered from the cache the build filled (`url` is its key);
 * - `shell`: a page load of an app route; the network answers it, and when the network cannot, the cached shell does;
 * - `network`: not the worker's business. It does not touch the request, so the browser fetches as if no worker existed,
 *   and nothing about it is ever kept.
 */
export type Handling = { kind: 'precache'; url: string } | { kind: 'shell' } | { kind: 'network' };

/** The request as the worker sees it (a `Request` has all three). */
export interface RequestFacts {
  method: string;
  /** `navigate` for a page load. */
  mode: string;
  url: string;
}

/**
 * The paths whose answers are never kept, by the worker or by anything else (the server sends them `no-store`): the Caduceus
 * API (sign-in, session, passkeys, step-up, health, preferences) and the Hermes proxy (every answer from Hermes, a revealed
 * secret among them). They win over the precache list, so a list that named one by mistake still would not serve it.
 */
const NEVER_KEPT_PREFIXES = ['/_caduceus/', '/api/'];

/** Addresses that are files, not pages of the app: a page load of one is the server's to answer, never the shell. */
const FILE_PREFIXES = ['/assets/', '/icons/'];

/** Where the app's own address space ends: everything else is a client-side route, and a route may contain dots. */
const isAppRoute = (pathname: string) => pathname !== '/sw.js' && !FILE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/** `precached` is the list of paths the build stored in the shell cache. */
export function handlingOf(request: RequestFacts, precached: readonly string[], origin: string): Handling {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin || NEVER_KEPT_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return { kind: 'network' };
  if (precached.includes(url.pathname)) return { kind: 'precache', url: url.pathname };
  return request.mode === 'navigate' && isAppRoute(url.pathname) ? { kind: 'shell' } : { kind: 'network' };
}

/** The parts of a response that decide whether a copy may be stored (a `Response` has all three). */
export interface ResponseFacts {
  status: number;
  /** The answer came after a redirect. */
  redirected: boolean;
  cacheControl: string | null;
}

/**
 * Whether the worker may store a copy of a response while it fills the shell cache. Only a plain 200 qualifies: a redirect is not
 * the file asked for (a fetch of the shell with no session ends at the sign-in page), and an answer the server marked
 * `no-store` or `private` is one nobody may keep.
 */
export function isStorable({ status, redirected, cacheControl }: ResponseFacts): boolean {
  return status === 200 && !redirected && !/\b(no-store|private)\b/i.test(cacheControl ?? '');
}

const SHELL_CACHE_PREFIX = 'caduceus-shell-';

/** The cache of one build (`version` is `precache.ts`'s version of the build). A new build is a new cache, so an update is never half old and half new. */
export const shellCacheName = (version: string) => `${SHELL_CACHE_PREFIX}${version}`;

/** The shell caches of other builds, which an activated worker deletes. Caches the worker did not make (push, say) are not its to delete. */
export const obsoleteCaches = (names: readonly string[], current: string) => names.filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== current);
