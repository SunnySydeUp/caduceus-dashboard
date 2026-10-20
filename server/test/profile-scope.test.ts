import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { chooseProfile, deviceChoice, effectiveProfile, loadProfiles, type DeviceStore } from '../../web/src/profile-scope.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Profile scope as the web app uses it, against the real Hermes (in a throwaway HERMES_HOME) through the Caduceus
// proxy: the profile list comes from Hermes, and choosing a profile in a tab never writes Hermes's default.
const run = promisify(execFile);
let hermes: TestHermes;
let server: CaduceusServer;
let cookie: string;

beforeAll(async () => {
  hermes = await launchTestHermes();
  // Seed through Hermes's own CLI. `--no-alias` keeps it from writing a wrapper script into the owner's ~/.local/bin.
  const env = { ...process.env, HERMES_HOME: hermes.home };
  await run('hermes', ['profile', 'create', 'coder', '--no-alias', '--no-skills'], { env });
  await run('hermes', ['profile', 'create', 'writer', '--no-alias', '--no-skills'], { env });
  await run('hermes', ['profile', 'use', 'coder'], { env });
  await hermes.backend.ready();
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  cookie = await ownerCookie(server.url);
}, 60_000);
afterAll(async () => {
  await server.close();
  await hermes.stop();
});

/** A GET through the Caduceus proxy, the way the web app's `getHermes` calls it. */
async function get(route: string): Promise<unknown> {
  const res = await fetch(`${server.url}${route}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`GET ${route}: HTTP ${res.status}`);
  return res.json();
}

test('the profile list is Hermes own, with its sticky default; choosing profiles in tabs never changes that default', async () => {
  const stickyFile = path.join(hermes.home, 'active_profile');
  const stickyBefore = fs.readFileSync(stickyFile, 'utf8');

  const { profiles, hermesDefault } = await loadProfiles(get);
  expect(profiles.map((p) => p.name).sort()).toEqual(['coder', 'default', 'writer']);
  expect(hermesDefault).toBe('coder');

  // Two tabs share one device. Tab A chooses writer; tab B, which names coder in its URL, is not affected.
  const localStorage = new Map<string, string>();
  const store: DeviceStore = { getItem: (key) => localStorage.get(key) ?? null, setItem: (key, value) => void localStorage.set(key, value) };
  const names = profiles.map((p) => p.name);
  const tabA = chooseProfile({ name: 'writer', search: '', store });
  const tabB = '?profile=coder';
  const scopeOf = (search: string) =>
    effectiveProfile({ urlProfile: new URLSearchParams(search).get('profile') ?? undefined, deviceChoice: deviceChoice(store), hermesDefault, profiles: names });
  expect(scopeOf(tabA)).toEqual({ name: 'writer', source: 'url' });
  expect(scopeOf(tabB)).toEqual({ name: 'coder', source: 'url' });
  // A tab opened later, with no profile in its URL, starts on this device's last choice.
  expect(scopeOf('')).toEqual({ name: 'writer', source: 'device' });

  // Hermes's own default is as it was: through its API and in its sticky file.
  expect(await get('/api/profiles/active')).toMatchObject({ active: 'coder' });
  expect(fs.readFileSync(stickyFile, 'utf8')).toBe(stickyBefore);
});
