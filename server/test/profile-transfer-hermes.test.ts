import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { importPreview, readArchive } from '../../web/src/modules/profiles/profile-archive.ts';
import { exportProfile, importProfile, type TransferDeps } from '../../web/src/modules/profiles/profile-transfer.ts';
import type { ConfirmRequest } from '../../web/src/palette.ts';
import { createTieredFetch } from '../../web/src/tiered-fetch.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Export and import of a profile (M4 #12): the page's own transfer code (`web/src/modules/profiles/profile-transfer.ts`) and archive reader over
// the browser's REST proxy of a Caduceus server in front of a real Hermes in a throwaway HERMES_HOME. The archives are made and read by Hermes.
let hermes: TestHermes;
let server: CaduceusServer | undefined;

beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(path.join(hermes.home, 'profile-exports'), { recursive: true, force: true });
  for (const profile of await profileNames()) if (profile !== 'default') await hermes.cli('profile', 'delete', profile, '--yes');
});

const around = async <T = any>(route: string): Promise<T> => (await hermes.backend.fetch(route)).json() as Promise<T>;
const profileNames = async () => (await around<{ profiles: { name: string }[] }>('/api/profiles')).profiles.map((profile) => profile.name);
const soulOf = async (profile: string) => (await around<{ content: string }>(`/api/profiles/${profile}/soul`)).content;

interface Owner {
  deps: TransferDeps;
  dialogs: ConfirmRequest[];
  decline: Set<string>;
  readOnly(value: boolean): Promise<void>;
}

async function openOwner(): Promise<Owner> {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const url = server.url;
  const cookie = await ownerCookie(url);
  await stepUp(url, cookie, await addPasskey(url, cookie));
  const dialogs: ConfirmRequest[] = [];
  const decline = new Set<string>();
  const state = { readOnly: false };
  const send = createTieredFetch({
    fetch: (route, init) => fetch(`${url}${route}`, { ...init, headers: { origin: url, cookie, ...Object.fromEntries(new Headers(init.headers)) } }),
    confirmer: () => async (request) => {
      dialogs.push(request);
      return decline.has(request.action) ? undefined : { typed: request.object ?? request.label };
    },
    withStepUp: (request) => request(),
    online: () => true,
    readOnly: () => state.readOnly,
    sha256: async (text) => crypto.createHash('sha256').update(text).digest('hex'),
  });
  const download = async (route: string) => {
    const res = await fetch(`${url}/api/files/download?path=${encodeURIComponent(route)}`, { headers: { cookie } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  };
  return {
    deps: { send, download },
    dialogs,
    decline,
    async readOnly(value) {
      const res = await fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: value }) });
      if (!res.ok) throw new Error(`Read-only mode: HTTP ${res.status}`);
      state.readOnly = value;
    },
  };
}

const SOUL = '# Scribe\n\nYou write well.\n';
async function profileWithSoul(name: string) {
  await hermes.cli('profile', 'create', name);
  await hermes.backend.fetch(`/api/profiles/${name}/soul`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: SOUL }) });
}

describe('exporting a profile', () => {
  test('is a Tier 3 that Hermes answers with its archive, which the browser downloads: the profile’s SOUL is in it, and the profile is as it was', async () => {
    const owner = await openOwner();
    await profileWithSoul('scribe');

    const outcome = await exportProfile(owner.deps, 'scribe');

    if (outcome.kind !== 'done') throw new Error(JSON.stringify(outcome));
    expect(owner.dialogs.map((dialog) => [dialog.tier, dialog.action, dialog.object])).toEqual([['T3', 'POST /api/profiles/{name}/export', 'scribe']]);
    expect(outcome.fileName).toMatch(/^scribe-\d{8}-\d{6}\.tar\.gz$/);
    expect(outcome.hermesPath).toBe(path.join(hermes.home, 'profile-exports', outcome.fileName));
    // The browser has the bytes Hermes wrote.
    expect(Buffer.from(await outcome.archive.arrayBuffer()).equals(fs.readFileSync(outcome.hermesPath))).toBe(true);
    const listing = await readArchive(outcome.archive);
    expect(listing).toMatchObject({ roots: ['scribe'], hasSoul: true });
    expect(listing.soul).toContain('You write well.');
    expect(await soulOf('scribe')).toBe(SOUL);
  });

  test('is not made when the owner declines, and is blocked in read-only mode', async () => {
    const owner = await openOwner();
    await profileWithSoul('scribe');
    owner.decline.add('POST /api/profiles/{name}/export');

    expect(await exportProfile(owner.deps, 'scribe')).toEqual({ kind: 'cancelled' });
    owner.decline.clear();
    await owner.readOnly(true);
    expect(await exportProfile(owner.deps, 'scribe')).toMatchObject({ kind: 'failed', message: expect.stringContaining('Read-only mode is on') });
    expect(fs.existsSync(path.join(hermes.home, 'profile-exports'))).toBe(false);
  });
});

