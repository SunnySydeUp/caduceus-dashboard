import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { ownerCookie, TEST_OWNER_PASSWORD } from './fixtures/owner.ts';

// How the Caduceus server serves the installable web app (M0 #12): the manifest, the service worker, the shell and its assets,
// and the headers that keep sign-in and secret responses out of every cache. A browser's view, over HTTP, in front of the real
// Hermes (in a throwaway HERMES_HOME, which is also the Hermes root home the Caduceus store lives in).
let hermes: TestHermes;
let webRoot: string;
let server: CaduceusServer | undefined;

const INLINE_SCRIPT = 'document.documentElement.dataset.ready = "1";';
const INDEX_HTML = `<!doctype html><title>Caduceus</title><script>${INLINE_SCRIPT}</script><script type="module" src="/assets/app-3f9a1c.js"></script>`;
const MANIFEST = JSON.stringify({ id: '/', name: 'Caduceus' });
const SERVICE_WORKER = "self.addEventListener('fetch', () => {});";
const ASSET_JS = 'export const shell = true;';
const ICON_PNG = Buffer.from('89504e470d0a1a0a', 'hex');

beforeAll(async () => {
  hermes = await launchTestHermes();
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-web-'));
  fs.writeFileSync(path.join(webRoot, 'index.html'), INDEX_HTML);
  fs.writeFileSync(path.join(webRoot, 'manifest.webmanifest'), MANIFEST);
  fs.writeFileSync(path.join(webRoot, 'sw.js'), SERVICE_WORKER);
  fs.mkdirSync(path.join(webRoot, 'assets'));
  fs.writeFileSync(path.join(webRoot, 'assets', 'app-3f9a1c.js'), ASSET_JS);
  // What the build leaves beside a compressible file.
  fs.writeFileSync(path.join(webRoot, 'assets', 'app-3f9a1c.js.gz'), zlib.gzipSync(ASSET_JS));
  fs.mkdirSync(path.join(webRoot, 'icons'));
  fs.writeFileSync(path.join(webRoot, 'icons', 'icon-192.png'), ICON_PNG);
  await hermes.backend.ready();
}, 60_000);
afterAll(async () => {
  try {
    await hermes.stop();
  } finally {
    fs.rmSync(webRoot, { recursive: true, force: true });
  }
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  // Every test starts before the owner exists.
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start(): Promise<string> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, webRoot });
  return server.url;
}

describe('the security headers', () => {
  test('every answer, the app, the API, a refusal and a missing file, says that it must not be framed by another site, sniffed or sent as a referrer', async () => {
    const url = await start();
    const cookie = await ownerCookie(url);

    const answers = await Promise.all([
      fetch(`${url}/`),
      fetch(`${url}/_caduceus/api/auth/session`),
      fetch(`${url}/_caduceus/api/preferences/appearance`),
      fetch(`${url}/api/status`, { headers: { cookie } }),
      fetch(`${url}/assets/missing.js`),
    ]);

    for (const res of answers) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    }
    // The page's one inline script runs by its hash and nothing else inline does; everything else is the app's own address.
    const policy = answers[0].headers.get('content-security-policy')!;
    const hash = crypto.createHash('sha256').update(INLINE_SCRIPT).digest('base64');
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain(`script-src 'self' 'sha256-${hash}'`);
    expect(policy).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(policy).toContain("object-src 'self'");
  });

  test('a script of the app is never sniffed into another type, and carries no more: a browser loads it as part of a page, and each header is bytes on every request of a first load', async () => {
    const url = await start();

    const script = await fetch(`${url}/assets/app-3f9a1c.js`);

    expect(script.status).toBe(200);
    expect(script.headers.get('x-content-type-options')).toBe('nosniff');
    // A policy, a framing rule and a referrer policy are about a page; this file is never one.
    expect(script.headers.get('content-security-policy')).toBeNull();
    expect(script.headers.get('x-frame-options')).toBeNull();
    expect(script.headers.get('referrer-policy')).toBeNull();
  });
});

