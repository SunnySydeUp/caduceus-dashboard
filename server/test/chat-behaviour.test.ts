import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadChatBehaviour, saveChatBehaviour, type Request } from '../../web/src/modules/chat/chat-behaviour.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// How the chat behaves (M1 #20) is a Caduceus preference: some settings are a device's, some the owner's, and Hermes's own config is never written for them.
// Through the Caduceus server's HTTP API, in front of the real Hermes.
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
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

const ROUTE = '/_caduceus/api/preferences/chat-behaviour';

async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  /** A browser of the owner's: its own device cookie, which the server hands out the first time it is asked. */
  const browser = () => {
    let device = '';
    return async (method: string, body?: unknown) => {
      const res = await fetch(`${url}${ROUTE}`, { method, headers: { origin: url, cookie: [cookie, device].filter(Boolean).join('; '), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      device = res.headers.get('set-cookie')?.split(';')[0] ?? device;
      return { status: res.status, body: await res.json() };
    };
  };
  return { phone: browser(), laptop: browser() };
}

const DEFAULTS = {
  device: { sendKey: 'auto', completionSound: false, timestamps: false, transcriptDensity: 'comfortable', autoFollow: true },
  account: { pinLimit: 10, activityMode: 'worklog' },
};

describe('the chat behaviour preferences', () => {
  test('start as the defaults; a device setting is that device\'s, an account setting is every device\'s, and Hermes\'s config is not written', async () => {
    const configFile = path.join(hermes.home, 'config.yaml');
    const configBefore = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : undefined;
    const { phone, laptop } = await start();
    expect(await phone('GET')).toEqual({ status: 200, body: DEFAULTS });

    expect((await phone('PUT', { device: { sendKey: 'enter', timestamps: true }, account: { pinLimit: 3 } })).status).toBe(200);

    expect((await phone('GET')).body).toEqual({ device: { ...DEFAULTS.device, sendKey: 'enter', timestamps: true }, account: { ...DEFAULTS.account, pinLimit: 3 } });
    expect((await laptop('GET')).body).toEqual({ device: DEFAULTS.device, account: { ...DEFAULTS.account, pinLimit: 3 } });
    expect(fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : undefined).toBe(configBefore);
  });

  test('refuses a setting it does not know or a value out of range, and keeps what it had', async () => {
    const { phone } = await start();
    await phone('PUT', { account: { pinLimit: 4 } });

    for (const bad of [{ device: { sendKey: 'tab' } }, { device: { nonsense: true } }, { account: { pinLimit: 0 } }, { account: { pinLimit: 2.5 } }, { account: { activityMode: 'loud' } }, { device: 'enter' }]) {
      expect((await phone('PUT', bad)).status).toBe(400);
    }

    expect((await phone('GET')).body).toEqual({ device: DEFAULTS.device, account: { ...DEFAULTS.account, pinLimit: 4 } });
  });

  test('null resets a scope to its defaults, and only that scope', async () => {
    const { phone } = await start();
    await phone('PUT', { device: { completionSound: true }, account: { activityMode: 'final' } });

    expect((await phone('PUT', { device: null })).body).toEqual({ device: DEFAULTS.device, account: { ...DEFAULTS.account, activityMode: 'final' } });
    expect((await phone('PUT', { account: null })).body).toEqual(DEFAULTS);
  });
});

describe('the page\'s copy of the chat behaviour', () => {
  test('shows a change at once and keeps what the server kept; a change the server refuses is put back', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    const { url } = server;
    const cookie = await ownerCookie(url);
    // The browser keeps the device cookie the server hands out.
    let device = '';
    const request: Request = async (method, route, body) => {
      const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie: [cookie, device].filter(Boolean).join('; '), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      device = res.headers.get('set-cookie')?.split(';')[0] ?? device;
      return res;
    };

    expect((await loadChatBehaviour(request, true)).device.sendKey).toBe('auto');
    expect(await saveChatBehaviour({ device: { sendKey: 'enter' }, account: { pinLimit: 2 } }, request)).toBe(true);
    expect((await loadChatBehaviour(request, true)).device.sendKey).toBe('enter');
    expect((await loadChatBehaviour(request, true)).account.pinLimit).toBe(2);

    // A value the server refuses (the page never sends one; this proves it would not stick).
    expect(await saveChatBehaviour({ account: { pinLimit: 0 } }, request)).toBe(false);
    expect((await loadChatBehaviour(request, true)).account.pinLimit).toBe(2);
    expect(await saveChatBehaviour({ device: null, account: null }, request)).toBe(true);
    expect((await loadChatBehaviour(request, true)).device.sendKey).toBe('auto');
  });
});
