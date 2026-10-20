import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Guarded file operations (R11, M7 #02): rename, move and the Office save, which the Caduceus server performs itself, in front of the real Hermes
// in a throwaway HERMES_HOME. The temp directories stand in for the managed root and the one known workspace.
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

interface Reply {
  error?: string;
  reason?: string;
  tier?: string;
  token?: string;
  message?: string;
  path?: string;
  from?: string;
  to?: string;
  bytes?: number;
  sha256?: string;
  current?: string;
  snapshots?: { id: number; bytes: number }[];
  entries?: { actor: string; action: string; target: string; source: string; tier?: string; profile?: string }[];
}
interface Answer {
  status: number;
  body: Reply;
}

function tempDir(name: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `caduceus-fileops-${name}-`)));
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
  /** The page's request for a T3: step-up, a confirmation with `typed`, the request. */
  const send = async (method: string, route: string, body: unknown, typed: string, headers: Record<string, string> = {}): Promise<Answer> => {
    await stepUp(url, cookie, authenticator);
    const minted = await call('POST', '/_caduceus/api/policy/confirmations', {
      operation: `${method} ${route}`,
      target: typed,
      typed,
      bodySha256: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    });
    return call(method, route, body, { ...headers, 'x-caduceus-confirmation': String(minted.body.token) });
  };
  const audit = async () => (await call('GET', '/_caduceus/api/audit')).body.entries ?? [];
  return { url, call, send, audit, stepUp: () => stepUp(url, cookie, authenticator) };
}

describe('rename', () => {
  test('is a T0 inside the roots: the file keeps its folder and takes the new name, and the answer names where it went so an undo can rename it back', async () => {
    const root = tempDir('root');
    fs.writeFileSync(path.join(root, 'draft.md'), 'words');
    const { call, audit } = await start(root, root);

    const renamed = await call('POST', '/_caduceus/api/files/rename', { path: path.join(root, 'draft.md'), name: 'final.md', profile: 'default' });

    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ from: path.join(root, 'draft.md'), to: path.join(root, 'final.md') });
    expect(fs.existsSync(path.join(root, 'draft.md'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'final.md'), 'utf8')).toBe('words');
    expect(await audit()).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'files.rename', target: `${path.join(root, 'draft.md')} → ${path.join(root, 'final.md')}`, tier: 'T0', profile: 'default' }));
  });
});

describe('move', () => {
  test('is a T1 that puts a file or a folder with its contents into another folder, and is audited with the source, the target and the profile', async () => {
    const root = tempDir('root');
    fs.mkdirSync(path.join(root, 'inbox', 'notes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'inbox', 'notes', 'a.txt'), 'a');
    fs.writeFileSync(path.join(root, 'inbox', 'b.txt'), 'b');
    fs.mkdirSync(path.join(root, 'archive'));
    const { call, audit } = await start(root, root);

    const file = await call('POST', '/_caduceus/api/files/move', { path: path.join(root, 'inbox', 'b.txt'), destination: path.join(root, 'archive'), profile: 'coder' });
    const folder = await call('POST', '/_caduceus/api/files/move', { path: path.join(root, 'inbox', 'notes'), destination: path.join(root, 'archive'), profile: 'coder' });

    expect(file).toMatchObject({ status: 200, body: { from: path.join(root, 'inbox', 'b.txt'), to: path.join(root, 'archive', 'b.txt') } });
    expect(folder.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'archive', 'b.txt'), 'utf8')).toBe('b');
    expect(fs.readFileSync(path.join(root, 'archive', 'notes', 'a.txt'), 'utf8')).toBe('a');
    expect(fs.readdirSync(path.join(root, 'inbox'))).toEqual([]);
    expect(await audit()).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'files.move', target: `${path.join(root, 'inbox', 'b.txt')} → ${path.join(root, 'archive', 'b.txt')}`, tier: 'T1', profile: 'coder' }));
  });
});

