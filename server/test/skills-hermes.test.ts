import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { checkSkill, joinSkill, newSkillText, splitSkill } from '../../web/src/modules/skills/skill-document.ts';
import { actionPath, contentPath, createRequest, deleteRequest, filePath, folderPath, linkedFiles, listPath, parseFolder, parseSkills, readActionOutcome, readContent, readDeleteAnswer, readFile, removalOf, saveRequest, toggleRequest, uninstallRequest, type SkillRow } from '../../web/src/modules/skills/skills-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Agents › Skills › Installed (M4 #04) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME with a
// second profile. The page's own reading and request code (`web/src/modules/skills/`) is run over what Hermes really answers.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  const created = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'coder' }) });
  if (!created.ok) throw new Error(`Creating coder: HTTP ${created.status}`);
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

interface Owner {
  url: string;
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T }>;
  /** The typed confirmation of a T3 request, as the tiered dialog makes it: its token. */
  confirm(operation: string, target: string, body?: unknown): Promise<string>;
}

async function start(): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  await stepUp(url, cookie, authenticator);
  const call: Owner['call'] = async (method, route, { body, headers } = {}) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as never };
  };
  const confirm: Owner['confirm'] = async (operation, target, body) => {
    const bodySha256 = body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation, target, typed: target, ...(bodySha256 ? { bodySha256 } : {}) } });
    return minted.body.token;
  };
  return { url, call, confirm };
}

