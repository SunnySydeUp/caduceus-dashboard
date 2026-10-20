import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileSnapshot, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { fileRef, fingerprint, memoryPath, memoryReset, memoryUse, saveRequest, snapshotPath, snapshotsPath, type FileRef } from '../../web/src/modules/profiles/behaviour-files.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Agents › Profiles › the behaviour-file editors (M4 #02) through the Caduceus server, in front of the real Hermes in a throwaway
// HERMES_HOME. The page's own request code (`web/src/modules/profiles/behaviour-files.ts`) is run over what Hermes really answers.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  const made = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'coder' }) });
  expect(made.ok).toBe(true);
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

interface Answer<T> {
  status: number;
  body: T;
  text: string;
}

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Answer<T>>;
  /** Sends one of the page's requests the way the tiered dialog does for a T3: with the typed confirmation of `typed`. */
  send<T = unknown>(request: { method: string; path: string; body?: Record<string, unknown>; headers?: Record<string, string> }, typed: string | null): Promise<Answer<T>>;
}

async function start(options: { steppedUp?: boolean; fileRoots?: readonly string[] } = {}): Promise<Owner> {
  const { steppedUp = true, fileRoots } = options;
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, fileRoots });
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  const call: Owner['call'] = async (method, route, { body, headers } = {}) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as never };
  };
  const send: Owner['send'] = async (request, typed) => {
    let confirmation: string | undefined;
    if (typed !== null) {
      const bodySha256 = request.body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex');
      const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation: `${request.method} ${request.path}`, target: typed, typed, ...(bodySha256 ? { bodySha256 } : {}) } });
      confirmation = minted.body.token;
    }
    return call(request.method, request.path, { body: request.body, headers: { ...request.headers, ...(confirmation ? { 'x-caduceus-confirmation': confirmation } : {}) } });
  };
  return { call, send };
}

const profilePath = async (name: string): Promise<string> => {
  const list = (await (await hermes.backend.fetch('/api/profiles')).json()) as { profiles: { name: string; path: string }[] };
  return list.profiles.find((profile) => profile.name === name)!.path;
};
const snapshotsOf = async (owner: Owner, ref: FileRef) => (await owner.call<{ snapshots: FileSnapshot[] }>('GET', snapshotsPath(ref))).body.snapshots;

describe('saving SOUL.md', () => {
  test('is a Tier 3 write that keeps the text it replaces as a snapshot, listed with its time and size', async () => {
    const owner = await start();
    const ref = fileRef('soul', 'coder', await profilePath('coder'));
    const original = ((await (await hermes.backend.fetch('/api/profiles/coder/soul')).json()) as { content: string }).content;

    const refused = await owner.send<PolicyRefusal>(saveRequest(ref, 'You are Coder.\n'), null);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    expect(await snapshotsOf(owner, ref)).toEqual([]);

    const saved = await owner.send(saveRequest(ref, 'You are Coder.\n'), 'coder');
    const listed = await snapshotsOf(owner, ref);

    expect(saved.status).toBe(200);
    expect(((await (await hermes.backend.fetch('/api/profiles/coder/soul')).json()) as { content: string }).content).toBe('You are Coder.\n');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ bytes: Buffer.byteLength(original) });
    expect(Date.parse(listed[0].at)).not.toBeNaN();
    const text = await owner.call<{ text: string }>('GET', `/_caduceus/api/file-snapshots/${listed[0].id}`);
    expect(text.body.text).toBe(original);
  });
});

describe('the snapshots of a file', () => {
  test('are a ring: the newest 20 are kept and the oldest go', async () => {
    const owner = await start();
    const ref = fileRef('soul', 'coder', await profilePath('coder'));
    let current = ((await (await hermes.backend.fetch('/api/profiles/coder/soul')).json()) as { content: string }).content;
    for (let version = 1; version <= 23; version++) {
      const next = `Version ${version}\n`;
      expect((await owner.send(saveRequest(ref, next, await fingerprint(current)), 'coder')).status).toBe(200);
      current = next;
    }

    const kept = await snapshotsOf(owner, ref);

    expect(kept).toHaveLength(20);
    expect((await owner.call<{ text: string }>('GET', snapshotPath(kept[0].id))).body.text).toBe('Version 22\n');
    expect((await owner.call<{ text: string }>('GET', snapshotPath(kept[19].id))).body.text).toBe('Version 3\n');
  });
});