describe('a rename or a move outside every workspace', () => {
  test('is a T3 (a passkey, and the name typed) and audited as one; inside a workspace a rename stays a T0 and a move a T1, and a move out of one is a T3', async () => {
    const root = tempDir('root');
    const work = path.join(root, 'work');
    fs.mkdirSync(path.join(work, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dest'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    fs.writeFileSync(path.join(work, 'w.txt'), 'w');
    fs.writeFileSync(path.join(work, 'x.txt'), 'x');
    const { call, send, audit } = await start(root, work);
    const rename = { path: path.join(root, 'a.txt'), name: 'b.txt' };
    const move = { path: path.join(root, 'b.txt'), destination: path.join(root, 'dest') };
    const leaving = { path: path.join(work, 'x.txt'), destination: path.join(root, 'dest') };

    const cookieOnly = [await call('POST', '/_caduceus/api/files/rename', rename), await call('POST', '/_caduceus/api/files/move', { path: rename.path, destination: move.destination }), await call('POST', '/_caduceus/api/files/move', leaving)];
    const renamed = await send('POST', '/_caduceus/api/files/rename', rename, 'a.txt');
    const moved = await send('POST', '/_caduceus/api/files/move', move, 'b.txt');
    const movedOut = await send('POST', '/_caduceus/api/files/move', leaving, 'x.txt');
    const insideRename = await call('POST', '/_caduceus/api/files/rename', { path: path.join(work, 'w.txt'), name: 'v.txt' });
    const insideMove = await call('POST', '/_caduceus/api/files/move', { path: path.join(work, 'v.txt'), destination: path.join(work, 'sub') });

    expect(cookieOnly.map((answer) => [answer.status, answer.body.error, answer.body.tier])).toEqual(Array(3).fill([403, 'step-up-required', 'T3']));
    expect([renamed.status, moved.status, movedOut.status, insideRename.status, insideMove.status]).toEqual([200, 200, 200, 200, 200]);
    expect(fs.existsSync(path.join(root, 'dest', 'b.txt'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'dest', 'x.txt'))).toBe(true);
    expect(fs.existsSync(path.join(work, 'sub', 'v.txt'))).toBe(true);
    expect((await audit()).filter((entry) => entry.action.startsWith('files.')).map((entry) => [entry.action, entry.tier]).sort()).toEqual([
      ['files.move', 'T1'],
      ['files.move', 'T3'],
      ['files.move', 'T3'],
      ['files.rename', 'T0'],
      ['files.rename', 'T3'],
    ]);
  });
});

describe('what a rename or a move refuses', () => {
  test('a path outside the roots (by `..`, by a link out, or plainly), Hermes’s keys and Caduceus’s directory, as source and as the name or place it would take', async () => {
    const root = tempDir('root');
    const elsewhere = tempDir('elsewhere');
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    fs.mkdirSync(path.join(root, 'folder'));
    fs.writeFileSync(path.join(elsewhere, 'secret.txt'), 'not yours');
    fs.symlinkSync(elsewhere, path.join(root, 'shortcut'));
    fs.symlinkSync(path.join(root, 'a.txt'), path.join(root, 'inside-link'));
    fs.writeFileSync(path.join(hermes.home, 'auth.json'), '{}');
    const { call } = await start(root, root);
    const rename = (from: string, name: string) => call('POST', '/_caduceus/api/files/rename', { path: from, name });
    const move = (from: string, destination: string) => call('POST', '/_caduceus/api/files/move', { path: from, destination });
    const reasons = (answers: Answer[]) => answers.map((answer) => `${answer.status} ${answer.body.reason ?? answer.body.error}`);

    expect(
      reasons([
        await rename(path.join(elsewhere, 'secret.txt'), 'mine.txt'),
        await rename(`${root}/folder/../../${path.basename(elsewhere)}/secret.txt`, 'mine.txt'),
        await rename(path.join(root, 'shortcut', 'secret.txt'), 'mine.txt'),
        await rename(path.join(hermes.home, 'auth.json'), 'plain.json'),
        await rename(path.join(root, 'a.txt'), '.env'),
        await rename(path.join(root, 'a.txt'), 'auth.json'),
        await move(path.join(root, 'a.txt'), elsewhere),
        await move(path.join(root, 'a.txt'), path.join(root, 'shortcut')),
        await move(path.join(root, 'a.txt'), path.join(hermes.home, 'caduceus')),
        await move(path.join(hermes.home, 'caduceus'), path.join(root, 'folder')),
        await move(hermes.home, path.join(root, 'folder')),
        await move(root, path.join(root, 'folder')),
      ]),
    ).toEqual(['403 outside-roots', '403 outside-roots', '403 outside-roots', '403 protected-path', '403 protected-path', '403 protected-path', '403 outside-roots', '403 outside-roots', '403 protected-path', '403 protected-path', '403 protected-path', '403 protected-path']);
    expect(reasons([await rename(path.join(root, 'inside-link'), 'renamed-link')])).toEqual(['400 is-link']);
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(elsewhere, 'secret.txt'), 'utf8')).toBe('not yours');
    expect(fs.existsSync(path.join(elsewhere, 'a.txt'))).toBe(false);
    expect(fs.existsSync(path.join(hermes.home, 'caduceus'))).toBe(true);
  });

  test('a name that is taken is never overwritten, a folder never goes into itself, and a name is a name and not a path', async () => {
    const root = tempDir('root');
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    fs.writeFileSync(path.join(root, 'b.txt'), 'b');
    fs.mkdirSync(path.join(root, 'folder', 'inner'), { recursive: true });
    fs.mkdirSync(path.join(root, 'other'));
    fs.writeFileSync(path.join(root, 'other', 'a.txt'), 'already there');
    const { call } = await start(root, root);

    const taken = await call('POST', '/_caduceus/api/files/rename', { path: path.join(root, 'a.txt'), name: 'b.txt' });
    const takenMove = await call('POST', '/_caduceus/api/files/move', { path: path.join(root, 'a.txt'), destination: path.join(root, 'other') });
    const into = await call('POST', '/_caduceus/api/files/move', { path: path.join(root, 'folder'), destination: path.join(root, 'folder', 'inner') });
    const paths = await Promise.all(['sub/b.txt', '..', '', 'x\\y'].map((name) => call('POST', '/_caduceus/api/files/rename', { path: path.join(root, 'a.txt'), name })));

    expect([taken.status, taken.body.error, takenMove.status, takenMove.body.error, into.status, into.body.error]).toEqual([409, 'name-taken', 409, 'name-taken', 400, 'into-itself']);
    expect(paths.map((answer) => `${answer.status} ${answer.body.error}`)).toEqual(Array(4).fill('400 bad-name'));
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('a');
    expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe('b');
    expect(fs.readFileSync(path.join(root, 'other', 'a.txt'), 'utf8')).toBe('already there');
  });

  test('a rename can change only the case of a name', async () => {
    const root = tempDir('root');
    fs.writeFileSync(path.join(root, 'notes.md'), 'n');
    const { call } = await start(root, root);

    const renamed = await call('POST', '/_caduceus/api/files/rename', { path: path.join(root, 'notes.md'), name: 'Notes.md' });

    expect(renamed.status).toBe(200);
    expect(fs.readdirSync(root)).toEqual(['Notes.md']);
  });
});

