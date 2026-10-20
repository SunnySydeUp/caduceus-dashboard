import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { TEST_OWNER_PASSWORD } from './fixtures/owner.ts';

// Per-device appearance (theme, skin, density, text size) through the Caduceus server's HTTP API, in front of the real
// Hermes (in a throwaway HERMES_HOME, which is also the Hermes root home the Caduceus store lives in).
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  // Every test starts before the owner exists.
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

const APPEARANCE = '/_caduceus/api/preferences/appearance';
const DARK_GOLD = { theme: 'dark', skin: 'gold', density: 'compact', textSize: 'lg' } as const;
const LIGHT_MONO = { theme: 'light', skin: 'mono', density: 'comfortable', textSize: 'sm' } as const;

async function start(): Promise<string> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  return server.url;
}

/**
 * One browser: it keeps the cookies the server sets and sends them back, as a browser profile does. Two `Browser`s are
 * two devices; both sign in as the same owner.
 */
class Browser {
  constructor(
    readonly url: string,
    /** The browser's cookie jar; a browser that outlives a server restart reuses it with the new address. */
    readonly cookies = new Map<string, string>(),
  ) {}

  async request(route: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    const res = await fetch(`${this.url}${route}`, {
      method: init.method ?? 'GET',
      headers: {
        origin: this.url,
        'content-type': 'application/json',
        cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual',
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';').map((part) => part.trim());
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      if (value === '' || attributes.includes('Max-Age=0')) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  /** Signs in, setting the owner up first if there is none. */
  async signIn(): Promise<void> {
    const { ownerExists } = await (await this.request('/_caduceus/api/auth/session')).json();
    const res = await this.request(`/_caduceus/api/auth/${ownerExists ? 'sign-in' : 'setup'}`, { method: 'POST', body: { password: TEST_OWNER_PASSWORD } });
    expect(res.ok).toBe(true);
  }

  async signOut(): Promise<void> {
    expect((await this.request('/_caduceus/api/auth/sign-out', { method: 'POST' })).status).toBe(204);
  }

  async appearance(): Promise<unknown> {
    const res = await this.request(APPEARANCE);
    expect(res.status).toBe(200);
    return (await res.json()).appearance;
  }

  async saveAppearance(appearance: unknown): Promise<Response> {
    return this.request(APPEARANCE, { method: 'PUT', body: { appearance } });
  }
}

describe('appearance per device', () => {
  test('a new device has nothing stored; what it saves survives a reload and signing out and in again', async () => {
    const phone = new Browser(await start());
    await phone.signIn();

    expect(await phone.appearance()).toBeNull();
    const saved = await phone.saveAppearance(DARK_GOLD);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ appearance: DARK_GOLD });

    // A reload is another request from the same browser.
    expect(await phone.appearance()).toEqual(DARK_GOLD);
    // Signing out ends the session; signing in opens a new one on the same device.
    await phone.signOut();
    await phone.signIn();
    expect(await phone.appearance()).toEqual(DARK_GOLD);
  });

  test('two devices signed in as the owner keep independent choices, which outlast a Caduceus restart', async () => {
    const phone = new Browser(await start());
    const laptop = new Browser(server!.url);
    await phone.signIn();
    await laptop.signIn();

    expect(await phone.saveAppearance(DARK_GOLD)).toHaveProperty('status', 200);
    // The laptop has saved nothing: the phone's choice is not its own.
    expect(await laptop.appearance()).toBeNull();
    expect(await laptop.saveAppearance(LIGHT_MONO)).toHaveProperty('status', 200);

    expect(await phone.appearance()).toEqual(DARK_GOLD);
    expect(await laptop.appearance()).toEqual(LIGHT_MONO);

    // The choices are in the Caduceus store, not in memory.
    await server!.close();
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    const phoneAgain = new Browser(server.url, phone.cookies);
    const laptopAgain = new Browser(server.url, laptop.cookies);
    expect(await phoneAgain.appearance()).toEqual(DARK_GOLD);
    expect(await laptopAgain.appearance()).toEqual(LIGHT_MONO);
  });

  test('a choice the app does not offer is refused and leaves the stored one alone', async () => {
    const phone = new Browser(await start());
    await phone.signIn();
    await phone.saveAppearance(DARK_GOLD);

    for (const bad of [{ ...DARK_GOLD, skin: 'neon' }, { ...DARK_GOLD, theme: 'sepia' }, { theme: 'dark', skin: 'gold', density: 'compact' }, 'dark', null, undefined]) {
      const res = await phone.saveAppearance(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad-request' });
    }
    expect(await phone.appearance()).toEqual(DARK_GOLD);
  });

  test('the device cookie is a long-lived HttpOnly id, Secure through Tailscale Serve, and only an id the server made is trusted', async () => {
    const phone = new Browser(await start());
    await phone.signIn();

    const first = await phone.request(APPEARANCE);
    const [pair, ...attributes] = first.headers.getSetCookie().find((header) => header.startsWith('caduceus_device='))!.split('; ');
    expect(pair).toMatch(/^caduceus_device=[0-9a-f]{32}$/);
    expect(attributes).toEqual(expect.arrayContaining(['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=34560000']));
    // From this Mac over plain http it is not Secure (a browser would refuse to store a Secure cookie there).
    expect(attributes).not.toContain('Secure');

    // Through Tailscale Serve the browser is on https, so the cookie is Secure.
    const served = await fetch(`${phone.url}${APPEARANCE}`, {
      headers: { cookie: `caduceus_session=${phone.cookies.get('caduceus_session')}`, 'x-forwarded-for': '100.101.102.103', 'x-forwarded-proto': 'https' },
    });
    expect(served.headers.getSetCookie().find((header) => header.startsWith('caduceus_device='))).toContain('Secure');

    // Whatever else is in the cookie is not an id: the device gets a fresh one, and nothing is stored under the junk.
    phone.cookies.set('caduceus_device', '../../etc/passwd');
    expect(await phone.appearance()).toBeNull();
    expect(phone.cookies.get('caduceus_device')).toMatch(/^[0-9a-f]{32}$/);
  });

  test('signed out, nothing is served or stored and no device is issued', async () => {
    const stranger = new Browser(await start());

    const read = await stranger.request(APPEARANCE);
    const write = await stranger.saveAppearance(DARK_GOLD);

    expect([read.status, write.status]).toEqual([401, 401]);
    expect(stranger.cookies.has('caduceus_device')).toBe(false);
  });
});