/** A skill in a profile, made through Hermes's own create endpoint (the one the page uses). */
async function seedSkill(profile: string, name: string, category: string | undefined, content: string): Promise<void> {
  const res = await hermes.backend.fetch('/api/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, category, content, profile }) });
  if (!res.ok) throw new Error(`Seeding ${name}: HTTP ${res.status} ${await res.text()}`);
}

const skillText = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSteps go here.\n`;

describe('the installed list', () => {
  test('is Hermes\'s skills for the scoped profile, with category, enabled state, usage count and where each came from', async () => {
    await seedSkill('coder', 'release-notes', 'writing', skillText('release-notes', 'Draft release notes from merged pull requests.'));
    const owner = await start();

    const coder = parseSkills((await owner.call('GET', listPath('coder'))).body);
    expect(coder.find((skill) => skill.name === 'release-notes')).toEqual({
      name: 'release-notes',
      description: 'Draft release notes from merged pull requests.',
      category: 'writing',
      enabled: true,
      usage: 0,
      provenance: 'agent',
    });
    // Hermes's own bundled skills are listed too, and say so.
    expect(coder.find((skill) => skill.provenance === 'bundled')).toBeDefined();
    // Another profile has its own skills: it does not have this one.
    expect(parseSkills((await owner.call('GET', listPath('default'))).body).map((skill) => skill.name)).not.toContain('release-notes');
  });
});

describe('the enabled switch', () => {
  const stateOf = async (owner: Owner, profile: string, name: string) => parseSkills((await owner.call('GET', listPath(profile))).body).find((skill) => skill.name === name)!.enabled;

  test('is Tier 0: it needs no confirmation, Hermes keeps the state for the one profile, and switching it back is the undo', async () => {
    await seedSkill('coder', 'switchable', undefined, skillText('switchable', 'Something to turn off.'));
    await seedSkill('default', 'switchable', undefined, skillText('switchable', 'Something to turn off.'));
    const owner = await start();
    expect(await stateOf(owner, 'coder', 'switchable')).toBe(true);

    const off = toggleRequest('coder', 'switchable', false);
    expect((await owner.call(off.method, off.path, { body: off.body })).status).toBe(200);
    expect(await stateOf(owner, 'coder', 'switchable')).toBe(false);
    expect(await stateOf(owner, 'default', 'switchable')).toBe(true);
    // Hermes keeps it in the profile's own config, where the command line reads it.
    expect(fs.readFileSync(path.join(hermes.home, 'profiles', 'coder', 'config.yaml'), 'utf8')).toContain('switchable');

    const on = toggleRequest('coder', 'switchable', true);
    expect((await owner.call(on.method, on.path, { body: on.body })).status).toBe(200);
    expect(await stateOf(owner, 'coder', 'switchable')).toBe(true);
  });

  test('is blocked in read-only mode before Hermes is asked', async () => {
    const owner = await start();
    expect((await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } })).status).toBe(200);
    const off = toggleRequest('coder', 'switchable', false);
    const refused = await owner.call<PolicyRefusal>(off.method, off.path, { body: off.body });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('read-only');
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
    expect(await stateOf(owner, 'coder', 'switchable')).toBe(true);
  });
});

describe('a skill\'s detail', () => {
  const skillDirOf = (name: string) => path.join(hermes.home, 'profiles', 'coder', 'skills', 'tools', name);

  test('is its SKILL.md text and the files linked from it: found in its folder through Hermes, listed by their place in it, opened as text, never written', async () => {
    await seedSkill('coder', 'with-files', 'tools', skillText('with-files', 'A skill with supporting files.'));
    // What an agent's `skill_manage write_file` leaves beside SKILL.md: references, templates, scripts and assets.
    for (const [file, content] of [['references/api.md', '# API\n\nCalls.\n'], ['references/deep/notes.txt', 'deep notes'], ['scripts/run.sh', '#!/bin/sh\necho hi\n'], ['assets/logo.bin', Buffer.from([0, 1, 2, 0, 255])]] as const) {
      fs.mkdirSync(path.dirname(path.join(skillDirOf('with-files'), file)), { recursive: true });
      fs.writeFileSync(path.join(skillDirOf('with-files'), file), content);
    }
    const owner = await start();

    const detail = readContent((await owner.call('GET', contentPath('coder', 'with-files'))).body)!;
    expect(detail.content).toBe(skillText('with-files', 'A skill with supporting files.'));
    expect(detail.folder).toBe(skillDirOf('with-files'));

    const list = async (folder: string) => parseFolder((await owner.call('GET', folderPath(folder))).body);
    const files = await linkedFiles(detail.folder, list);
    expect(files.map((file) => file.name)).toEqual(['assets/logo.bin', 'references/api.md', 'references/deep/notes.txt', 'scripts/run.sh']);

    const api = readFile((await owner.call('GET', filePath(files[1].path))).body)!;
    expect(api).toEqual({ text: '# API\n\nCalls.\n', binary: false, truncated: false, size: 14 });
    expect(readFile((await owner.call('GET', filePath(files[0].path))).body)).toMatchObject({ binary: true, size: 5 });
    // Nothing in the page's reading code asks Hermes to write: the route is a Tier 3 one, which an unconfirmed request does not pass.
    const write = await owner.call<PolicyRefusal>('POST', '/api/fs/write-text', { body: { path: files[1].path, content: 'changed' } });
    expect(write.status).toBe(403);
    expect(fs.readFileSync(files[1].path, 'utf8')).toBe('# API\n\nCalls.\n');
  });

  test('a skill that is not there has no detail', async () => {
    const owner = await start();
    const missing = await owner.call('GET', contentPath('coder', 'no-such-skill'));
    expect(missing.status).toBe(404);
    expect(readContent(missing.body)).toBeUndefined();
  });
});

describe('creating and editing SKILL.md', () => {
  // Frontmatter keys the page knows nothing about, in the order and the style of their author: a comment, a nested block, a folded value.
  const extra = `zeta: 1   # kept as written\nversion: 2.1.0\nmetadata:\n  hermes:\n    tags: [writing, git]\nalpha: >-\n  folded text\n  over two lines`;
  const diskText = (category: string, name: string) => fs.readFileSync(path.join(hermes.home, 'profiles', 'coder', 'skills', category, name, 'SKILL.md'), 'utf8');

  test('a new skill is written by Hermes with the text the page composed, and reads back the same: no key lost, none reordered, nothing re-quoted', async () => {
    const owner = await start();
    const text = await newSkillText({ name: 'roundtrip', description: 'Round trip: keeps keys.', extra, body: '# Round trip\n\nStep one.\n' });
    const create = createRequest('coder', { name: 'roundtrip', category: 'mine', content: text });
    expect((await owner.call(create.method, create.path, { body: create.body })).status).toBe(200);

    expect(diskText('mine', 'roundtrip')).toBe(text);
    expect(readContent((await owner.call('GET', contentPath('coder', 'roundtrip'))).body)!.content).toBe(text);
    expect(parseSkills((await owner.call('GET', listPath('coder'))).body).find((skill) => skill.name === 'roundtrip')).toMatchObject({ category: 'mine', description: 'Round trip: keeps keys.' });
  });

  test('editing the body and saving leaves the frontmatter byte for byte as it was; editing the frontmatter leaves the body', async () => {
    const owner = await start();
    const before = readContent((await owner.call('GET', contentPath('coder', 'roundtrip'))).body)!.content;
    const parts = splitSkill(before)!;

    const body = saveRequest('coder', 'roundtrip', joinSkill({ ...parts, body: '\n# Round trip\n\nStep one, then step two.\n' }));
    expect((await owner.call(body.method, body.path, { body: body.body })).status).toBe(200);
    const afterBody = diskText('mine', 'roundtrip');
    expect(splitSkill(afterBody)).toMatchObject({ frontmatter: parts.frontmatter, body: '\n# Round trip\n\nStep one, then step two.\n' });
    expect(afterBody.slice(0, afterBody.indexOf('\n# Round trip'))).toBe(before.slice(0, before.indexOf('\n# Round trip')));

    const front = saveRequest('coder', 'roundtrip', joinSkill({ ...splitSkill(afterBody)!, frontmatter: parts.frontmatter.replace('version: 2.1.0', 'version: 2.2.0') }));
    expect((await owner.call(front.method, front.path, { body: front.body })).status).toBe(200);
    expect(diskText('mine', 'roundtrip')).toBe(afterBody.replace('version: 2.1.0', 'version: 2.2.0'));
  });

  test('a text with frontmatter that is not valid is stopped by the page with the reason, and Hermes refuses the same text in the same words', async () => {
    const owner = await start();
    for (const bad of ['# no frontmatter\n', '---\nname: roundtrip\n---\nBody\n', '---\nname: roundtrip\ndescription: [broken\n---\nBody\n']) {
      const reason = (await checkSkill(bad, { isNew: false }))!;
      expect(reason).toBeDefined();
      const save = saveRequest('coder', 'roundtrip', bad);
      const refused = await owner.call<{ detail: string }>(save.method, save.path, { body: save.body });
      expect(refused.status).toBe(400);
      // The wording of a YAML error is the YAML library's own; everything else is Hermes's words.
      expect(refused.body.detail.split(':')[0]).toBe(reason.split(':')[0]);
    }
    expect(diskText('mine', 'roundtrip')).toContain('version: 2.2.0');
  });

  test('a name that is already taken is refused by Hermes with its reason', async () => {
    const owner = await start();
    const create = createRequest('coder', { name: 'roundtrip', category: '', content: skillText('roundtrip', 'Again.') });
    const refused = await owner.call<{ detail: string }>(create.method, create.path, { body: create.body });
    expect(refused.status).toBe(400);
    expect(refused.body.detail).toContain('already exists');
  });
});

