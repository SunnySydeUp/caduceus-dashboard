import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The script editor's file guard (M3 #12), in front of the real Hermes in a throwaway HERMES_HOME. Hermes runs a cron script only from its profile's
// `scripts/` folder, and its own file endpoint writes anywhere; the Caduceus route that saves a script writes only there, through Hermes's endpoint, and
// refuses every way out of the folder: a name that is a path, a link in the folder, a folder that is a link.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const outside: string[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  await hermes.cli('profile', 'create', 'coder');
}, 90_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  for (const folder of outside.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
  fs.rmSync(path.join(hermes.home, 'profiles', 'coder', 'scripts'), { recursive: true, force: true });
});

const SAVE = 'PUT /_caduceus/api/work/scripts';
const scriptsOf = (profile: string) => path.join(hermes.home, 'profiles', profile, 'scripts');

async function owner() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  const url = server.url;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  const call = async (method: string, route: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: (text.startsWith('{') ? JSON.parse(text) : text) as Record<string, unknown> };
  };
  /** The page's save: the step-up, a confirmation in which the script's name is typed, and the request. */
  const save = async (body: Record<string, unknown>, typed = String(body.name)) => {
    await stepUp(url, cookie, authenticator);
    const raw = JSON.stringify(body);
    const minted = await call('POST', '/_caduceus/api/policy/confirmations', { operation: SAVE, target: typed, typed, bodySha256: crypto.createHash('sha256').update(raw).digest('hex') });
    return call('PUT', '/_caduceus/api/work/scripts', body, { 'x-caduceus-confirmation': String(minted.body.token) });
  };
  return { url, cookie, call, save, stepUp: () => stepUp(url, cookie, authenticator) };
}

describe('saving a script', () => {
  test('writes it into the profile’s scripts folder (made if it is not there) through Hermes, as a T3 with an audit entry, and Hermes reads it back', async () => {
    const { save, call } = await owner();
    expect(fs.existsSync(scriptsOf('coder'))).toBe(false);

    const saved = await save({ profile: 'coder', name: 'backup.sh', content: 'echo "backing up"\n' });

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ name: 'backup.sh', path: path.join(fs.realpathSync(scriptsOf('coder')), 'backup.sh') });
    expect(fs.readFileSync(path.join(scriptsOf('coder'), 'backup.sh'), 'utf8')).toBe('echo "backing up"\n');
    const read = await call('GET', `/api/fs/read-text?path=${encodeURIComponent(String(saved.body.path))}`);
    expect(read.body).toMatchObject({ text: 'echo "backing up"\n' });
    const audit = (await call('GET', '/_caduceus/api/audit')).body as unknown as { entries: { action: string; tier: string; target: string; profile?: string }[] };
    expect(audit.entries).toContainEqual(expect.objectContaining({ action: SAVE, tier: 'T3', profile: 'coder' }));
  });

  test('saving again replaces the file, and a script of the default profile goes in the root home’s folder', async () => {
    const { save } = await owner();
    await save({ profile: 'coder', name: 'a.py', content: 'print(1)\n' });
    await save({ profile: 'coder', name: 'a.py', content: 'print(2)\n' });
    expect(fs.readFileSync(path.join(scriptsOf('coder'), 'a.py'), 'utf8')).toBe('print(2)\n');

    expect((await save({ profile: 'default', name: 'root.sh', content: 'true\n' })).status).toBe(200);
    expect(fs.readFileSync(path.join(hermes.home, 'scripts', 'root.sh'), 'utf8')).toBe('true\n');
    fs.rmSync(path.join(hermes.home, 'scripts'), { recursive: true, force: true });
  });

  test('is a T3: without a step-up, or without the typed confirmation, nothing is written', async () => {
    const { call } = await owner();
    const body = { profile: 'coder', name: 'nope.sh', content: 'true\n' };

    expect(await call('PUT', '/_caduceus/api/work/scripts', body)).toMatchObject({ status: 403, body: { error: 'step-up-required', tier: 'T3' } });
    expect(fs.existsSync(path.join(scriptsOf('coder'), 'nope.sh'))).toBe(false);
  });

  test('without the confirmation the owner typed, a stepped-up request is refused too', async () => {
    const { call, stepUp: confirmIdentity } = await owner();
    await confirmIdentity();

    const answer = await call('PUT', '/_caduceus/api/work/scripts', { profile: 'coder', name: 'nope.sh', content: 'true\n' });

    expect(answer.status).toBe(403);
    expect(answer.body.error).toBe('confirmation-required');
    expect(fs.existsSync(path.join(scriptsOf('coder'), 'nope.sh'))).toBe(false);
  });
});