describe('the manifest', () => {
  test('is served to a browser that is not signed in, as a manifest, and revalidated every time', async () => {
    const url = await start();

    // A browser fetches the manifest of a page without its cookies unless told otherwise, and installs before it signs in.
    const res = await fetch(`${url}/manifest.webmanifest`, { redirect: 'manual' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/manifest\+json/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(MANIFEST);
  });
});

describe('the service worker script', () => {
  test('is served to a browser that is not signed in, as JavaScript, for the whole origin, and checked for a new version on every use', async () => {
    const url = await start();

    // Its update check follows no redirect: a sign-in redirect would fail it, and the app would never learn of a new build.
    const res = await fetch(`${url}/sw.js`, { redirect: 'manual' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('service-worker-allowed')).toBe('/');
    expect(await res.text()).toBe(SERVICE_WORKER);
  });
});

describe('the shell and its files', () => {
  test('hashed assets are kept for good and everything the browser must revalidate is never kept', async () => {
    const url = await start();
    const cookie = await ownerCookie(url);

    const asset = await fetch(`${url}/assets/app-3f9a1c.js`);
    const signIn = await fetch(`${url}/sign-in`);
    const icon = await fetch(`${url}/icons/icon-192.png`, { redirect: 'manual' });
    const appPage = await fetch(`${url}/home`, { headers: { cookie } });
    const rootPage = await fetch(`${url}/`, { headers: { cookie } });
    const shell = await fetch(`${url}/index.html`, { redirect: 'manual' });

    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    // The service worker precaches the shell by its own address, which a browser may fetch with no session.
    expect(shell.status).toBe(200);
    for (const res of [signIn, icon, appPage, rootPage, shell]) {
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
    expect(icon.headers.get('content-type')).toBe('image/png');
    expect(await appPage.text()).toBe(INDEX_HTML);
  });

  test('a hashed asset that is gone is a 404, not the app shell a browser would try to run as a script', async () => {
    const url = await start();
    const cookie = await ownerCookie(url);

    const gone = await fetch(`${url}/assets/app-0ld5ha.js`, { headers: { cookie } });
    const route = await fetch(`${url}/workspace/files/src/main.ts`, { headers: { cookie } });

    expect(gone.status).toBe(404);
    // An address that is not an asset is a client-side route, dots and all.
    expect(route.status).toBe(200);
    expect(await route.text()).toBe(INDEX_HTML);
  });

  test('the screen the app opens on has its first read preloaded: the page that lands there starts it with the document, before any script has run, and no other page does', async () => {
    const url = await start();
    const cookie = await ownerCookie(url);

    const today = await fetch(`${url}/today`, { headers: { cookie } });
    const root = await fetch(`${url}/`, { headers: { cookie } });
    const talk = await fetch(`${url}/chat`, { headers: { cookie } });
    const shell = await fetch(`${url}/index.html`, { redirect: 'manual' });
    const asset = await fetch(`${url}/assets/app-3f9a1c.js`);

    // Same-origin, with the page's cookie (`crossorigin` is the browser's anonymous mode, which still sends it to its own origin): what `fetch()` in the page asks for, so the page's read finds it.
    const preload = '</_caduceus/api/today/ready>; rel=preload; as=fetch; crossorigin';
    expect(today.headers.get('link')).toBe(preload);
    expect(root.headers.get('link')).toBe(preload);
    for (const res of [talk, shell, asset]) expect(res.headers.get('link')).toBeNull();
  });

  test('serves the compressed copy a build left beside a file to a browser that takes it, and says the answer varies', async () => {
    const url = await start();

    // Fetch decodes the body it is sent, so the text is compared after decoding; the header says which copy was sent.
    const res = await fetch(`${url}/assets/app-3f9a1c.js`, { headers: { 'accept-encoding': 'gzip' } });
    const plain = await fetch(`${url}/assets/app-3f9a1c.js`, { headers: { 'accept-encoding': 'identity' } });

    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('vary')).toMatch(/Accept-Encoding/i);
    expect(await res.text()).toBe(ASSET_JS);
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(await plain.text()).toBe(ASSET_JS);
  });
});

describe('what no cache may keep', () => {
  const SECRET = 'sk-test-0123456789-not-a-real-key';

  test('sign-in, session, step-up and secret responses, and every answer from Hermes, carry no-store', async () => {
    const url = await start();
    const seen: { what: string; res: Response }[] = [];
    const send = async (what: string, method: string, route: string, init: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) => {
      const res = await fetch(`${url}${route}`, {
        method,
        headers: { origin: url, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      seen.push({ what, res });
      return res;
    };

    // Signed out: the state of sign-in, a refused request to the API and to Hermes.
    await send('auth state', 'GET', '/_caduceus/api/auth/session');
    await send('signed-out API', 'GET', '/_caduceus/api/health');
    await send('signed-out Hermes', 'GET', '/api/status');
    // Setting up and signing in: the response that hands the browser its session cookie, and one that refuses it.
    const setup = await send('set up', 'POST', '/_caduceus/api/auth/setup', { body: { password: TEST_OWNER_PASSWORD } });
    const cookie = setup.headers.get('set-cookie')!.split(';')[0];
    await send('wrong password', 'POST', '/_caduceus/api/auth/sign-in', { body: { password: 'not the password' } });
    await send('sign-in', 'POST', '/_caduceus/api/auth/sign-in', { body: { password: TEST_OWNER_PASSWORD } });
    // Signed in, with a step-up: the owner's devices, the passkey ceremonies, preferences and the Caduceus API.
    const authenticator = await addPasskey(url, cookie);
    await stepUp(url, cookie, authenticator);
    await send('signed-in state', 'GET', '/_caduceus/api/auth/session', { cookie });
    await send('devices', 'GET', '/_caduceus/api/auth/sessions', { cookie });
    await send('step-up options', 'POST', '/_caduceus/api/auth/step-up/options', { cookie });
    await send('preferences', 'GET', '/_caduceus/api/preferences/appearance', { cookie });
    await send('health', 'GET', '/_caduceus/api/health', { cookie });
    // Hermes through the proxy: a read, a refusal by the policy, and a secret written and then revealed (T3: typed confirmation).
    await send('Hermes read', 'GET', '/api/status', { cookie });
    await send('Hermes env list', 'GET', '/api/env', { cookie });
    await send('policy refusal', 'GET', '/api/not-a-pinned-route', { cookie });
    const write = await send('Hermes env write', 'PUT', '/api/env', { cookie, body: { key: 'OPENROUTER_API_KEY', value: SECRET } });
    const reveal = { key: 'OPENROUTER_API_KEY' };
    const confirmation = await send('confirmation', 'POST', '/_caduceus/api/policy/confirmations', {
      cookie,
      body: { operation: 'POST /api/env/reveal', target: reveal.key, typed: reveal.key },
    });
    const revealed = await send('reveal', 'POST', '/api/env/reveal', { cookie, body: reveal, headers: { 'x-caduceus-confirmation': (await confirmation.clone().json()).token } });

    // The reveal really happened: the answer is the secret, so this is the response no cache may keep.
    expect(write.status).toBe(200);
    expect(await revealed.clone().json()).toMatchObject({ value: SECRET });
    expect(seen.filter(({ res }) => res.headers.get('cache-control') !== 'no-store').map(({ what }) => what)).toEqual([]);
  });
});
