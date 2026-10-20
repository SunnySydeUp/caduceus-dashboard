import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCaduceusStore } from '../src/caduceus-store.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { connectBrowserSocket } from './fixtures/browser-socket.ts';
import { openEventStream } from './fixtures/event-stream.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { runProgram } from './fixtures/run-program.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { OFFLINE_ENV } from './fixtures/plugin-repo.ts';

// System › Maintenance › Backup (M5 #14) against the real Hermes in a throwaway HERMES_HOME: Hermes makes the backup archive and restores it, and Caduceus's own
// directory travels in it.
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

interface Answer<T = any> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

async function start(options: { restart?: () => Promise<void> | void } = {}) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, updatePollMs: 50, logPollMs: 50, ...options });
  const { url } = server;
  const cookie = await ownerCookie(url);
  await stepUp(url, cookie, await addPasskey(url, cookie));
  const call = async (method: string, route: string, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Answer> => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
  };
  /** A request the way the tiered dialog sends it: a T3 with the typed confirmation of `typed`. */
  const typed = async (method: string, route: string, typedText: string, body?: unknown): Promise<Answer> => {
    const sha = body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const minted = await call('POST', '/_caduceus/api/policy/confirmations', { body: { operation: `${method} ${route}`, target: typedText, typed: typedText, ...(sha ? { bodySha256: sha } : {}) } });
    return call(method, route, { body, headers: { 'x-caduceus-confirmation': minted.body.token } });
  };
  /** An upload of the file at `file`, as the page's form sends it, with the typed confirmation of `typedText` (the token is bound to the request line, not to a multipart body). */
  const upload = async (route: string, typedText: string, file: string): Promise<Answer> => {
    const minted = await call('POST', '/_caduceus/api/policy/confirmations', { body: { operation: `POST ${route}`, target: typedText, typed: typedText } });
    const form = new FormData();
    form.set('file', new Blob([fs.readFileSync(file)]), path.basename(file));
    form.set('force', 'true');
    const res = await fetch(`${url}${route}`, { method: 'POST', headers: { origin: url, cookie, 'x-caduceus-confirmation': minted.body.token }, body: form });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers, body: text.startsWith('{') ? JSON.parse(text) : text };
  };
  /** Follows a Hermes action's log to its end, as the page does. */
  const finish = async (name: string) => {
    const stream = await openEventStream(url, `/_caduceus/api/maintenance/actions/${name}/stream`, cookie);
    for (;;) {
      const event = await stream.next();
      if (event.event === 'end') return event.data as { ok: boolean; exitCode: number | null };
    }
  };
  return { url, cookie, call, typed, upload, finish };
}

describe('a backup made through Hermes', () => {
  test('is a T3 (a passkey and the typed name), a zip Hermes writes to its backups folder, downloaded only with a typed confirmation, and it holds Caduceus’s own directory', async () => {
    const owner = await start();
    await owner.call('POST', '/_caduceus/api/chat/prompts', { body: { name: 'Keep me', text: 'a saved prompt', tags: [], profile: null } });

    const made = await owner.typed('POST', '/api/ops/backup', 'Hermes home', {});
    const ended = await owner.finish('backup');
    const archive: string = made.body.archive;
    const refused = await owner.call('GET', `/api/ops/backup/download?archive=${encodeURIComponent(archive)}`);
    const download = await owner.typed('GET', `/api/ops/backup/download?archive=${encodeURIComponent(archive)}`, 'backup');
    const names = (await runProgram('unzip', ['-Z1', archive])).split('\n');

    expect(made.status).toBe(200);
    expect(ended).toEqual({ ok: true, exitCode: 0 });
    expect(fs.realpathSync(path.dirname(archive))).toBe(path.join(fs.realpathSync(hermes.home), 'backups'));
    expect(refused.status).toBe(403);
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toBe('no-store');
    expect(download.headers.get('content-disposition')).toContain(path.basename(archive));
    expect(names).toContain('caduceus/caduceus.db');
  });
});