describe('read-only mode', () => {
  test('blocks rename, move and the Office save alike', async () => {
    const root = tempDir('root');
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    fs.mkdirSync(path.join(root, 'folder'));
    const { call, stepUp: grant } = await start(root, root);
    await grant();
    await call('PUT', '/_caduceus/api/policy/read-only', { readOnly: true });

    const answers = await Promise.all([
      call('POST', '/_caduceus/api/files/rename', { path: path.join(root, 'a.txt'), name: 'b.txt' }),
      call('POST', '/_caduceus/api/files/move', { path: path.join(root, 'a.txt'), destination: path.join(root, 'folder') }),
    ]);

    expect(answers.map((answer) => answer.body.error)).toEqual(['read-only', 'read-only']);
    expect(fs.readdirSync(root).sort()).toEqual(['a.txt', 'folder']);
  });
});

/** A stand-in for an Office document: the save only needs bytes that start like a zip archive (every .docx, .xlsx and .pptx does). */
const office = (text: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(text)]);
const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
const saveBody = (file: string, bytes: Buffer, base: Buffer, profile = 'default') => ({ path: file, content: bytes.toString('base64'), base: sha256(base), profile });

describe('the Office save', () => {
  test('inside a known workspace it is a T1 that keeps the old bytes first, writes through Hermes’s upload, names the new bytes and is audited', async () => {
    const root = tempDir('root');
    const file = path.join(root, 'report.docx');
    const before = office('version one');
    const after = office('version two');
    fs.writeFileSync(file, before);
    const { call, audit } = await start(root, root);

    const saved = await call('PUT', '/_caduceus/api/files/office', saveBody(file, after, before, 'coder'));

    expect(saved).toMatchObject({ status: 200, body: { path: file, bytes: after.length, sha256: sha256(after) } });
    expect(fs.readFileSync(file).equals(after)).toBe(true);
    const kept = (await call('GET', `/_caduceus/api/files/office-snapshots?path=${encodeURIComponent(file)}`)).body.snapshots ?? [];
    expect(kept).toHaveLength(1);
    expect(kept[0].bytes).toBe(before.length);
    const restored = await fetch(`${server!.url}/_caduceus/api/files/office-snapshots/${kept[0].id}`, { headers: { cookie: await ownerCookie(server!.url) } });
    expect(Buffer.from(await restored.arrayBuffer()).equals(before)).toBe(true);
    expect(await audit()).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'files.office-save', target: file, tier: 'T1', profile: 'coder' }));
    // Hermes's upload wrote it in place, with no half-written copy left beside it.
    expect(fs.readdirSync(root)).toEqual(['report.docx']);
  });

  test('a save made from a copy that is no longer the file is refused and writes nothing', async () => {
    const root = tempDir('root');
    const file = path.join(root, 'report.docx');
    const opened = office('opened');
    fs.writeFileSync(file, office('changed by someone else'));
    const { call } = await start(root, root);

    const stale = await call('PUT', '/_caduceus/api/files/office', saveBody(file, office('mine'), opened));

    expect(stale).toMatchObject({ status: 409, body: { error: 'conflict' } });
    expect(fs.readFileSync(file).equals(office('changed by someone else'))).toBe(true);
  });
});