describe('Restore previous', () => {
  test('is a save of the snapshot’s text like any other: Tier 3, and it snapshots the text it replaces first', async () => {
    const owner = await start();
    const ref = fileRef('soul', 'coder', await profilePath('coder'));
    const soulNow = async () => ((await (await hermes.backend.fetch('/api/profiles/coder/soul')).json()) as { content: string }).content;
    const first = await soulNow();
    await owner.send(saveRequest(ref, 'Second version.\n'), 'coder');
    await owner.send(saveRequest(ref, 'Third version.\n'), 'coder');
    const [newest, oldest] = await snapshotsOf(owner, ref);
    expect(await owner.call('GET', snapshotPath(newest.id))).toMatchObject({ body: { text: 'Second version.\n' } });

    const refused = await owner.send<PolicyRefusal>(saveRequest(ref, 'Second version.\n', await fingerprint('Third version.\n')), null);
    expect(refused).toMatchObject({ status: 403, body: { error: 'confirmation-required', tier: 'T3' } });
    const restored = await owner.send(saveRequest(ref, 'Second version.\n', await fingerprint('Third version.\n')), 'coder');

    expect(restored.status).toBe(200);
    expect(await soulNow()).toBe('Second version.\n');
    const after = await snapshotsOf(owner, ref);
    expect(after.map((snapshot) => snapshot.bytes)).toEqual([Buffer.byteLength('Third version.\n'), newest.bytes, oldest.bytes]);
    expect((await owner.call<{ text: string }>('GET', snapshotPath(oldest.id))).body.text).toBe(first);
  });
});

describe('a save that names the text it was made from', () => {
  test('is refused when the file changed in Hermes since, with the text now there, and nothing is written or snapshotted', async () => {
    const owner = await start();
    const ref = fileRef('soul', 'coder', await profilePath('coder'));
    await owner.send(saveRequest(ref, 'Loaded text.\n'), 'coder');
    const before = (await snapshotsOf(owner, ref)).length;
    // Someone else (the CLI, the stock dashboard) saves while the editor is open.
    await hermes.backend.fetch('/api/profiles/coder/soul', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Changed elsewhere.\n' }) });

    const blind = await owner.send<{ error: string; current: string }>(saveRequest(ref, 'My edit.\n', await fingerprint('Loaded text.\n')), 'coder');

    expect(blind.status).toBe(409);
    expect(blind.body).toMatchObject({ error: 'conflict', current: 'Changed elsewhere.\n' });
    expect(((await (await hermes.backend.fetch('/api/profiles/coder/soul')).json()) as { content: string }).content).toBe('Changed elsewhere.\n');
    expect(await snapshotsOf(owner, ref)).toHaveLength(before);

    const again = await owner.send(saveRequest(ref, 'My edit.\n', await fingerprint('Changed elsewhere.\n')), 'coder');
    expect(again.status).toBe(200);
  });
});

describe('AGENTS.md, HERMES.md, MEMORY.md and USER.md', () => {
  test('are written through Hermes’s fs routes: a new file has nothing to snapshot, a changed one is kept, and it is all Tier 3', async () => {
    const owner = await start();
    const where = await profilePath('coder');
    const agents = fileRef('agents', 'coder', where);
    const read = async (ref: FileRef) => {
      const res = await hermes.backend.fetch(`/api/fs/read-text?path=${encodeURIComponent((ref as { path: string }).path)}`);
      return res.status === 404 ? undefined : ((await res.json()) as { text: string }).text;
    };
    expect(await read(agents)).toBeUndefined();

    expect((await owner.send<PolicyRefusal>(saveRequest(agents, '# Rules\n', await fingerprint('')), null)).body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    const created = await owner.send(saveRequest(agents, '# Rules\n', await fingerprint('')), 'coder');
    expect(created.status).toBe(200);
    expect(await snapshotsOf(owner, agents)).toEqual([]);

    await owner.send(saveRequest(agents, '# Rules, v2\n', await fingerprint('# Rules\n')), 'coder');
    const kept = await snapshotsOf(owner, agents);
    expect(kept).toHaveLength(1);
    expect((await owner.call<{ text: string }>('GET', snapshotPath(kept[0].id))).body.text).toBe('# Rules\n');
    expect(await read(agents)).toBe('# Rules, v2\n');

    for (const id of ['hermes', 'memory', 'user'] as const) {
      const ref = fileRef(id, 'coder', where);
      expect((await owner.send(saveRequest(ref, `${id} text\n`, await fingerprint('')), 'coder')).status).toBe(200);
      expect(await read(ref)).toBe(`${id} text\n`);
    }
    const stale = await owner.send<{ error: string }>(saveRequest(agents, 'x', await fingerprint('')), 'coder');
    expect(stale).toMatchObject({ status: 409, body: { error: 'conflict' } });
  });
});

describe('what a file write may touch', () => {
  test('writes outside Hermes’s folders, to a .env or auth.json, or into Caduceus’s own directory are denied before Hermes sees them, with no snapshot taken', async () => {
    const owner = await start({ fileRoots: [] });
    const where = await profilePath('coder');
    const elsewhere = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'caduceus-elsewhere-'));
    try {
      const attempts: [string, string][] = [
        [path.join(elsewhere, 'notes.md'), 'outside-roots'],
        [path.join(where, '.env'), 'protected-path'],
        [path.join(where, 'auth.json'), 'protected-path'],
        [path.join(hermes.home, 'caduceus', 'caduceus.db'), 'protected-path'],
      ];
      for (const [target, reason] of attempts) {
        const answer = await owner.send<PolicyRefusal>(saveRequest({ kind: 'file', path: target }, 'overwritten\n'), 'coder');
        expect([target, answer.status, answer.body.error === 'denied' ? answer.body.reason : answer.body.error]).toEqual([target, 403, reason]);
      }
      expect(fs.existsSync(path.join(elsewhere, 'notes.md'))).toBe(false);
      expect(fs.existsSync(path.join(where, 'auth.json'))).toBe(false);
      expect((await owner.call('GET', snapshotsPath({ kind: 'file', path: path.join(where, '.env') }))).status).toBe(400);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test('every write is blocked in read-only mode, and the snapshots and the files still read', async () => {
    const owner = await start();
    const where = await profilePath('coder');
    const refs: FileRef[] = [fileRef('soul', 'coder', where), fileRef('config', 'coder', where), fileRef('memory', 'coder', where)];
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });

    const answers = await Promise.all(refs.map((ref) => owner.send<PolicyRefusal>(saveRequest(ref, 'x\n'), 'coder')));
    const listed = await owner.call('GET', snapshotsPath(refs[0]));
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });

    expect(answers.map((answer) => [answer.status, answer.body.error])).toEqual(refs.map(() => [403, 'read-only']));
    expect(listed.status).toBe(200);
  });
});