describe('the file guard', () => {
  test.each([
    ['a path out of the folder', '../escape.sh'],
    ['a deeper path', 'sub/escape.sh'],
    ['an absolute path', '/tmp/escape.sh'],
    ['a name with a backslash', 'sub\\escape.sh'],
    ['a hidden name', '.escape.sh'],
    ['the folder itself', '..'],
    ['a name that is nothing', ''],
    ['a name with a NUL byte', 'a\0b.sh'],
    ['a name of 300 characters', `${'a'.repeat(300)}.sh`],
    ['a name with a space', 'two words.sh'],
  ])('refuses %s', async (_label, name) => {
    const { save } = await owner();

    const answer = await save({ profile: 'coder', name, content: 'true\n' }, name || 'x');

    expect(answer.status).toBe(400);
    expect(answer.body.error).toBe('bad-script-name');
    expect(fs.existsSync(path.join(hermes.home, 'profiles', 'coder', 'escape.sh'))).toBe(false);
    expect(fs.existsSync('/tmp/escape.sh')).toBe(false);
  });

  test('refuses a name that is a link in the folder, and leaves what the link points at untouched', async () => {
    const { save } = await owner();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-script-outside-'));
    outside.push(target);
    fs.writeFileSync(path.join(target, 'secret.sh'), 'original\n');
    fs.mkdirSync(scriptsOf('coder'), { recursive: true });
    fs.symlinkSync(path.join(target, 'secret.sh'), path.join(scriptsOf('coder'), 'link.sh'));

    const answer = await save({ profile: 'coder', name: 'link.sh', content: 'overwritten\n' });

    expect(answer.status).toBe(403);
    expect(answer.body.error).toBe('outside-scripts');
    expect(fs.readFileSync(path.join(target, 'secret.sh'), 'utf8')).toBe('original\n');
  });

  test('refuses when the scripts folder is itself a link out of the profile', async () => {
    const { save } = await owner();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-script-outside-'));
    outside.push(target);
    fs.mkdirSync(path.join(hermes.home, 'profiles', 'coder'), { recursive: true });
    fs.symlinkSync(target, scriptsOf('coder'));

    const answer = await save({ profile: 'coder', name: 'planted.sh', content: 'true\n' });

    expect(answer.status).toBe(403);
    expect(answer.body.error).toBe('outside-scripts');
    expect(fs.readdirSync(target)).toEqual([]);
    fs.rmSync(scriptsOf('coder'), { force: true });
  });

  test('refuses a profile Hermes does not have, a body that is not a script, and a script past the size limit', async () => {
    const { save } = await owner();

    expect((await save({ profile: 'ghost', name: 'a.sh', content: 'true\n' })).status).toBe(404);
    expect((await save({ profile: 'coder', name: 'a.sh' })).status).toBe(400);
    expect((await save({ profile: 'coder', name: 'a.sh', content: 7 })).status).toBe(400);
    expect((await save({ profile: 'coder', name: 'a.sh', content: 'x'.repeat(300_000) })).status).toBe(413);
    expect(fs.existsSync(path.join(scriptsOf('coder'), 'a.sh'))).toBe(false);
  });
});
