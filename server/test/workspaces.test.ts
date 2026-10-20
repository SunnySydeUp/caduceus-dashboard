import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import type { ConfirmRequest } from '../../web/src/palette.ts';
import { createTieredFetch } from '../../web/src/tiered-fetch.ts';
import { moveItem } from '../../web/src/modules/work/template-model.ts';
import { createWorkspaceRegistryClient, workspaceChoices } from '../../web/src/modules/work/workspace-registry.ts';

// The workspace registry (M3 #10): Caduceus's own list of named directories, through the Caduceus server's HTTP API in front of the real
// Hermes in a throwaway HERMES_HOME. A folder is added only when it is inside the folders Caduceus lets Hermes write to and Hermes's own
// file list finds it; removing an entry never touches the folder.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
let area: string;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  if (area) fs.rmSync(area, { recursive: true, force: true });
});

interface Entry {
  id: string;
  name: string;
  path: string;
}

interface Reply {
  workspaces: Entry[];
  error: string;
  message: string;
  // An entry's own fields, when the route answers one.
  id: string;
  name: string;
  path: string;
}

interface Owner {
  url: string;
  cookie: string;
  call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Reply }>;
  list(): Promise<Entry[]>;
}

/** A temp area of folders (the allowed root) and a server whose file guard allows only that. */
async function start(options: { workspaceRoots?: () => readonly string[]; previous?: Owner; home?: string } = {}): Promise<Owner> {
  area ??= fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workspaces-')));
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, fileRoots: [area], home: options.home, workspaceRoots: options.workspaceRoots });
  const { url } = server;
  const cookie = options.previous ? options.previous.cookie : await ownerCookie(url);
  const call: Owner['call'] = async (method, route, body) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { url, cookie, call, list: async () => (await call('GET', WORKSPACES)).body.workspaces };
}

const WORKSPACES = '/_caduceus/api/work/workspaces';

const folder = (...parts: string[]) => {
  const target = path.join(area, ...parts);
  fs.mkdirSync(target, { recursive: true });
  return target;
};

