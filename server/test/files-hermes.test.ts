import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Workspace › Files (M7 #01) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The folder the test browses
// is a temp directory standing in for the managed root, and the one workspace Caduceus knows.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const temp: string[] = [];
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
  for (const folder of temp.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

/** What the routes under test answer with, as far as the tests read it. */
interface Reply {
  error?: string;
  reason?: string;
  tier?: string;
  token?: string;
  message?: string;
  current?: string;
  text?: string;
  ok?: boolean;
  entries: { name: string; path: string; is_directory: boolean; size: number | null }[];
  snapshots: { id: number; bytes: number }[];
}
interface Answer {
  status: number;
  body: Reply;
}

function tempDir(name: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `caduceus-files-${name}-`)));
  temp.push(dir);
  return dir;
}

/** A Caduceus server whose managed root is `root` (and, when given, whose one known workspace is `workspace`). */
async function start(root: string, workspace?: string) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, fileRoots: [root], workspaceRoots: workspace ? () => [workspace] : undefined });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  const call = async (method: string, route: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : { message: text }) as Reply };
  };
  /** The page's request for a T3: step-up, a confirmation with `typed`, the request. Without `typed`, a T1/T0 goes as it is. */
  const send = async (method: string, route: string, body: unknown, typed?: string, headers: Record<string, string> = {}): Promise<Answer> => {
    if (typed === undefined) return call(method, route, body, headers);
    await stepUp(url, cookie, authenticator);
    const minted = await call('POST', '/_caduceus/api/policy/confirmations', {
      operation: `${method} ${route}`,
      target: typed,
      typed,
      bodySha256: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    });
    return call(method, route, body, { ...headers, 'x-caduceus-confirmation': String(minted.body.token) });
  };
  return { url, call, send, stepUp: () => stepUp(url, cookie, authenticator) };
}

const listing = (folder: string) => `/api/files?path=${encodeURIComponent(folder)}`;

describe('browsing', () => {
  test('lists the managed root with name, size and time, and refuses a folder outside it, a `..` out of it and a link that leads out of it', async () => {
    const root = tempDir('root');
    const elsewhere = tempDir('elsewhere');
    fs.writeFileSync(path.join(root, 'notes.md'), '# Notes\n');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(elsewhere, 'secret.txt'), 'not for the page');
    fs.symlinkSync(elsewhere, path.join(root, 'shortcut'));
    const { call } = await start(root);

    const listed = await call('GET', listing(root));
    expect(listed.status).toBe(200);
    expect(listed.body.entries.map((entry) => entry.name)).toEqual(['shortcut', 'src', 'notes.md']);
    expect(listed.body.entries.find((entry) => entry.name === 'notes.md')).toMatchObject({ is_directory: false, size: 8 });

    const outside = await call('GET', listing(elsewhere));
    const traversal = await call('GET', listing(`${root}/src/../../${path.basename(elsewhere)}`));
    const throughLink = await call('GET', listing(path.join(root, 'shortcut')));
    const fileThroughLink = await call('GET', `/api/files/read?path=${encodeURIComponent(path.join(root, 'shortcut', 'secret.txt'))}`);
    for (const refused of [outside, traversal, throughLink, fileThroughLink]) {
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ error: 'denied', reason: 'outside-roots' });
    }
  });
});

const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const BASE = 'x-caduceus-base-sha256';
const write = (file: string, content: string, base?: string) => ({ path: file, content, ...(base ? { base } : {}) });
const snapshotsOf = async (call: (m: string, r: string) => Promise<Answer>, file: string) => (await call('GET', `/_caduceus/api/file-snapshots?kind=file&path=${encodeURIComponent(file)}`)).body.snapshots;