describe('uninstalling and deleting', () => {
  const skillsDir = (profile: string) => path.join(hermes.home, 'profiles', profile, 'skills');
  /** The state of an action Hermes started in the background: it ran `hermes skills uninstall`, a process of its own, so only the operating system says when it is done. */
  const finished = async (owner: Owner, name: string) => {
    for (let tries = 0; tries < 100; tries++) {
      const status = (await owner.call<{ running: boolean; exit_code: number | null; lines: string[] }>('GET', actionPath(name))).body;
      const outcome = readActionOutcome(status);
      if (outcome.kind !== 'running') return outcome;
      // A bounded poll of a child process of Hermes: there is no event to wait on for it.
      await sleep(100);
    }
    throw new Error('Hermes\'s uninstall did not finish');
  };

  /** A skill installed from the hub, as Hermes records one: its folder and its entry in the hub's lock file. `hermes skills install` needs the network; this is what it leaves. */
  function seedHubSkill(profile: string, name: string) {
    const folder = path.join(skillsDir(profile), 'hub-made', name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'SKILL.md'), skillText(name, 'Installed from the hub.'));
    const lock = path.join(skillsDir(profile), '.hub', 'lock.json');
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const data = fs.existsSync(lock) ? JSON.parse(fs.readFileSync(lock, 'utf8')) : { version: 1, installed: {} };
    data.installed[name] = { source: 'official', identifier: `official/${name}`, trust_level: 'builtin', scan_verdict: 'safe', content_hash: 'x', install_path: `hub-made/${name}`, files: ['SKILL.md'], metadata: {}, scan_provenance: {}, installed_at: '2026-10-01T00:00:00+00:00', updated_at: '2026-10-01T00:00:00+00:00' };
    fs.writeFileSync(lock, JSON.stringify(data));
  }

  test('what can be removed depends on where the skill came from: a hub skill is uninstalled, a local one deleted, a bundled one only switched off', () => {
    const skill = (provenance: SkillRow['provenance']): SkillRow => ({ name: 'x', description: '', category: '', enabled: true, usage: 0, provenance });
    expect(removalOf(skill('hub'))).toBe('uninstall');
    expect(removalOf(skill('agent'))).toBe('delete');
    expect(removalOf(skill('bundled'))).toBe('none');
  });

  test('uninstalling a hub skill is Tier 1: Hermes runs its own uninstall for the profile, and the skill and its hub record are gone afterwards', async () => {
    seedHubSkill('coder', 'from-hub');
    const owner = await start();
    expect(parseSkills((await owner.call('GET', listPath('coder'))).body).find((skill) => skill.name === 'from-hub')?.provenance).toBe('hub');

    const request = uninstallRequest('coder', 'from-hub');
    const started = await owner.call<{ ok: boolean; name: string }>(request.method, request.path, { body: request.body });
    expect(started.status).toBe(200);
    expect(await finished(owner, started.body.name)).toEqual({ kind: 'done' });

    expect(parseSkills((await owner.call('GET', listPath('coder'))).body).map((skill) => skill.name)).not.toContain('from-hub');
    expect(fs.existsSync(path.join(skillsDir('coder'), 'hub-made', 'from-hub'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(skillsDir('coder'), '.hub', 'lock.json'), 'utf8')).installed).not.toHaveProperty('from-hub');
  });

  test('deleting a local skill is Tier 1 too: Hermes archives it (it can be restored from the command line), and it leaves the list', async () => {
    await seedSkill('coder', 'throwaway', 'mine', skillText('throwaway', 'Not needed any more.'));
    await seedSkill('default', 'throwaway', 'mine', skillText('throwaway', 'Not needed any more.'));
    const owner = await start();

    const request = deleteRequest('coder', 'throwaway');
    const done = await owner.call(request.method, request.path, { body: request.body });
    expect(done.status).toBe(200);
    expect(readDeleteAnswer(done.body)).toEqual({ ok: true, message: 'archived \'throwaway\' — restore with: hermes curator restore throwaway' });
    expect(parseSkills((await owner.call('GET', listPath('coder'))).body).map((skill) => skill.name)).not.toContain('throwaway');
    // The other profile still has its own.
    expect(parseSkills((await owner.call('GET', listPath('default'))).body).map((skill) => skill.name)).toContain('throwaway');
    expect(fs.existsSync(path.join(skillsDir('coder'), '.archive', 'throwaway'))).toBe(true);
  });

  test('Hermes\'s refusal to delete is the reason shown: a pinned skill is not archived', async () => {
    await seedSkill('coder', 'pinned-one', undefined, skillText('pinned-one', 'Keep me.'));
    const pin = path.join(skillsDir('coder'), '.usage.json');
    fs.writeFileSync(pin, JSON.stringify({ 'pinned-one': { pinned: true } }));
    const owner = await start();
    const request = deleteRequest('coder', 'pinned-one');
    const refused = await owner.call<{ detail: string }>(request.method, request.path, { body: request.body });
    expect(refused.status).toBe(400);
    expect(refused.body.detail).toContain('is pinned');
    expect(parseSkills((await owner.call('GET', listPath('coder'))).body).map((skill) => skill.name)).toContain('pinned-one');
  });

  test('both are blocked in read-only mode before Hermes is asked', async () => {
    seedHubSkill('coder', 'kept-hub');
    await seedSkill('coder', 'kept-local', undefined, skillText('kept-local', 'Stay.'));
    const owner = await start();
    expect((await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } })).status).toBe(200);
    for (const request of [uninstallRequest('coder', 'kept-hub'), deleteRequest('coder', 'kept-local')]) {
      const refused = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body });
      expect(refused.status, request.path).toBe(403);
      expect(refused.body.error).toBe('read-only');
    }
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
    const names = parseSkills((await owner.call('GET', listPath('coder'))).body).map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining(['kept-hub', 'kept-local']));
  });
});
