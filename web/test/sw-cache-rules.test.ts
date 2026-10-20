import { describe, expect, test } from 'vitest';
import { handlingOf, isStorable, obsoleteCaches, shellCacheName } from '../src/sw/cache-rules.ts';

// What the service worker does with each request (M0 #12): serve the app's own files from its cache, fall back to the cached
// shell when a page cannot be fetched, and leave everything else to the network, untouched and unkept.
const ORIGIN = 'https://mac.tail1234.ts.net:9443';
const request = (method: string, path: string, mode = 'cors') => ({ method, mode, url: `${ORIGIN}${path}` });
/** What a build precaches: the shell page, its hashed files, the manifest and the icons. */
const PRECACHED = ['/index.html', '/assets/index-3f9a1c.js', '/assets/index-8b2d44.css', '/manifest.webmanifest', '/icons/icon-192.png'];

describe('what is never kept', () => {
  test('sign-in, session, passkey, step-up and secret-reveal requests, and every Hermes request, go to the network', () => {
    const never: [string, string, string?][] = [
      ['GET', '/_caduceus/api/auth/session'],
      ['POST', '/_caduceus/api/auth/sign-in'],
      ['POST', '/_caduceus/api/auth/setup'],
      ['POST', '/_caduceus/api/auth/passkey-sign-in/options'],
      ['POST', '/_caduceus/api/auth/passkey-sign-in'],
      ['POST', '/_caduceus/api/auth/step-up/options'],
      ['POST', '/_caduceus/api/auth/step-up'],
      ['GET', '/_caduceus/api/auth/sessions'],
      ['POST', '/api/env/reveal'],
      ['GET', '/api/env'],
      ['GET', '/api/messaging/platforms'],
      ['PUT', '/api/messaging/platforms/telegram'],
      // The answer that creates a webhook subscription carries its secret, once; the list and the pairing requests are about the moment.
      ['POST', '/api/webhooks'],
      ['GET', '/api/webhooks'],
      ['GET', '/api/webhooks', 'navigate'],
      ['GET', '/api/pairing'],
      ['POST', '/api/pairing/approve'],
      ['GET', '/api/status'],
      ['GET', '/_caduceus/api/health'],
      // The live tail of a log is a stream, and truncating a file is a change.
      ['GET', '/_caduceus/api/logs/stream?file=agent'],
      ['POST', '/_caduceus/api/logs/truncate'],
      ['GET', '/api/logs?file=agent'],
      // Opening one in the address bar is no reason to show the app in its place, or to remember the answer.
      ['GET', '/_caduceus/api/auth/session', 'navigate'],
      ['GET', '/api/env', 'navigate'],
    ];

    for (const [method, path, mode] of never) {
      expect(handlingOf(request(method, path, mode), PRECACHED, ORIGIN), `${method} ${path} ${mode ?? ''}`).toEqual({ kind: 'network' });
    }
  });
});

describe('what is kept', () => {
  test('the app’s own precached files come from the cache, and every app page is the cached shell when it cannot be fetched', () => {
    const handle = (method: string, path: string, mode?: string) => handlingOf(request(method, path, mode), PRECACHED, ORIGIN);

    for (const path of ['/assets/index-3f9a1c.js', '/assets/index-8b2d44.css', '/icons/icon-192.png', '/manifest.webmanifest']) {
      expect(handle('GET', path), path).toEqual({ kind: 'precache', url: path });
    }
    // Client-side routes all render the shell (their address is the app's, dots and queries included).
    for (const path of ['/', '/home', '/home?profile=coder', '/observe/health', '/sign-in?next=%2Fhome', '/workspace/files/src/main.ts']) {
      expect(handle('GET', path, 'navigate'), path).toEqual({ kind: 'shell' });
    }
  });

  test('leaves alone whatever is not the app’s own: other files, other methods, other origins, and the worker itself', () => {
    const handle = (method: string, path: string, mode?: string) => handlingOf(request(method, path, mode), PRECACHED, ORIGIN);

    // A build that is gone: the answer is the server's 404, not the shell, and not a stale copy.
    expect(handle('GET', '/assets/index-0ld5ha.js')).toEqual({ kind: 'network' });
    expect(handle('GET', '/assets/index-0ld5ha.js', 'navigate')).toEqual({ kind: 'network' });
    expect(handle('GET', '/sw.js')).toEqual({ kind: 'network' });
    expect(handle('GET', '/sw.js', 'navigate')).toEqual({ kind: 'network' });
    // The shell stands in for a page load only: a script asking for an app address (a `fetch`) gets that address's own answer.
    expect(handle('GET', '/home')).toEqual({ kind: 'network' });
    expect(handle('POST', '/assets/index-3f9a1c.js')).toEqual({ kind: 'network' });
    expect(handle('POST', '/home', 'navigate')).toEqual({ kind: 'network' });
    expect(handlingOf({ method: 'GET', mode: 'cors', url: 'https://elsewhere.example/assets/index-3f9a1c.js' }, PRECACHED, ORIGIN)).toEqual({ kind: 'network' });
    expect(handlingOf({ method: 'GET', mode: 'navigate', url: 'https://elsewhere.example/home' }, PRECACHED, ORIGIN)).toEqual({ kind: 'network' });
  });

  test('a precache list that names a secret’s path still never serves it', () => {
    const mistaken = [...PRECACHED, '/api/env/reveal', '/_caduceus/api/auth/session'];

    expect(handlingOf(request('GET', '/api/env/reveal'), mistaken, ORIGIN)).toEqual({ kind: 'network' });
    expect(handlingOf(request('GET', '/_caduceus/api/auth/session'), mistaken, ORIGIN)).toEqual({ kind: 'network' });
  });
});

describe('what a stored copy may be made of', () => {
  test('a plain successful answer is kept; a refusal, a redirect (to the sign-in page, say) and anything marked no-store or private is not', () => {
    const answer = (status: number, cacheControl: string | null, redirected = false) => ({ status, redirected, cacheControl });

    expect(isStorable(answer(200, null))).toBe(true);
    expect(isStorable(answer(200, 'no-cache'))).toBe(true);
    expect(isStorable(answer(200, 'public, max-age=31536000, immutable'))).toBe(true);
    expect(isStorable(answer(404, null))).toBe(false);
    expect(isStorable(answer(401, null))).toBe(false);
    expect(isStorable(answer(304, null))).toBe(false);
    // A fetch of the shell with no session ends at the sign-in page: its bytes would stand in for the shell, and the app would never start.
    expect(isStorable(answer(200, null, true))).toBe(false);
    expect(isStorable(answer(200, 'no-store'))).toBe(false);
    expect(isStorable(answer(200, 'private, max-age=60'))).toBe(false);
    expect(isStorable(answer(200, 'No-Store'))).toBe(false);
  });

  test('every build has its own cache, and only the worker’s own caches of other builds are cleared away', () => {
    expect(shellCacheName('3f9a1c')).toBe('caduceus-shell-3f9a1c');
    const names = ['caduceus-shell-0ld5ha', 'caduceus-shell-3f9a1c', 'caduceus-shell-b4d1e0', 'notifications-v1', 'workbox-precache'];

    expect(obsoleteCaches(names, shellCacheName('3f9a1c'))).toEqual(['caduceus-shell-0ld5ha', 'caduceus-shell-b4d1e0']);
  });
});
