import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { OFFLINE_ENV } from './fixtures/plugin-repo.ts';

// What the Updates screen reads from the real Hermes, in a throwaway HERMES_HOME and off the internet. The update itself is never run here: it would
// update the installed Hermes the owner uses (the stub upstream tests in updates.test.ts cover the update, step by step).
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes({ env: OFFLINE_ENV });
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function get(route: string) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const cookie = await ownerCookie(server.url);
  const res = await fetch(`${server.url}${route}`, { headers: { origin: server.url, cookie } });
  return { status: res.status, body: await res.json() };
}

describe('the update routes of the real Hermes, as the Updates screen reads them', () => {
  test('the check says how Hermes is installed, its version and whether an update can be applied, and an unreachable source is "could not check", not "up to date"', async () => {
    const { status, body } = await get('/api/hermes/update/check?force=true');

    expect(status).toBe(200);
    expect(body).toMatchObject({ install_method: expect.any(String), current_version: expect.stringMatching(new RegExp(`^${hermes.install.version.replaceAll('.', '\\.')}(\\+|$)`)), can_apply: expect.any(Boolean), update_available: false });
    // Hermes adds the commits since the release and the commit to its version (`0.22.2+1979.g5fc490e`): the release part is the installed version.
    // Off the internet, Hermes cannot count the commits behind: it says so with `null`, which the screen must not read as "up to date".
    expect(body.behind).toBeNull();
  });

  test('before any update has run there is no receipt (404), and the update log is an empty window that is not running', async () => {
    const receipt = await get('/api/hermes/update/receipt');
    const log = await get('/api/actions/hermes-update/status?lines=2000');

    expect(receipt.status).toBe(404);
    expect(log.body).toMatchObject({ name: 'hermes-update', running: false, lines: [] });
  });
});