describe('editing a text file', () => {
  test('a save inside the known workspace is a T1 that keeps the old text first, and one made from a stale copy is refused with the text now on disk', async () => {
    const root = tempDir('root');
    const file = path.join(root, 'notes.md');
    fs.writeFileSync(file, 'one\n');
    const { call } = await start(root, root);

    const saved = await call('POST', '/api/fs/write-text', { path: file, content: 'two\n' }, { [BASE]: sha('one\n') });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(file, 'utf8')).toBe('two\n');
    const kept = await snapshotsOf(call, file);
    expect(kept).toHaveLength(1);
    expect((await call('GET', `/_caduceus/api/file-snapshots/${kept[0].id}`)).body.text).toBe('one\n');

    // Someone else changed the file after this copy was opened.
    fs.writeFileSync(file, 'three\n');
    const stale = await call('POST', '/api/fs/write-text', { path: file, content: 'four\n' }, { [BASE]: sha('two\n') });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'conflict', current: 'three\n' });
    expect(fs.readFileSync(file, 'utf8')).toBe('three\n');

    const audit = await call('GET', '/_caduceus/api/audit');
    expect(JSON.stringify(audit.body)).toContain('POST /api/fs/write-text');
  });

  test('a save elsewhere inside the roots (a protected area such as the profile home) needs the typed confirmation, and Hermes’s `.env`, `auth.json`, `caduceus/` and anything outside the roots are refused', async () => {
    const root = tempDir('root');
    const outside = tempDir('outside');
    const file = path.join(root, 'notes.md');
    fs.writeFileSync(file, 'one\n');
    fs.writeFileSync(path.join(hermes.home, 'config-note.txt'), 'x');
    const { call, send } = await start(root);
    const body = write(file, 'two\n');

    const unconfirmed = await call('POST', '/api/fs/write-text', body);
    expect(unconfirmed.body).toMatchObject({ tier: 'T3' });
    expect(fs.readFileSync(file, 'utf8')).toBe('one\n');
    expect((await send('POST', '/api/fs/write-text', body, 'notes.md')).status).toBe(200);
    expect(fs.readFileSync(file, 'utf8')).toBe('two\n');

    const refusals = await Promise.all(
      [path.join(hermes.home, '.env'), path.join(hermes.home, 'auth.json'), path.join(hermes.home, 'caduceus', 'x'), path.join(outside, 'x.txt'), path.join(root, '.env')].map((target) => call('POST', '/api/fs/write-text', write(target, 'x'))),
    );
    expect(refusals.map((refused) => refused.body.reason)).toEqual(['protected-path', 'protected-path', 'protected-path', 'outside-roots', 'protected-path']);
    expect(fs.existsSync(path.join(outside, 'x.txt'))).toBe(false);
  });

  test('read-only mode blocks a protected-area save and a workspace save alike', async () => {
    const root = tempDir('root');
    const file = path.join(root, 'notes.md');
    fs.writeFileSync(file, 'one\n');
    const { call, stepUp: grant } = await start(root, root);
    await grant();
    await call('PUT', '/_caduceus/api/policy/read-only', { readOnly: true });

    const refused = await call('POST', '/api/fs/write-text', write(file, 'two\n'));

    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('read-only');
    expect(fs.readFileSync(file, 'utf8')).toBe('one\n');
    expect((await call('GET', listing(root))).status).toBe(200);
  });
});

describe('upload, new folder, download and delete', () => {
  test('work through Hermes, are T1 and audited, and delete is refused outside the roots (a whole folder at once is a T3)', async () => {
    const root = tempDir('root');
    const outside = tempDir('outside');
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    const { call } = await start(root, root);
    const dataUrl = `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`;

    expect((await call('POST', '/api/files/mkdir', { path: path.join(root, 'docs') })).status).toBe(200);
    const upload = await call('POST', '/api/files/upload', { path: path.join(root, 'docs', 'a.txt'), data_url: dataUrl, overwrite: false });
    expect(upload.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'docs', 'a.txt'), 'utf8')).toBe('hello');
    const download = await fetch(`${server!.url}/api/files/download?path=${encodeURIComponent(path.join(root, 'docs', 'a.txt'))}`, { headers: { cookie: await ownerCookie(server!.url) } });
    expect(await download.text()).toBe('hello');
    expect(download.headers.get('content-disposition')).toContain('attachment');

    const refused = await call('DELETE', '/api/files', { path: path.join(outside, 'keep.txt') });
    expect(refused.body.reason).toBe('outside-roots');
    expect(fs.existsSync(path.join(outside, 'keep.txt'))).toBe(true);
    // A folder with everything in it is a T3; a file, and then the empty folder, are T1.
    expect((await call('DELETE', '/api/files', { path: path.join(root, 'docs'), recursive: true })).body).toMatchObject({ tier: 'T3' });
    expect((await call('DELETE', '/api/files', { path: path.join(root, 'docs', 'a.txt') })).body).toMatchObject({ ok: true });
    expect((await call('DELETE', '/api/files', { path: path.join(root, 'docs') })).body).toMatchObject({ ok: true });
    expect(fs.existsSync(path.join(root, 'docs'))).toBe(false);

    const audit = JSON.stringify((await call('GET', '/_caduceus/api/audit')).body);
    for (const action of ['POST /api/files/mkdir', 'POST /api/files/upload', 'DELETE /api/files']) expect(audit).toContain(action);
  });
});
