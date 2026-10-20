import { afterEach, describe, expect, test } from 'vitest';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { FAKE_HERMES_ROUTES, fakeLaunch, fakeStateDir, launchFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
/** Throwaway dirs to remove after each test: a root home for the Caduceus store (the fake Hermes has none) and fake state. */
let tempDirs: string[] = [];
afterEach(async () => {
  await server?.close();
  await backend?.stop();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  server = undefined;
  backend = undefined;
  tempDirs = [];
});

/** Starts Caduceus in front of `hermes` and signs in as the owner; returns the server and the cookie to send. */
async function startSignedIn(hermes: HermesBackend): Promise<{ url: string; cookie: string }> {
  const hermesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  tempDirs.push(hermesRoot);
  server = await startCaduceusServer({ backend: hermes, hermesRoot, extraRoutes: FAKE_HERMES_ROUTES });
  return { url: server.url, cookie: await ownerCookie(server.url) };
}

describe('Caduceus server', () => {
  test('serves Hermes API answers to the browser, listening on loopback only', async () => {
    backend = launchFakeHermes();
    const { url, cookie } = await startSignedIn(backend);
    await backend.ready();

    const res = await fetch(`${url}/api/profiles`, { headers: { cookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profiles: [{ name: 'default' }, { name: 'coder' }, { name: 'librarian' }] });
    expect(new URL(url).hostname).toBe('127.0.0.1');
  });

  test("forwards browser requests to Hermes with Hermes's own Host and the launch secret attached", async () => {
    backend = launchFakeHermes();
    const { url, cookie } = await startSignedIn(backend);
    await backend.ready();

    const res = await fetch(`${url}/api/__fake/echo`, { headers: { cookie, 'x-hermes-session-token': 'forged-by-browser' } });
    const seen = await res.json();

    expect(seen.host).toBe(`127.0.0.1:${seen.boundPort}`);
    expect(seen.authorized).toBe(true);
  });

  test('never lets the launch secret reach the browser, even when Hermes echoes it', async () => {
    const dir = fakeStateDir();
    tempDirs.push(dir);
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir } });
    const { url, cookie } = await startSignedIn(backend);
    await backend.ready();
    const { token } = fakeLaunch(dir, 1);

    const leaks: string[] = [];
    for (const route of ['/', '/api/__fake/leak', '/api/status', '/api/does-not-exist']) {
      const res = await fetch(`${url}${route}`, { headers: { cookie } });
      const seen = `${[...res.headers].flat().join('\n')}\n${await res.text()}`;
      if (seen.includes(token)) leaks.push(route);
    }

    expect(leaks).toEqual([]);
  });

  test('tells the browser Hermes is restarting instead of hanging while it is down', async () => {
    const dir = fakeStateDir();
    tempDirs.push(dir);
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir }, restartDelaysMs: [60_000] });
    const { url, cookie } = await startSignedIn(backend);
    await backend.ready();
    const { pid } = fakeLaunch(dir, 1);

    const wentDown = once(backend, 'status');
    process.kill(pid, 'SIGKILL');
    await wentDown;
    const api = await fetch(`${url}/api/profiles`, { headers: { cookie } });
    const backendState = await fetch(`${url}/_caduceus/api/backend`, { headers: { cookie } });

    expect(api.status).toBe(503);
    expect(await backendState.json()).toEqual({ state: 'restarting', attempt: 1, retryInMs: 60_000 });
  });
});
