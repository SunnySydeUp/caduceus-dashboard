import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadChipPreference, saveChipPreference, type Request } from '../../web/src/modules/chat/chip-preference.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// The composer's chip order and visibility (M1 #08) is a Caduceus preference of the owner's, kept in the Caduceus store: every device
// the owner signs in on shows the same chips. Through the Caduceus server's HTTP API, in front of the real Hermes.
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

const ROUTE = '/_caduceus/api/preferences/chat-chips';

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

const CHIPS = { order: ['model', 'workspace', 'reasoning', 'toolsets', 'profile'], hidden: ['toolsets'] };

describe('the composer chips preference', () => {
  test('there is none until the owner saves one; a saved one is shown to every device and outlasts a Caduceus restart', async () => {
    const owner = await start();
    expect(await owner.call(owner.cookie, 'GET')).toEqual({ status: 200, body: { chips: null } });
    expect(await owner.call(owner.cookie, 'PUT', { chips: CHIPS })).toEqual({ status: 200, body: { chips: CHIPS } });

    // Another device is another sign-in of the same owner.
    const phone = await ownerCookie(owner.url);
    expect(phone).not.toBe(owner.cookie);
    expect((await owner.call(phone, 'GET')).body).toEqual({ chips: CHIPS });

    await server!.close();
    const again = await start();
    expect((await again.call(again.cookie, 'GET')).body).toEqual({ chips: CHIPS });
  });

  test('a list that is not every chip once, or names a chip that does not exist, is refused and the saved one stays', async () => {
    const owner = await start();
    await owner.call(owner.cookie, 'PUT', { chips: CHIPS });

    const bad = [
      { chips: { order: ['model'], hidden: [] } },
      { chips: { order: [...CHIPS.order, 'model'], hidden: [] } },
      { chips: { order: ['model', 'workspace', 'reasoning', 'toolsets', 'bogus'], hidden: [] } },
      { chips: { order: CHIPS.order, hidden: ['bogus'] } },
      { chips: { order: CHIPS.order, hidden: ['toolsets', 'toolsets'] } },
      { chips: { order: CHIPS.order } },
      { order: CHIPS.order, hidden: [] },
      'chips',
      null,
    ];
    for (const body of bad) expect(await owner.call(owner.cookie, 'PUT', body), JSON.stringify(body)).toEqual({ status: 400, body: { error: 'bad-request' } });
    expect((await owner.call(owner.cookie, 'GET')).body).toEqual({ chips: CHIPS });
  });

  test('saving null puts the chips back to Caduceus\'s own order, and only the signed-in owner can read or write it', async () => {
    const owner = await start();
    await owner.call(owner.cookie, 'PUT', { chips: CHIPS });
    expect(await owner.call(owner.cookie, 'PUT', { chips: null })).toEqual({ status: 200, body: { chips: null } });
    expect((await owner.call(owner.cookie, 'GET')).body).toEqual({ chips: null });

    expect((await fetch(`${owner.url}${ROUTE}`, { headers: { origin: owner.url } })).status).toBe(401);
  });
});

describe('the page copy of the chips preference', () => {
  const requestTo = (url: string, cookie: string): Request => (method, route, body) =>
    fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });

  test('loads the default order when none is saved, saves a change for the next load, and says so when the server refuses it', async () => {
    const owner = await start();
    const request = requestTo(owner.url, owner.cookie);
    expect(await loadChipPreference(request)).toEqual({ order: ['profile', 'model', 'reasoning', 'workspace', 'toolsets'], hidden: [] });

    await saveChipPreference({ order: ['model', 'workspace', 'reasoning', 'toolsets', 'profile'], hidden: ['toolsets'] }, request);
    expect(await loadChipPreference(request)).toEqual({ order: ['model', 'workspace', 'reasoning', 'toolsets', 'profile'], hidden: ['toolsets'] });
    // A phone that signs in later reads what the laptop saved.
    expect(await loadChipPreference(requestTo(owner.url, await ownerCookie(owner.url)))).toMatchObject({ hidden: ['toolsets'] });

    await expect(saveChipPreference({ order: ['model'], hidden: [] } as never, request)).rejects.toThrow(/did not save/i);
  });
});
