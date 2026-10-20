import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { loadOnboarding, saveOnboarding, type Request } from '../../web/src/modules/onboarding/onboarding-progress.ts';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Onboarding progress (M5 #16) is a Caduceus preference of the owner's, kept in the Caduceus store: leaving the wizard on one device and opening
// it on another resumes at the same step. Through the Caduceus server's HTTP API, in front of the real Hermes.
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

const ROUTE = '/_caduceus/api/preferences/onboarding';

async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const call = async (cookie: string, method: string, body?: unknown) => {
    const res = await fetch(`${url}${ROUTE}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { url, call, cookie: await ownerCookie(url) };
}

describe('the onboarding progress preference', () => {
  test('a new owner has not started; the step one device reached is the step another device resumes at, and it outlasts a Caduceus restart', async () => {
    const laptop = await start();
    expect(await laptop.call(laptop.cookie, 'GET')).toEqual({ status: 200, body: { onboarding: { state: 'new', step: 'checks' } } });

    expect(await laptop.call(laptop.cookie, 'PUT', { onboarding: { state: 'in-progress', step: 'workspace' } })).toEqual({
      status: 200,
      body: { onboarding: { state: 'in-progress', step: 'workspace' } },
    });

    // The phone is another device (its own cookies) of the same owner.
    const phone = await ownerCookie(laptop.url);
    expect(phone).not.toBe(laptop.cookie);
    expect((await laptop.call(phone, 'GET')).body).toEqual({ onboarding: { state: 'in-progress', step: 'workspace' } });

    // Moving on from the phone is what the laptop sees next.
    await laptop.call(phone, 'PUT', { onboarding: { state: 'in-progress', step: 'notifications' } });
    expect((await laptop.call(laptop.cookie, 'GET')).body).toEqual({ onboarding: { state: 'in-progress', step: 'notifications' } });

    await server!.close();
    const again = await start();
    expect((await again.call(again.cookie, 'GET')).body).toEqual({ onboarding: { state: 'in-progress', step: 'notifications' } });
  });

  test('skipping keeps the step it was left at, and finishing is remembered for every device', async () => {
    const owner = await start();
    await owner.call(owner.cookie, 'PUT', { onboarding: { state: 'in-progress', step: 'provider' } });
    expect((await owner.call(owner.cookie, 'PUT', { onboarding: { state: 'skipped', step: 'provider' } })).body).toEqual({ onboarding: { state: 'skipped', step: 'provider' } });
    expect((await owner.call(await ownerCookie(owner.url), 'PUT', { onboarding: { state: 'finished', step: 'notifications' } })).status).toBe(200);
    expect((await owner.call(owner.cookie, 'GET')).body).toEqual({ onboarding: { state: 'finished', step: 'notifications' } });
  });

  test('a state or step that does not exist is refused and what was saved stays; only the signed-in owner can read or write it', async () => {
    const owner = await start();
    await owner.call(owner.cookie, 'PUT', { onboarding: { state: 'in-progress', step: 'provider' } });

    const bad = [
      { onboarding: { state: 'in-progress', step: 'bogus' } },
      { onboarding: { state: 'new', step: 'checks' } },
      { onboarding: { state: 'done', step: 'checks' } },
      { onboarding: { state: 'in-progress' } },
      { onboarding: { step: 'checks' } },
      { state: 'in-progress', step: 'checks' },
      { onboarding: null },
      'onboarding',
    ];
    for (const body of bad) expect(await owner.call(owner.cookie, 'PUT', body), JSON.stringify(body)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect((await owner.call(owner.cookie, 'GET')).body).toEqual({ onboarding: { state: 'in-progress', step: 'provider' } });

    expect((await fetch(`${owner.url}${ROUTE}`, { headers: { origin: owner.url } })).status).toBe(401);
    expect((await fetch(`${owner.url}${ROUTE}`, { method: 'PUT', headers: { origin: owner.url, 'content-type': 'application/json' }, body: JSON.stringify({ onboarding: { state: 'skipped', step: 'checks' } }) })).status).toBe(401);
  });
});

describe('the page copy of the onboarding progress', () => {
  const requestTo = (url: string, cookie: string): Request => (method, route, body) =>
    fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });

  test('reads a new owner as not started, saves each move for the next load on any device, and says so when the server refuses it', async () => {
    const owner = await start();
    const laptop = requestTo(owner.url, owner.cookie);
    expect(await loadOnboarding(laptop)).toEqual({ state: 'new', step: 'checks' });

    await saveOnboarding({ state: 'in-progress', step: 'provider' }, laptop);
    expect(await loadOnboarding(laptop)).toEqual({ state: 'in-progress', step: 'provider' });
    // A phone that opens the wizard later reads what the laptop saved.
    expect(await loadOnboarding(requestTo(owner.url, await ownerCookie(owner.url)), true)).toEqual({ state: 'in-progress', step: 'provider' });

    await expect(saveOnboarding({ state: 'in-progress', step: 'bogus' } as never, laptop)).rejects.toThrow(/did not save/i);
    expect(await loadOnboarding(laptop, true)).toEqual({ state: 'in-progress', step: 'provider' });
  });
});