describe('a backup and a session that holds only a cookie', () => {
  test('cannot be made, read, downloaded or moved by any route: the archive holds every key Hermes has', async () => {
    const owner = await start();
    // A cookie and nothing else: no passkey step-up on this session.
    const cookie = await ownerCookie(owner.url);
    const cookieOnly = async (method: string, route: string, body?: unknown) => {
      const res = await fetch(`${owner.url}${route}`, {
        method,
        headers: { origin: owner.url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, text: await res.text() };
    };
    fs.writeFileSync(path.join(hermes.home, '.env'), 'OPENROUTER_API_KEY=sk-or-secret-in-the-backup\n');

    const makeWithCookie = await cookieOnly('POST', '/api/ops/backup', {});
    const made = await owner.typed('POST', '/api/ops/backup', 'Hermes home', {});
    await owner.finish('backup');
    const archive: string = made.body.archive;
    const elsewhere = await owner.typed('POST', '/api/ops/backup', 'Hermes home', { output: path.join(os.tmpdir(), 'caduceus-elsewhere-backup.zip') });
    const query = `path=${encodeURIComponent(archive)}`;
    const reads = [
      `/api/files/download?${query}`,
      `/api/files/read?${query}`,
      `/api/files/stream?${query}`,
      `/api/fs/download?${query}`,
      `/api/fs/read-text?${query}`,
      `/api/fs/read-data-url?${query}`,
      `/api/media?${query}`,
      `/api/files?path=${encodeURIComponent(path.dirname(archive))}`,
      `/api/ops/backup/download?archive=${encodeURIComponent(archive)}`,
    ];
    const answers = await Promise.all(reads.map((route) => cookieOnly('GET', route)));
    const owned = await owner.call('GET', `/api/files/download?${query}`);
    const moved = await owner.call('POST', '/_caduceus/api/files/rename', { body: { path: archive, name: 'moved.zip' } });

    expect(makeWithCookie.status).toBe(403);
    expect(JSON.parse(makeWithCookie.text)).toMatchObject({ error: 'step-up-required', tier: 'T3' });
    expect(made.status).toBe(200);
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body).toMatchObject({ error: 'denied', reason: 'protected-path' });
    expect(fs.existsSync(path.join(os.tmpdir(), 'caduceus-elsewhere-backup.zip'))).toBe(false);
    expect(answers.map((answer) => answer.status)).toEqual(reads.map(() => 403));
    for (const answer of answers) expect(answer.text).not.toContain('PK');
    // The owner's own session has no way to the bytes through a browse route either: only the T3 download.
    expect(owned.status).toBe(403);
    expect(moved.status).toBe(403);
    expect(fs.existsSync(archive)).toBe(true);
  }, HERMES_WORK_TIMEOUT_MS);
});

describe('restoring a backup through Hermes', () => {
  test('from a server path drains first, lets Hermes import, restarts Hermes and then Caduceus itself, and Caduceus’s own directory comes back', async () => {
    const restarted = Promise.withResolvers<void>();
    const owner = await start({ restart: () => restarted.resolve() });
    await owner.call('POST', '/_caduceus/api/chat/prompts', { body: { name: 'Keep me', text: 'a saved prompt', tags: [], profile: null } });
    const made = await owner.typed('POST', '/api/ops/backup', 'Hermes home', {});
    await owner.finish('backup');
    // After the backup the store changes: the restore must bring back what the backup held, and no more.
    const [kept] = (await owner.call('GET', '/_caduceus/api/chat/prompts')).body.prompts;
    await owner.call('DELETE', `/_caduceus/api/chat/prompts/${kept.id}`);
    await owner.call('POST', '/_caduceus/api/chat/prompts', { body: { name: 'Made later', text: 'not in the backup', tags: [], profile: null } });
    const page = await connectBrowserSocket(owner.url, { cookie: owner.cookie });
    let launches = 0;
    const counted = () => void launches++;
    hermes.backend.on('ready', counted);

    const started = await owner.typed('POST', '/api/ops/import', 'restore', { archive: made.body.archive, force: true });

    expect(started.status).toBe(200);
    expect((await page.waitFor((frame) => frame.params?.type === 'caduceus.drain')).params.payload).toMatchObject({ active: true });
    expect(await owner.finish('import')).toEqual({ ok: true, exitCode: 0 });
    await restarted.promise;
    // Hermes was restarted for the restored home, and Caduceus is still draining: the process is about to go.
    hermes.backend.off('ready', counted);
    expect(launches).toBe(1);
    expect((await owner.call('GET', '/_caduceus/api/updates')).body.drain.active).toBe(true);
    await server?.close();
    server = undefined;
    const store = openCaduceusStore(hermes.home);
    const restored = (store.db.prepare('SELECT name FROM saved_prompts ORDER BY name').all() as { name: string }[]).map((row) => row.name);
    store.close();
    expect(restored).toEqual(['Keep me']);
  }, HERMES_WORK_TIMEOUT_MS);

  test('from an uploaded file does the same, and the saved prompts of the backup come back', async () => {
    const restarted = Promise.withResolvers<void>();
    const owner = await start({ restart: () => restarted.resolve() });
    await owner.call('POST', '/_caduceus/api/chat/prompts', { body: { name: 'Keep me', text: 'a saved prompt', tags: [], profile: null } });
    const made = await owner.typed('POST', '/api/ops/backup', 'Hermes home', {});
    await owner.finish('backup');
    const [kept] = (await owner.call('GET', '/_caduceus/api/chat/prompts')).body.prompts;
    await owner.call('DELETE', `/_caduceus/api/chat/prompts/${kept.id}`);

    const started = await owner.upload('/api/ops/import-upload', 'restore', made.body.archive);

    expect(started.status).toBe(200);
    expect(await owner.finish('import')).toEqual({ ok: true, exitCode: 0 });
    await restarted.promise;
    await server?.close();
    server = undefined;
    const store = openCaduceusStore(hermes.home);
    const restored = (store.db.prepare('SELECT name FROM saved_prompts').all() as { name: string }[]).map((row) => row.name);
    store.close();
    expect(restored).toEqual(['Keep me']);
  }, HERMES_WORK_TIMEOUT_MS);

  test('reports the exit code Hermes gave to a page that follows the import only after Hermes restarted (a restarted Hermes has forgotten it)', async () => {
    const restarted = Promise.withResolvers<void>();
    const owner = await start({ restart: () => restarted.resolve() });
    const made = await owner.typed('POST', '/api/ops/backup', 'Hermes home', {});
    await owner.finish('backup');

    await owner.typed('POST', '/api/ops/import', 'restore', { archive: made.body.archive, force: true });
    // Nobody follows the log while Caduceus waits for the import and restarts Hermes: the page opens it when Hermes is already new.
    await restarted.promise;

    expect(await owner.finish('import')).toEqual({ ok: true, exitCode: 0 });
  }, HERMES_WORK_TIMEOUT_MS);

  test('is audited as a T3 of the owner, and refused in read-only mode without draining or touching Hermes', async () => {
    const owner = await start({ restart: () => undefined });
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });

    const refused = await owner.typed('POST', '/api/ops/import', 'restore', { archive: '/nowhere.zip', force: true });

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'read-only', tier: 'T3' });
    expect((await owner.call('GET', '/_caduceus/api/updates')).body.drain.active).toBe(false);
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
    await owner.typed('POST', '/api/ops/import', 'restore', { archive: '/nowhere.zip', force: true });
    expect((await owner.call('GET', '/_caduceus/api/audit')).body.entries).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'POST /api/ops/import', tier: 'T3' }));
  });

  test('is refused when Caduceus cannot restart itself (it could not reopen its own store), before anything is drained or imported', async () => {
    const owner = await start();

    const refused = await owner.typed('POST', '/api/ops/import', 'restore', { archive: '/nowhere.zip', force: true });

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: 'unavailable' });
    expect((await owner.call('GET', '/_caduceus/api/updates')).body.drain.active).toBe(false);
  });

  test('that Hermes refuses (no such archive) ends the drain and restarts nothing', async () => {
    const restarted = vi.fn();
    const owner = await start({ restart: restarted });
    let launches = 0;
    const counted = () => void launches++;
    hermes.backend.on('ready', counted);

    const answer = await owner.typed('POST', '/api/ops/import', 'restore', { archive: path.join(hermes.home, 'no-such-backup.zip'), force: true });

    hermes.backend.off('ready', counted);
    expect(answer.status).toBe(404);
    expect((await owner.call('GET', '/_caduceus/api/updates')).body.drain.active).toBe(false);
    expect(launches).toBe(0);
    expect(restarted).not.toHaveBeenCalled();
  });
});