describe('importing a profile', () => {
  async function archiveOfScribe(owner: Owner) {
    await profileWithSoul('scribe');
    const outcome = await exportProfile(owner.deps, 'scribe');
    if (outcome.kind !== 'done') throw new Error(JSON.stringify(outcome));
    owner.dialogs.length = 0;
    return outcome.archive;
  }
  const request = (file: Blob, name: string) => ({ file, fileName: 'scribe.tar.gz', name, rootPath: hermes.home, now: 1_700_000_000_000 });

  test('previews the name and the conflict, then makes a profile that is the archive’s, and leaves nothing uploaded behind', async () => {
    const owner = await openOwner();
    const archive = await archiveOfScribe(owner);
    const listing = await readArchive(archive);

    // The name the archive has is taken: that is shown before anything is sent.
    expect(importPreview(listing, '', await profileNames())).toMatchObject({ name: 'scribe', problem: 'A profile called “scribe” already exists.' });
    const chosen = importPreview(listing, 'scribe-2', await profileNames());
    expect(chosen).toEqual({ name: 'scribe-2', problem: undefined, needsName: false });

    const outcome = await importProfile(owner.deps, request(archive, 'scribe-2'), chosen.name!);

    expect(outcome).toEqual({ kind: 'done', name: 'scribe-2' });
    expect(await profileNames()).toContain('scribe-2');
    expect(await soulOf('scribe-2')).toBe(SOUL);
    // Hermes took the name that was given, not the archive's: the original is untouched.
    expect(await soulOf('scribe')).toBe(SOUL);
    expect(owner.dialogs.map((dialog) => [dialog.tier, dialog.action, dialog.object])).toEqual([['T3', 'POST /api/profiles/import', 'scribe-2']]);
    expect(fs.readdirSync(path.join(hermes.home, 'profile-imports'))).toEqual([]);
  });

  test('a name Hermes refuses after all (it was taken a moment ago) is said in Hermes’s words, and the upload is still removed', async () => {
    const owner = await openOwner();
    const archive = await archiveOfScribe(owner);

    const outcome = await importProfile(owner.deps, request(archive, ''), 'scribe');

    expect(outcome).toMatchObject({ kind: 'failed', message: expect.stringContaining('already exists') });
    expect(fs.readdirSync(path.join(hermes.home, 'profile-imports'))).toEqual([]);
    expect(await profileNames()).toEqual(['default', 'scribe']);
  });

  test('is not made when the owner declines the import, and is blocked in read-only mode', async () => {
    const owner = await openOwner();
    const archive = await archiveOfScribe(owner);
    owner.decline.add('POST /api/profiles/import');

    expect(await importProfile(owner.deps, request(archive, 'scribe-2'), 'scribe-2')).toEqual({ kind: 'cancelled' });
    owner.decline.clear();
    await owner.readOnly(true);
    expect(await importProfile(owner.deps, request(archive, 'scribe-2'), 'scribe-2')).toMatchObject({ kind: 'failed', message: expect.stringContaining('Read-only mode is on') });
    expect(await profileNames()).toEqual(['default', 'scribe']);
    expect(fs.readdirSync(path.join(hermes.home, 'profile-imports'))).toEqual([]);
  });

  test('a file that is not an archive reaches Hermes only if the owner insists, and Hermes refuses it', async () => {
    const owner = await openOwner();

    const outcome = await importProfile(owner.deps, request(new Blob(['not an archive']), 'x'), 'x');

    expect(outcome.kind).toBe('failed');
    expect(await profileNames()).toEqual(['default']);
  });
});