describe('the Office save outside a known workspace, and what it refuses', () => {
  test('is a T3 in a protected area (typed confirmation), and a stale copy, a non-Office name, a non-archive, Hermes’s keys and anything outside the roots are refused before anyone is asked', async () => {
    const root = tempDir('root');
    const outside = tempDir('outside');
    const file = path.join(root, 'plan.pptx');
    const before = office('old');
    fs.writeFileSync(file, before);
    fs.writeFileSync(path.join(root, 'notes.txt'), 'text');
    fs.writeFileSync(path.join(outside, 'x.docx'), before);
    const { call, send } = await start(root);
    const body = saveBody(file, office('new'), before);

    const unconfirmed = await call('PUT', '/_caduceus/api/files/office', body);
    expect(unconfirmed.body).toMatchObject({ tier: 'T3' });
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    const refusals = [
      await call('PUT', '/_caduceus/api/files/office', saveBody(path.join(root, 'notes.txt'), office('x'), before)),
      await call('PUT', '/_caduceus/api/files/office', { ...body, content: Buffer.from('plain text').toString('base64') }),
      await call('PUT', '/_caduceus/api/files/office', saveBody(path.join(outside, 'x.docx'), office('x'), before)),
      await call('PUT', '/_caduceus/api/files/office', saveBody(path.join(hermes.home, 'caduceus', 'x.docx'), office('x'), before)),
      await call('PUT', '/_caduceus/api/files/office', saveBody(path.join(root, 'missing.docx'), office('x'), before)),
      await call('PUT', '/_caduceus/api/files/office', saveBody(file, office('new'), office('something else'))),
    ];
    expect(refusals.map((answer) => `${answer.status} ${answer.body.reason ?? answer.body.error}`)).toEqual(['400 not-office', '400 not-office', '403 outside-roots', '403 protected-path', '404 not-found', '409 conflict']);

    const saved = await send('PUT', '/_caduceus/api/files/office', body, 'plan.pptx');
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(file).equals(office('new'))).toBe(true);
    expect(fs.readFileSync(path.join(outside, 'x.docx')).equals(before)).toBe(true);
  });

  test('read-only mode blocks it', async () => {
    const root = tempDir('root');
    const file = path.join(root, 'plan.docx');
    fs.writeFileSync(file, office('old'));
    const { call, stepUp: grant } = await start(root, root);
    await grant();
    await call('PUT', '/_caduceus/api/policy/read-only', { readOnly: true });

    const refused = await call('PUT', '/_caduceus/api/files/office', saveBody(file, office('new'), office('old')));

    expect(refused.body.error).toBe('read-only');
    expect(fs.readFileSync(file).equals(office('old'))).toBe(true);
  });
});