describe('the checkpoints Hermes keeps', () => {
  test('are counted by Hermes’s own listing, and pruning them is a T2 that runs Hermes’s prune to its end', async () => {
    const store = path.join(hermes.home, 'checkpoints', 'abc123');
    fs.mkdirSync(path.join(store, 'objects'), { recursive: true });
    fs.writeFileSync(path.join(store, 'HEAD'), 'ref: main');
    fs.writeFileSync(path.join(store, 'objects', 'one'), 'x'.repeat(10));
    const owner = await start();

    const listed = await owner.call('GET', '/api/ops/checkpoints');
    // Hermes asks before it deletes a checkpoint store whose folder it cannot find, and a spawned prune cannot be asked: the store it lists here is one of those, so it goes first.
    fs.rmSync(store, { recursive: true });
    const pruned = await owner.call('POST', '/api/ops/checkpoints/prune');
    const ended = await owner.finish('checkpoints-prune');

    expect(listed.body).toEqual({ sessions: [{ session: 'abc123', files: 2, bytes: 19 }], total_bytes: 19 });
    expect(pruned.status).toBe(200);
    expect(ended).toMatchObject({ ok: true });
    expect((await owner.call('GET', '/_caduceus/api/audit')).body.entries).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'POST /api/ops/checkpoints/prune', tier: 'T2' }));
  });
});