describe('config.yaml', () => {
  const SECRET = 'sk-live-0123456789abcdef';
  const rawOf = async (profile: string) => ((await (await hermes.backend.fetch(`/api/config/raw?profile=${profile}`)).json()) as { yaml: string }).yaml;
  const putRaw = (profile: string, yaml: string) => hermes.backend.fetch(`/api/config/raw?profile=${profile}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yaml_text: yaml }) });

  test('is read without the value of any key that holds a credential, and a save of that text keeps Hermes’s value of each', async () => {
    const owner = await start();
    const ref = fileRef('config', 'coder', await profilePath('coder'));
    expect((await putRaw('coder', `agent:\n  max_turns: 11\nauxiliary:\n  vision:\n    api_key: ${SECRET}\n    model: small\n`)).status).toBe(200);

    const read = await owner.call<{ yaml: string }>('GET', '/api/config/raw?profile=coder');
    expect(read.text).not.toContain(SECRET);
    expect(read.body.yaml).toContain('api_key: "********"');
    expect(read.body.yaml).toContain('max_turns: 11');

    const edited = read.body.yaml.replace('max_turns: 11', 'max_turns: 12');
    const saved = await owner.send(saveRequest(ref, edited, await fingerprint(read.body.yaml)), 'coder');

    expect(saved.status).toBe(200);
    const now = await rawOf('coder');
    expect(now).toContain(`api_key: ${SECRET}`);
    expect(now).toContain('max_turns: 12');
    const kept = await snapshotsOf(owner, ref);
    expect(kept).toHaveLength(1);
    const snapshot = await owner.call<{ text: string }>('GET', snapshotPath(kept[0].id));
    expect(snapshot.text).not.toContain(SECRET);
    expect(snapshot.body.text).toContain('max_turns: 11');
  });

  test('a save that sets a credential’s value is taken as it is, and one that masks a credential Hermes does not have is refused', async () => {
    const owner = await start();
    const ref = fileRef('config', 'coder', await profilePath('coder'));
    const loaded = (await owner.call<{ yaml: string }>('GET', '/api/config/raw?profile=coder')).body.yaml;

    const fresh = await owner.send(saveRequest(ref, loaded.replace('model: small', 'model: small\n    base_url: http://127.0.0.1:1/v1').replace('api_key: "********"', 'api_key: sk-new-value-98765'), await fingerprint(loaded)), 'coder');
    expect(fresh.status).toBe(200);
    expect(await rawOf('coder')).toContain('api_key: sk-new-value-98765');

    const invented = await owner.send<{ error: string }>(saveRequest(ref, 'security:\n  api_key: "********"\n'), 'coder');
    expect(invented).toMatchObject({ status: 422, body: { error: 'masked-secret', keys: ['security.api_key'] } });
    expect(await rawOf('coder')).toContain('api_key: sk-new-value-98765');
  });

  test('is masked however its address is spelled', async () => {
    const owner = await start();

    const read = await owner.call('GET', '/api/config/%72aw?profile=coder');

    expect(read.status).toBe(200);
    expect(read.text).not.toContain('sk-new-value-98765');
    expect(read.text).toContain('api_key: \\"********\\"');
  });
});

describe('built-in memory', () => {
  const useOf = async (owner: Owner, profile: string) => memoryUse((await owner.call('GET', memoryPath(profile))).body, (await owner.call('GET', `/api/config?profile=${profile}`)).body);

  test('shows the size of MEMORY.md and USER.md from Hermes’s memory endpoint against the limits in the profile’s config', async () => {
    const owner = await start();
    const where = await profilePath('coder');
    await owner.send(memoryReset('coder', 'all'), 'coder');
    await owner.send(saveRequest(fileRef('memory', 'coder', where), 'Prefers tabs.\n§\nLives in Brisbane.\n', await fingerprint('')), 'coder');

    const use = await useOf(owner, 'coder');

    expect(use.memory).toEqual({ bytes: Buffer.byteLength('Prefers tabs.\n§\nLives in Brisbane.\n'), limit: 2200 });
    expect(use.user).toEqual({ bytes: 0, limit: 1375 });
  });

  test('Reset is a Tier 3 action for MEMORY, USER or both; it removes what Hermes holds and is refused in read-only mode', async () => {
    const owner = await start();
    const where = await profilePath('coder');
    const user = fileRef('user', 'coder', where);
    await owner.send(memoryReset('coder', 'all'), 'coder');
    await owner.send(saveRequest(fileRef('memory', 'coder', where), 'Likes tea.\n', await fingerprint('')), 'coder');
    await owner.send(saveRequest(user, 'Name: Sam\n', await fingerprint('')), 'coder');

    const refused = await owner.send<PolicyRefusal>(memoryReset('coder', 'memory'), null);
    expect(refused).toMatchObject({ status: 403, body: { error: 'confirmation-required', tier: 'T3' } });
    expect((await useOf(owner, 'coder')).memory.bytes).toBeGreaterThan(0);

    expect((await owner.send(memoryReset('coder', 'memory'), 'coder')).status).toBe(200);
    const afterMemory = await useOf(owner, 'coder');
    expect(afterMemory.memory.bytes).toBe(0);
    expect(afterMemory.user.bytes).toBeGreaterThan(0);

    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    expect(await owner.send<PolicyRefusal>(memoryReset('coder', 'all'), 'coder')).toMatchObject({ status: 403, body: { error: 'read-only' } });
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });

    expect((await owner.send(memoryReset('coder', 'all'), 'coder')).status).toBe(200);
    expect(await useOf(owner, 'coder')).toMatchObject({ memory: { bytes: 0 }, user: { bytes: 0 } });
  });

  test('a reset keeps what it clears as a snapshot of each file, so History can put it back', async () => {
    const owner = await start();
    const where = await profilePath('coder');
    const memory = fileRef('memory', 'coder', where);
    const user = fileRef('user', 'coder', where);
    await owner.send(memoryReset('coder', 'all'), 'coder');
    await owner.send(saveRequest(memory, 'Remember this.\n', await fingerprint('')), 'coder');
    await owner.send(saveRequest(user, 'Name: Sam\n', await fingerprint('')), 'coder');
    const keptBefore = (await snapshotsOf(owner, memory)).length;

    await owner.send(memoryReset('coder', 'all'), 'coder');

    const [latest] = await snapshotsOf(owner, memory);
    expect((await snapshotsOf(owner, memory)).length).toBe(keptBefore + 1);
    expect((await owner.call<{ text: string }>('GET', snapshotPath(latest.id))).body.text).toBe('Remember this.\n');
    const [userLatest] = await snapshotsOf(owner, user);
    expect((await owner.call<{ text: string }>('GET', snapshotPath(userLatest.id))).body.text).toBe('Name: Sam\n');
    const restored = await owner.send(saveRequest(memory, 'Remember this.\n', await fingerprint('')), 'coder');
    expect(restored.status).toBe(200);
  });
});
