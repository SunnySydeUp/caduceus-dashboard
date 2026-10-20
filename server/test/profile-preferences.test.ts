import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { forgetProfilePreferences, loadAssistantName, moveProfilePreferences, saveAssistantName, type Request } from '../../web/src/profile-preferences.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// The assistant display name (M4 #01): a Caduceus-owned, per-profile preference, kept in the Caduceus store and never
// written to Hermes. Through the Caduceus server's HTTP API, in front of the real Hermes in a throwaway HERMES_HOME.
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

interface Owner {
  url: string;
  /** The page's own client, pointed at this server. */
  request: Request;
  call(method: string, route: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

async function start(): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const call: Owner['call'] = async (method, route, body) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  const request: Request = (method, route, body) =>
    fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { url, call, request };
}

const route = (profile: string) => `/_caduceus/api/preferences/profiles/${profile}`;

describe('the assistant display name, per profile', () => {
  test('a profile has no name until one is saved; each profile keeps its own, which outlasts a Caduceus restart', async () => {
    const owner = await start();

    expect(await owner.call('GET', route('coder'))).toEqual({ status: 200, body: { assistantName: null } });
    expect(await owner.call('PUT', route('coder'), { assistantName: 'Cody' })).toEqual({ status: 200, body: { assistantName: 'Cody' } });
    expect((await owner.call('PUT', route('writer'), { assistantName: '  Wren  ' })).body).toEqual({ assistantName: 'Wren' });

    expect((await owner.call('GET', route('coder'))).body).toEqual({ assistantName: 'Cody' });
    expect((await owner.call('GET', route('writer'))).body).toEqual({ assistantName: 'Wren' });
    expect((await owner.call('GET', route('default'))).body).toEqual({ assistantName: null });

    await server!.close();
    const again = await start();
    expect((await again.call('GET', route('coder'))).body).toEqual({ assistantName: 'Cody' });
  });

  test('saving nothing (null or blank) clears it, and DELETE removes the profile\'s preferences', async () => {
    const owner = await start();
    await owner.call('PUT', route('coder'), { assistantName: 'Cody' });
    expect((await owner.call('PUT', route('coder'), { assistantName: '   ' })).body).toEqual({ assistantName: null });
    expect((await owner.call('GET', route('coder'))).body).toEqual({ assistantName: null });

    await owner.call('PUT', route('coder'), { assistantName: 'Cody' });
    expect((await owner.call('DELETE', route('coder'))).status).toBe(204);
    expect((await owner.call('GET', route('coder'))).body).toEqual({ assistantName: null });
  });

  test('a name that is not text, or is longer than 60 characters, is refused and the stored one stays', async () => {
    const owner = await start();
    await owner.call('PUT', route('coder'), { assistantName: 'Cody' });

    for (const bad of [{ assistantName: 7 }, { assistantName: 'x'.repeat(61) }, { name: 'Cody' }, 'Cody', null]) {
      const res = await owner.call('PUT', route('coder'), bad);
      expect(res, JSON.stringify(bad)).toEqual({ status: 400, body: { error: 'bad-request' } });
    }
    expect((await owner.call('GET', route('coder'))).body).toEqual({ assistantName: 'Cody' });
  });

  test('only the signed-in owner can read or write it', async () => {
    const owner = await start();
    const res = await fetch(`${owner.url}${route('coder')}`, { headers: { origin: owner.url } });
    expect(res.status).toBe(401);
  });

  test('it never writes Hermes: the profile list and every file of a profile are as they were', async () => {
    const owner = await start();
    await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'coder' }) });
    const snapshot = async () => {
      const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [`${path.join(dir, e.name)}:${fs.readFileSync(path.join(dir, e.name), 'utf8')}`]));
      const profiles = await (await hermes.backend.fetch('/api/profiles')).text();
      return { profiles, files: files(path.join(hermes.home, 'profiles', 'coder')) };
    };
    // Hermes counts a profile's skills lazily: the first list warms that count, and only later ones are comparable.
    await snapshot();
    const before = await snapshot();
    await owner.call('PUT', route('coder'), { assistantName: 'Cody' });
    expect(await snapshot()).toEqual(before);
  });
});

describe('what the page does with the name when Hermes renames or deletes the profile', () => {
  test('a rename carries the name to the new profile name and leaves none under the old one; a delete clears it', async () => {
    const owner = await start();
    await saveAssistantName('coder', 'Cody', owner.request);

    await moveProfilePreferences('coder', 'coder-2', owner.request);
    expect((await owner.call('GET', route('coder-2'))).body).toEqual({ assistantName: 'Cody' });
    expect((await owner.call('GET', route('coder'))).body).toEqual({ assistantName: null });
    expect(await loadAssistantName('coder-2', owner.request, true)).toBe('Cody');

    await forgetProfilePreferences('coder-2', owner.request);
    expect((await owner.call('GET', route('coder-2'))).body).toEqual({ assistantName: null });
  });

  test('renaming a profile that has no name stores nothing', async () => {
    const owner = await start();
    await moveProfilePreferences('writer', 'writer-2', owner.request);
    expect((await owner.call('GET', route('writer-2'))).body).toEqual({ assistantName: null });
  });
});
