import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { CADUCEUS_SESSION_SOURCE, type CompatibilityReport } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { loadPinnedContracts, type HermesContracts } from '../src/hermes-contract.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { openGatewayConnection } from './fixtures/gateway-client.ts';
import { ownerCookie } from './fixtures/owner.ts';

// The drift check: Caduceus's pinned contracts against the real installed Hermes (in a throwaway HERMES_HOME).
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
  // A mismatch turns read-only mode on by itself, and the next test's server must not inherit it.
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function compatibility(): Promise<CompatibilityReport> {
  const cookie = await ownerCookie(server!.url);
  return (await fetch(`${server!.url}/_caduceus/api/compatibility`, { headers: { cookie } })).json();
}

const noChanges = { added: [], removed: [], changed: [] };

describe('Hermes compatibility', () => {
  test('reports the local Hermes compatible with the pinned contracts, including its gateway markers', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });

    // A failure here means the installed Hermes drifted from the pin: run `npm run contracts:regenerate`.
    const pin = await loadPinnedContracts();
    expect(await compatibility()).toEqual({
      state: 'compatible',
      pinnedVersion: pin.version,
      hermesVersion: pin.version,
      reasons: [],
      rest: noChanges,
      gateway: noChanges,
      markers: {
        pinned: {
          replayEpoch: true,
          heartbeat: true,
          changeEvents: true,
          capabilities: { per_session_exclusive_submit: true },
          desktopContract: pin.markers.desktopContract,
        },
        // Hermes reports desktop_contract only in session.info; Caduceus creates no session just to read it.
        live: {
          replayEpoch: true,
          heartbeat: true,
          changeEvents: true,
          capabilities: { per_session_exclusive_submit: true },
          desktopContract: null,
        },
      },
    });
  });

  test('names every pinned operation, method and marker the running Hermes no longer matches', async () => {
    const pin = await loadPinnedContracts();
    const status = pin.rest.paths['/api/status'];
    const pinned: HermesContracts = {
      ...pin,
      rest: {
        ...pin.rest,
        paths: {
          ...pin.rest.paths,
          '/api/retired': { get: { responses: {} } },
          '/api/status': { ...status, get: { ...status.get, parameters: [] } },
        },
      },
      gateway: {
        ...pin.gateway,
        methods: pin.gateway.methods
          .filter((method) => method.name !== 'ping')
          .map((method) =>
            method.name === 'session.create' ? { ...method, params: [{ name: 'params', schema: { type: 'object' } }] } : method,
          ),
      },
      markers: { ...pin.markers, heartbeat: false, capabilities: { ...pin.markers.capabilities, retired_flag: true } },
    };
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir, pinned });

    expect(await compatibility()).toMatchObject({
      state: 'incompatible',
      reasons: [
        'REST removed: GET /api/retired',
        'REST changed: GET /api/status (parameters)',
        'Gateway changed: method session.create (params)',
        'Gateway marker changed: heartbeat: pinned false, live true',
        'Gateway marker changed: gateway.capabilities retired_flag: pinned true, live missing',
      ],
      rest: { added: [], removed: ['GET /api/retired'], changed: ['GET /api/status (parameters)'] },
      gateway: { added: ['method ping'], removed: [], changed: ['method session.create (params)'] },
    });
  });

  test('takes the desktop contract number from the first session Hermes reports it in, and compares it with the pin', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
    expect(await compatibility()).toMatchObject({ markers: { live: { desktopContract: null } } });

    // Hermes says it in the `info` of the session it creates (and in every `session.info` event after).
    const page = openGatewayConnection(server.url, await ownerCookie(server.url));
    await page.until((status) => status.state === 'connected');
    const created = await page.connection.client.request<{ session_id: string; info: { desktop_contract?: number } }>('session.create', { source: CADUCEUS_SESSION_SOURCE });
    await page.connection.client.request('session.close', { session_id: created.session_id });
    page.connection.close();

    const { markers } = await loadPinnedContracts();
    expect(created.info.desktop_contract).toBe(markers.desktopContract);
    expect(await compatibility()).toMatchObject({ state: 'compatible', reasons: [], markers: { pinned: { desktopContract: markers.desktopContract }, live: { desktopContract: markers.desktopContract } } });
  });
});