describe('adding a workspace', () => {
  test('takes a folder Hermes finds inside the allowed roots, named after the folder unless the owner names it, and lists the entries in the order they were added', async () => {
    area = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workspaces-')));
    const site = folder('site');
    const api = folder('api');
    const owner = await start();

    expect(await owner.list()).toEqual([]);
    const first = await owner.call('POST', WORKSPACES, { path: site });
    const second = await owner.call('POST', WORKSPACES, { path: api, name: '  The API  ' });

    expect(first).toMatchObject({ status: 201, body: { name: 'site', path: site } });
    expect(second).toMatchObject({ status: 201, body: { name: 'The API', path: api } });
    expect(first.body.id).toMatch(/^w_[a-z0-9]+$/);
    expect((await owner.list()).map(({ name, path: where }) => [name, where])).toEqual([
      ['site', site],
      ['The API', api],
    ]);
  });

  test('refuses what is not a folder Hermes can see inside the roots, each with its own reason, and adds nothing', async () => {
    area = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workspaces-')));
    const site = folder('site');
    const file = path.join(area, 'notes.md');
    fs.writeFileSync(file, 'hello');
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-elsewhere-')));
    const owner = await start();
    try {
      await owner.call('POST', WORKSPACES, { path: site });
      const attempts = [
        await owner.call('POST', WORKSPACES, { path: path.join(area, 'missing') }),
        await owner.call('POST', WORKSPACES, { path: file }),
        await owner.call('POST', WORKSPACES, { path: outside }),
        await owner.call('POST', WORKSPACES, { path: 'relative/dir' }),
        await owner.call('POST', WORKSPACES, { path: path.join(hermes.home, 'caduceus') }),
        await owner.call('POST', WORKSPACES, { path: site }),
        await owner.call('POST', WORKSPACES, { path: `${site}/../site/` }),
        await owner.call('POST', WORKSPACES, {}),
        await owner.call('POST', WORKSPACES, { path: folder('named'), name: 'x'.repeat(61) }),
      ];

      expect(attempts.map((attempt) => [attempt.status, attempt.body.error])).toEqual([
        [422, 'not-found'],
        [422, 'not-a-folder'],
        [403, 'outside-roots'],
        [400, 'bad-path'],
        [403, 'protected-path'],
        [409, 'duplicate-path'],
        [409, 'duplicate-path'],
        [400, 'bad-request'],
        [400, 'bad-request'],
      ]);
      expect(attempts[0].body.message).toMatch(/does not find/);
      expect((await owner.list()).map((entry) => entry.path)).toEqual([site]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  test('is never the owner’s home folder or a folder that holds it (a workspace writes at T1), nor a place that runs code later', async () => {
    area = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workspaces-')));
    const home = folder('me');
    const documents = folder('me', 'Documents');
    const ssh = folder('me', '.ssh');
    const owner = await start({ home });

    const attempts = [
      await owner.call('POST', WORKSPACES, { path: home }),
      await owner.call('POST', WORKSPACES, { path: '~' }),
      await owner.call('POST', WORKSPACES, { path: area }),
      await owner.call('POST', WORKSPACES, { path: ssh }),
      await owner.call('POST', WORKSPACES, { path: documents }),
    ];

    expect(attempts.map((attempt) => [attempt.status, attempt.body.error])).toEqual([
      [403, 'protected-path'],
      [403, 'protected-path'],
      [403, 'protected-path'],
      [403, 'persistence-path'],
      [201, undefined],
    ]);
    expect((await owner.list()).map((entry) => entry.path)).toEqual([documents]);
  });

});

describe('the entries of the registry', () => {
  test('are renamed and reordered (T0, nothing is asked), and the list keeps its order across a restart', async () => {
    area = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workspaces-')));
    const owner = await start();
    const [a, b, c] = ['alpha', 'beta', 'gamma'].map((name) => folder(name));
    const added = [a, b, c].map(async (target) => (await owner.call('POST', WORKSPACES, { path: target })).body);
    const [first, second, third] = await Promise.all(added);

    const renamed = await owner.call('PUT', `${WORKSPACES}/${second.id}`, { name: 'Beta site' });
    const reordered = await owner.call('PUT', `${WORKSPACES}/order`, { ids: [third.id, first.id, second.id] });
    const bad = [
      await owner.call('PUT', `${WORKSPACES}/order`, { ids: [first.id, second.id] }),
      await owner.call('PUT', `${WORKSPACES}/order`, { ids: [first.id, first.id, second.id] }),
      await owner.call('PUT', `${WORKSPACES}/order`, { ids: [first.id, second.id, 'w_nope'] }),
      await owner.call('PUT', `${WORKSPACES}/${second.id}`, { name: '   ' }),
      await owner.call('PUT', `${WORKSPACES}/w_nope`, { name: 'Nobody' }),
    ];

    expect(renamed).toMatchObject({ status: 200, body: { id: second.id, name: 'Beta site', path: b } });
    expect(reordered.status).toBe(200);
    expect(reordered.body.workspaces.map((entry) => entry.name)).toEqual(['gamma', 'alpha', 'Beta site']);
    expect(bad.map((attempt) => attempt.status)).toEqual([400, 400, 400, 400, 404]);

    await server!.close();
    const again = await start({ previous: owner });
    expect((await again.list()).map((entry) => [entry.name, entry.path])).toEqual([
      ['gamma', c],
      ['alpha', a],
      ['Beta site', b],
    ]);
  });

  test('are removed at T1, which is audited and refused in read-only mode, and the folder and its files stay exactly where they were', async () => {
    area = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workspaces-')));
    const site = folder('site');
    fs.writeFileSync(path.join(site, 'index.html'), '<h1>hi</h1>');
    const owner = await start();
    const { body: entry } = await owner.call('POST', WORKSPACES, { path: site });

    // Turning read-only mode on or off asks for a step-up.
    await stepUp(owner.url, owner.cookie, await addPasskey(owner.url, owner.cookie));
    expect((await owner.call('PUT', '/_caduceus/api/policy/read-only', { readOnly: true })).status).toBe(200);
    const refused = await owner.call('DELETE', `${WORKSPACES}/${entry.id}`);
    expect((await owner.call('PUT', '/_caduceus/api/policy/read-only', { readOnly: false })).status).toBe(200);
    const removed = await owner.call('DELETE', `${WORKSPACES}/${entry.id}`);
    const again = await owner.call('DELETE', `${WORKSPACES}/${entry.id}`);
    const audit = (await owner.call('GET', '/_caduceus/api/audit')).body as unknown as { entries: AuditEntry[] };

    expect(refused).toMatchObject({ status: 403, body: { error: 'read-only' } });
    expect(removed.status).toBe(204);
    expect(again.status).toBe(404);
    expect(await owner.list()).toEqual([]);
    expect(fs.readFileSync(path.join(site, 'index.html'), 'utf8')).toBe('<h1>hi</h1>');
    // The audit log lists the newest first. The refused delete is not in it (it never ran); the second one, for an entry that is gone, was allowed and found nothing.
    expect(audit.entries.filter((row) => row.action.includes('/work/workspaces')).map((row) => [row.action, row.tier])).toEqual([
      ['DELETE /_caduceus/api/work/workspaces/{id}', 'T1'],
      ['DELETE /_caduceus/api/work/workspaces/{id}', 'T1'],
      ['POST /_caduceus/api/work/workspaces', 'T1'],
    ]);
  });
});

describe('the file guard', () => {
  test('knows the registered workspaces: a raw write inside one is a T1 with no passkey, and stops being one when the entry is removed', async () => {
    area = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workspaces-')));
    const site = folder('site');
    const elsewhere = folder('elsewhere');
    const owner = await start();
    const { body: entry } = await owner.call('POST', WORKSPACES, { path: site });
    const write = (target: string) => owner.call('POST', '/api/fs/write-text', { path: target, content: 'export {};\n' });

    // The session holds no step-up, which a T3 write would need.
    const inside = await write(path.join(site, 'main.ts'));
    const outside = await write(path.join(elsewhere, 'main.ts'));
    await owner.call('DELETE', `${WORKSPACES}/${entry.id}`);
    const forgotten = await write(path.join(site, 'again.ts'));

    expect(inside.status).toBe(200);
    expect(fs.readFileSync(path.join(site, 'main.ts'), 'utf8')).toBe('export {};\n');
    expect(outside).toMatchObject({ status: 403, body: { error: 'step-up-required', tier: 'T3' } });
    expect(forgotten).toMatchObject({ status: 403, body: { error: 'step-up-required', tier: 'T3' } });
    expect(fs.existsSync(path.join(site, 'again.ts'))).toBe(false);
  });
});

describe('the page’s registry client', () => {
  test('adds, renames, reorders with up and down, and removes through the policy, and both the composer chip and the Brief editor get the choices in registry order', async () => {
    area = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workspaces-')));
    const [a, b, c] = ['alpha', 'beta', 'gamma'].map((name) => folder(name));
    fs.writeFileSync(path.join(a, 'keep.txt'), 'still here');
    const owner = await start();
    const dialogs: ConfirmRequest[] = [];
    let confirm = true;
    let readOnly = false;
    const send = createTieredFetch({
      fetch: (route, init) => fetch(`${owner.url}${route}`, { ...init, headers: { origin: owner.url, cookie: owner.cookie, ...Object.fromEntries(new Headers(init.headers)) } }),
      confirmer: () => async (request) => {
        dialogs.push(request);
        return confirm ? { typed: request.object ?? request.label } : undefined;
      },
      withStepUp: (request) => request(),
      online: () => true,
      readOnly: () => readOnly,
      sha256: async (text) => crypto.createHash('sha256').update(text).digest('hex'),
    });
    const registry = createWorkspaceRegistryClient({ send, read: async (route) => (await fetch(`${owner.url}${route}`, { headers: { cookie: owner.cookie } })).json() });
    const done = <T,>(outcome: T): Extract<T, { kind: 'done' }> => {
      if ((outcome as { kind: string }).kind !== 'done') throw new Error(JSON.stringify(outcome));
      return outcome as Extract<T, { kind: 'done' }>;
    };

    confirm = false;
    expect(await registry.add(a)).toEqual({ kind: 'cancelled' });
    expect(await registry.list()).toEqual([]);
    confirm = true;
    const first = done(await registry.add(a)).body;
    done(await registry.add(b, 'Beta site'));
    const third = done(await registry.add(c)).body;
    expect(dialogs.map((dialog) => [dialog.tier, dialog.label])).toEqual([
      ['T1', 'Add this folder as a workspace?'],
      ['T1', 'Add this folder as a workspace?'],
      ['T1', 'Add this folder as a workspace?'],
      ['T1', 'Add this folder as a workspace?'],
    ]);
    expect(await registry.add(path.join(area, 'missing'))).toEqual({ kind: 'failed', message: 'Hermes does not find this folder on the Mac that runs it.' });

    // Rename and ↑/↓ are Tier 0: no dialog is asked.
    const asked = dialogs.length;
    done(await registry.rename(first, 'Alpha'));
    const ids = (await registry.list()).map((entry) => entry.id);
    done(await registry.reorder(moveItem(moveItem(ids, third.id, -1), third.id, -1)));
    expect(dialogs).toHaveLength(asked);

    // The composer chip and the Brief editor both offer the registry as it is, in its order, with the folder in use marked.
    const entries = await registry.list();
    expect(workspaceChoices(entries, `${b}/`).map((choice) => [choice.name, choice.current])).toEqual([
      ['gamma', false],
      ['Alpha', false],
      ['Beta site', true],
    ]);
    expect(workspaceChoices(entries).every((choice) => !choice.current)).toBe(true);
    expect(workspaceChoices(entries).map((choice) => choice.path)).toEqual([c, a, b]);

    // Removing asks, says the folder is not touched, and leaves it alone.
    const removal = await registry.remove((await registry.list()).find((entry) => entry.id === first.id)!);
    expect(removal).toEqual({ kind: 'done' });
    expect(dialogs.at(-1)).toMatchObject({ tier: 'T1', label: 'Remove the workspace “Alpha”?' });
    expect(dialogs.at(-1)!.text).toMatch(/folder and its files are not touched/);
    expect(fs.readFileSync(path.join(a, 'keep.txt'), 'utf8')).toBe('still here');
    expect((await registry.list()).map((entry) => entry.name)).toEqual(['gamma', 'Beta site']);

    readOnly = true;
    expect(await registry.remove(third)).toMatchObject({ kind: 'failed', message: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' });
    expect(await registry.rename(third, 'Nope')).toMatchObject({ kind: 'failed' });
    expect((await registry.list()).map((entry) => entry.name)).toEqual(['gamma', 'Beta site']);
  });
});
