import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { FileSnapshot, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { contextEnginePaths, factsParams, parseFacts, parseTextFile, parseWiki, readTextPath, wikiFolder, wikiPath, graphPath, nodeDelete, nodePath, nodeSave, parseGraph, parseNode, readChange, readNodeAnswer, contextEngineSave, formProblems, formSave, loadForm, oauthStart, parseContextEngine, oauthStatusPath, parseMemory, parseOauth, providerSelect, type MemoryRequest, type OauthStatus } from '../../web/src/modules/memory/memory-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { openGatewayConnection } from './fixtures/gateway-client.ts';
import { installMemoryPlugins } from './fixtures/memory-plugins.ts';
import { startHonchoOauthFixture, type HonchoOauthFixture } from './fixtures/honcho-oauth-server.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Agents › Memory (M4 #09) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The page's own reading and
// request code (`web/src/modules/memory/memory-model.ts`) is run over what Hermes really answers. A provider that keeps its settings in a
// file of its own (Honcho's `honcho.json`) is given that file inside the temp home first, so no test ever writes under `~`.
let hermes: TestHermes;
let honcho: HonchoOauthFixture;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  // Hermes's Honcho sign-in is pointed at a local authorization server and a "browser" that follows the redirect itself.
  honcho = await startHonchoOauthFixture();
  hermes = await launchTestHermes({ env: honcho.env });
  await hermes.backend.ready();
  fs.writeFileSync(path.join(hermes.home, 'honcho.json'), '{}');
  const created = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'coder' }) });
  if (!created.ok) throw new Error(`Creating coder: HTTP ${created.status}`);
  // Hermes 0.22 keeps only ByteRover and RetainDB in its tree: Honcho, Holographic and Mem0 are plugins each profile installs from the catalogue.
  installMemoryPlugins(hermes.home, ['honcho', 'holographic', 'mem0']);
  installMemoryPlugins(path.join(hermes.home, 'profiles', 'coder'), ['holographic']);
}, 90_000);
afterAll(async () => {
  try {
    await hermes.stop();
  } finally {
    await honcho.close();
  }
});
afterEach(async () => {
  // Honcho keeps the provider's settings and any sign-in in this file: every test starts without them.
  fs.writeFileSync(path.join(hermes.home, 'honcho.json'), '{}');
  honcho.refuse(false);
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
  /** Sends one of the page's requests the way the tiered dialog does: with the typed confirmation of `typed` for a T3. */
  send<T = unknown>(request: MemoryRequest, typed?: string): Promise<Answer<T>>;
  /** Reads a path through the server, as JSON. */
  read(route: string): Promise<unknown>;
  url: string;
  cookie: string;
}

async function start({ steppedUp = true }: { steppedUp?: boolean } = {}): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
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
    if (typed !== undefined) {
      const bodySha256 = request.body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex');
      const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation: `${request.method} ${request.path}`, target: typed, typed, ...(bodySha256 ? { bodySha256 } : {}) } });
      confirmation = minted.body.token;
    }
    return call(request.method, request.path, { body: request.body, headers: confirmation ? { 'x-caduceus-confirmation': confirmation } : undefined });
  };
  const read: Owner['read'] = async (route) => (await call('GET', route)).body;
  return { call, send, read, url, cookie };
}

describe('the memory providers', () => {
  test('are Hermes’s list with its own statuses, and each provider’s form is built from the schema Hermes gives for it (declared for Honcho, native for the rest)', async () => {
    const owner = await start();

    const memory = parseMemory(await owner.read('/api/memory?profile=default'));
    const honchoForm = await loadForm('honcho', 'default', owner.read);
    const holographic = await loadForm('holographic', 'default', owner.read);

    expect(memory.active).toBe('');
    expect(memory.providers.find((provider) => provider.name === 'holographic')).toMatchObject({ status: 'ready', available: true });
    expect(memory.providers.find((provider) => provider.name === 'honcho')).toMatchObject({ status: 'needs_config', available: false });
    expect(honchoForm).toMatchObject({ surface: 'declared', label: 'Honcho' });
    expect(honchoForm.fields.find((field) => field.key === 'apiKey')).toMatchObject({ kind: 'secret', isSet: false, value: '', group: 'Connection' });
    expect(honchoForm.fields.find((field) => field.key === 'environment')).toMatchObject({ kind: 'select', value: 'production', options: [{ value: 'production' }, { value: 'local' }] });
    expect(honchoForm.fields.find((field) => field.key === 'pinUserPeer')).toMatchObject({ kind: 'bool' });
    expect(holographic.surface).toBe('native');
    expect(holographic.fields.find((field) => field.key === 'auto_extract')).toMatchObject({ kind: 'select', value: 'false' });
    expect(holographic.fields.find((field) => field.key === 'db_path')?.value).toMatch(/memory_store\.db$/);
  });
});

describe('choosing the memory provider', () => {
  test('is a Tier 1 write that Hermes accepts for a ready provider and refuses, with its reason, for one that is not ready; an empty name is the built-in memory', async () => {
    const owner = await start();
    const activeOf = async () => parseMemory(await owner.read('/api/memory?profile=default')).active;

    expect((await owner.send(providerSelect('holographic', 'default'))).status).toBe(200);
    expect(await activeOf()).toBe('holographic');

    const refused = await owner.send<{ detail: string }>(providerSelect('honcho', 'default'));
    expect(refused.status).toBe(400);
    expect(refused.body.detail).toContain('not ready');
    expect(await activeOf()).toBe('holographic');

    expect((await owner.send(providerSelect('', 'default'))).status).toBe(200);
    expect(await activeOf()).toBe('');
  });
});

describe('saving a provider’s form', () => {
  test('is a Tier 2 write; a secret goes to Hermes and is never sent back, and the provider is then the profile’s memory provider', async () => {
    const asGuest = await start({ steppedUp: false });
    const form = await loadForm('honcho', 'default', asGuest.read);
    const edits = { workspace: 'caduceus-test', apiKey: 'honcho-secret-0123456789', timeout: '45' };
    const request = formSave(form, edits, 'default');

    const refused = await asGuest.send<PolicyRefusal>(request);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    await server!.close();

    const owner = await start();
    expect((await owner.send(request)).status).toBe(200);
    const saved = await loadForm('honcho', 'default', owner.read);
    const listing = await owner.call('GET', '/api/memory/providers/honcho/config?surface=declared&profile=default');

    expect(saved.fields.find((field) => field.key === 'workspace')).toMatchObject({ value: 'caduceus-test', isSet: true });
    expect(saved.fields.find((field) => field.key === 'timeout')).toMatchObject({ value: '45' });
    expect(saved.fields.find((field) => field.key === 'apiKey')).toMatchObject({ value: '', isSet: true });
    expect(listing.text).not.toContain('honcho-secret-0123456789');
    expect(request.body).toMatchObject({ values: { workspace: 'caduceus-test', apiKey: 'honcho-secret-0123456789' } });
    expect(parseMemory(await owner.read('/api/memory?profile=default')).active).toBe('honcho');
    expect(await owner.send(providerSelect('', 'default'))).toMatchObject({ status: 200 });
  });

  test('keeps a stored secret when the field is left empty, and checks what Hermes would refuse before anything is sent', async () => {
    const owner = await start();
    const form = await loadForm('honcho', 'default', owner.read);

    expect(formSave(form, { workspace: 'again' }, 'default').body).toEqual({ values: expect.not.objectContaining({ apiKey: expect.anything() }) });
    expect(formProblems(form, { timeout: 'soon' })).toEqual({ timeout: expect.stringContaining('number') });
    expect(formProblems(form, { timeout: '30' })).toEqual({});
    expect(formProblems(await loadForm('mem0', 'default', owner.read), {})).toEqual({ api_key: expect.stringContaining('required') });
  });
});

/** Follows a sign-in until Hermes says it is over. A bounded poll: the flow ends on Hermes's own worker thread, and there is no event to wait for over REST. */
async function settled(owner: Owner): Promise<OauthStatus> {
  let latest = parseOauth(await owner.read(oauthStatusPath('honcho', 'default')))!;
  for (let polls = 0; polls < 100 && (latest.state === 'pending' || latest.state === 'idle'); polls += 1) {
    await sleep(100);
    latest = parseOauth(await owner.read(oauthStatusPath('honcho', 'default')))!;
  }
  return latest;
}

describe('a provider’s own sign-in', () => {
  test('only a provider that has one answers its status; starting it is a Tier 1 write and Hermes finishes it with the browser it opens: the status then says connected', async () => {
    const owner = await start();

    expect(parseOauth(await owner.read(oauthStatusPath('mem0', 'default')))).toBeUndefined();
    const before = parseOauth(await owner.read(oauthStatusPath('honcho', 'default')));
    expect(before?.state).toBe('idle');

    const started = await owner.send(oauthStart('honcho', 'default'));
    const after = await settled(owner);

    expect(started.status).toBe(200);
    expect(parseOauth(started.body)?.state).toBe('pending');
    expect(after).toMatchObject({ state: 'connected', connected: true, auth: 'oauth' });
    expect(honcho.grants).toEqual(['authorization_code']);
    expect(honcho.authorizations[0].searchParams.get('code_challenge_method')).toBe('S256');
    expect(JSON.stringify(await owner.read(oauthStatusPath('honcho', 'default')))).not.toContain('hch-at-fixture-access-token');
  });

  test('says why a sign-in failed when the provider refuses it', async () => {
    const owner = await start();
    honcho.refuse();

    await owner.send(oauthStart('honcho', 'default'));
    const after = await settled(owner);

    expect(after.state).toBe('error');
    expect(after.detail).toContain('400 Bad Request');
  });
});

/** A context engine of the kind a plugin registers, so that Hermes has one to choose besides its built-in compressor. */
function installFixtureEngine(): void {
  const dir = path.join(hermes.home, 'plugins', 'fixture-engine');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.yaml'), 'name: fixture-engine\nversion: 1.0.0\ndescription: A context engine for tests.\n');
  fs.writeFileSync(
    path.join(dir, '__init__.py'),
    [
      'from agent.context_engine import ContextEngine',
      'class FixtureEngine(ContextEngine):',
      '    @property',
      '    def name(self): return "fixture-engine"',
      '    def update_from_response(self, usage): pass',
      '    def should_compress(self, prompt_tokens=None): return False',
      '    def compress(self, messages, current_tokens=None, **kw): return messages',
      'def register(ctx):',
      '    ctx.register_context_engine(FixtureEngine())',
      '',
    ].join('\n'),
  );
}

describe('the context engine', () => {
  test('is chosen from the engines Hermes lists plus its built-in compressor; saving is a Tier 2 write and a reload shows what Hermes keeps, including an engine it no longer has', async () => {
    installFixtureEngine();
    expect((await hermes.backend.fetch('/api/dashboard/agent-plugins/fixture-engine/enable', { method: 'POST' })).status).toBe(200);
    await hermes.backend.restart();
    const asGuest = await start({ steppedUp: false });
    const read = async (owner: Owner) => {
      const paths = contextEnginePaths('default');
      return parseContextEngine(await owner.read(paths.config), await owner.read(paths.hub));
    };

    const before = await read(asGuest);
    expect(before.current).toBe('compressor');
    expect(before.options).toMatchObject([{ name: 'compressor', installed: true }, { name: 'fixture-engine', description: 'A context engine for tests.', installed: true }]);

    const refused = await asGuest.send<PolicyRefusal>(contextEngineSave('fixture-engine', 'default'));
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect((await read(asGuest)).current).toBe('compressor');
    await server!.close();

    const owner = await start();
    expect((await owner.send(contextEngineSave('fixture-engine', 'default'))).status).toBe(200);
    expect((await read(owner)).current).toBe('fixture-engine');
    expect(((await (await hermes.backend.fetch('/api/config?profile=default')).json()) as { context: { engine: string } }).context.engine).toBe('fixture-engine');

    // A name the CLI wrote that no plugin provides is still shown, as what Hermes has, and can be switched away from.
    expect((await hermes.backend.fetch('/api/dashboard/plugin-providers?profile=default', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context_engine: 'lcm' }) })).status).toBe(200);
    const stale = await read(owner);
    expect(stale.current).toBe('lcm');
    expect(stale.options.find((option) => option.name === 'lcm')).toMatchObject({ installed: false });
    expect((await owner.send(contextEngineSave('compressor', 'default'))).status).toBe(200);
    expect((await read(owner)).current).toBe('compressor');
  }, HERMES_WORK_TIMEOUT_MS);
});

const skillText = (name: string, related: string[] = []) => `---\nname: ${name}\ndescription: ${name} notes.\n${related.length ? `metadata:\n  hermes:\n    related_skills: [${related.join(', ')}]\n` : ''}---\n\n# ${name}\n`;
const memoriesDir = () => path.join(hermes.home, 'memories');
const seedLearning = async () => {
  // What a profile that has learned something looks like: skills the agent made or used, and its two memory files.
  for (const [name, related] of [['deploy-notes', ['staging-check']], ['staging-check', []]] as const) {
    if (fs.existsSync(path.join(hermes.home, 'skills', name))) continue;
    const made = await hermes.backend.fetch('/api/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, content: skillText(name, [...related]), profile: 'default' }) });
    if (!made.ok) throw new Error(`Seeding ${name}: HTTP ${made.status}`);
  }
  fs.writeFileSync(path.join(hermes.home, 'skills', '.usage.json'), JSON.stringify({ 'deploy-notes': { created_by: 'agent', use_count: 3 }, 'staging-check': { use_count: 1 } }));
  fs.mkdirSync(memoriesDir(), { recursive: true });
  fs.writeFileSync(path.join(memoriesDir(), 'MEMORY.md'), 'Deploys go through staging first\n§\nThe billing key rotates monthly');
  fs.writeFileSync(path.join(memoriesDir(), 'USER.md'), 'Prefers short answers');
};

describe('the learning graph', () => {
  test('is Hermes’s graph of what the profile has learned: skills and memory chunks are nodes, declared and shared-word links are edges', async () => {
    await seedLearning();
    const owner = await start();

    const graph = parseGraph(await owner.read(graphPath('default')));

    // A memory chunk's id is its file, its place and a digest of its text (Hermes 0.22: the id names the entry the owner clicked, not whoever sits there now).
    const chunk = (label: string) => graph.nodes.find((node) => node.label === label)!;
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(['deploy-notes', chunk('Deploys go through staging first').id, chunk('The billing key rotates monthly').id, chunk('Prefers short answers').id, 'staging-check'].sort());
    expect(chunk('Deploys go through staging first').id).toMatch(/^memory:memory:0:[0-9a-f]+$/);
    expect(chunk('The billing key rotates monthly').id).toMatch(/^memory:memory:1:[0-9a-f]+$/);
    expect(chunk('Prefers short answers').id).toMatch(/^memory:profile:2:[0-9a-f]+$/);
    expect(graph.nodes.find((node) => node.id === 'deploy-notes')).toMatchObject({ kind: 'skill', label: 'deploy-notes', useCount: 3, createdBy: 'agent', pinned: false });
    expect(chunk('Prefers short answers')).toMatchObject({ kind: 'memory', memorySource: 'profile' });
    expect(graph.edges).toContainEqual({ source: 'deploy-notes', target: 'staging-check' });
    expect(graph.edges).toContainEqual({ source: chunk('Deploys go through staging first').id, target: 'staging-check' });
    expect(graph.stats).toMatchObject({ learnedSkills: 2, memoryNodes: 3 });
  });
});

describe('a node of the learning graph', () => {
  test('shows its content; an edit and a delete are Tier 1 writes that Hermes makes, and a memory chunk’s old text is kept as a snapshot', async () => {
    await seedLearning();
    const owner = await start();
    const memoryFile = path.join(memoriesDir(), 'MEMORY.md');
    const snapshots = async () => ((await owner.read(`/_caduceus/api/file-snapshots?kind=file&path=${encodeURIComponent(memoryFile)}`)) as { snapshots: FileSnapshot[] }).snapshots;

    // The ids are the ones the graph gives, as the page uses them.
    const idOf = async (label: string) => parseGraph(await owner.read(graphPath('default'))).nodes.find((node) => node.label === label)!.id;
    const billing = await idOf('The billing key rotates monthly');

    const detail = readNodeAnswer((await owner.call('GET', nodePath(billing, 'default'))).body);
    expect(detail).toEqual({ ok: true, node: { id: billing, kind: 'memory', label: 'The billing key rotates monthly', content: 'The billing key rotates monthly' } });

    const edited = await owner.send(nodeSave(billing, 'The billing key rotates weekly', 'default'));
    expect(edited.status).toBe(200);
    expect(fs.readFileSync(memoryFile, 'utf8')).toBe('Deploys go through staging first\n§\nThe billing key rotates weekly');
    expect(await snapshots()).toHaveLength(1);

    const deleted = await owner.send(nodeDelete(await idOf('Deploys go through staging first'), 'default'));
    expect(readChange(deleted.body)).toMatchObject({ ok: true });
    expect(fs.readFileSync(memoryFile, 'utf8')).toBe('The billing key rotates weekly');
    const kept = await snapshots();
    expect(kept).toHaveLength(2);
    const newest = (await owner.read(`/_caduceus/api/file-snapshots/${kept[0].id}`)) as { text: string };
    expect(newest.text).toBe('Deploys go through staging first\n§\nThe billing key rotates weekly');
    expect(parseNode((await owner.call('GET', nodePath('deploy-notes', 'default'))).body)?.content).toContain('# deploy-notes');
  });

  test('Hermes’s refusals are the reason shown: a stale id, a pinned skill, an empty chunk', async () => {
    await seedLearning();
    fs.writeFileSync(path.join(hermes.home, 'skills', '.usage.json'), JSON.stringify({ 'deploy-notes': { created_by: 'agent', use_count: 3, pinned: true }, 'staging-check': { use_count: 1 } }));
    const owner = await start();

    const chunkId = parseGraph(await owner.read(graphPath('default'))).nodes.find((node) => node.label === 'The billing key rotates monthly')!.id;
    fs.writeFileSync(path.join(memoriesDir(), 'MEMORY.md'), 'Deploys go through staging first\n§\nThe billing key rotates weekly');

    expect(readNodeAnswer((await owner.call('GET', nodePath('memory:memory:9', 'default'))).body)).toMatchObject({ ok: false, message: expect.stringContaining('out of range') });
    expect(readChange((await owner.send(nodeDelete(chunkId, 'default'))).body)).toMatchObject({ ok: false, message: expect.stringContaining('stale') });
    expect(readChange((await owner.send(nodeDelete('deploy-notes', 'default'))).body)).toMatchObject({ ok: false, message: expect.stringContaining('pinned') });
    expect(readChange((await owner.send(nodeSave('memory:memory:0', '   ', 'default'))).body)).toMatchObject({ ok: false, message: expect.stringContaining('empty') });
  });

  test('edit and delete are blocked in read-only mode before Hermes is asked', async () => {
    await seedLearning();
    const owner = await start();
    expect((await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } })).status).toBe(200);

    for (const request of [nodeSave('memory:memory:0', 'changed', 'default'), nodeDelete('memory:memory:0', 'default')]) {
      const refused = await owner.send<PolicyRefusal>(request);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe('read-only');
    }
    expect(fs.readFileSync(path.join(memoriesDir(), 'MEMORY.md'), 'utf8')).toBe('Deploys go through staging first\n§\nThe billing key rotates monthly');
  });
});

describe('project context', () => {
  test('is what Hermes’s project.facts says of a folder: manifests, package managers, check commands and context files; a folder that is no workspace has none', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-memory-workspace-'));
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-memory-bare-'));
    try {
      fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }));
      fs.writeFileSync(path.join(workspace, 'package-lock.json'), '{}');
      fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Rules\n\nRun the tests before you commit.\n');
      const owner = await start();
      const gateway = openGatewayConnection(owner.url, owner.cookie);
      await gateway.until((status) => status.state === 'connected');

      const found = parseFacts(await gateway.connection.client.request('project.facts', factsParams(workspace, 'default')));
      const none = parseFacts(await gateway.connection.client.request('project.facts', factsParams(bare, 'default')));
      gateway.connection.close();

      expect(found).toMatchObject({ manifests: ['package.json'], packageManagers: ['npm'], verifyCommands: ['npm run test', 'npm run lint'], contextFiles: ['AGENTS.md'] });
      expect(fs.realpathSync(found!.root)).toBe(fs.realpathSync(workspace));
      expect(none).toBeUndefined();
      const file = parseTextFile(await owner.read(readTextPath(path.join(found!.root, 'AGENTS.md'))));
      expect(file).toMatchObject({ text: '# Rules\n\nRun the tests before you commit.\n', truncated: false, binary: false });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('the LLM Wiki', () => {
  test('is a folder of Markdown pages read through Hermes’s file listing: the folder is the profile’s configured one or ~/wiki, pages and folders are listed, and a missing folder says so', async () => {
    const wiki = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-memory-wiki-'));
    try {
      fs.mkdirSync(path.join(wiki, 'concepts'));
      fs.mkdirSync(path.join(wiki, 'raw'));
      fs.writeFileSync(path.join(wiki, 'index.md'), '# Wiki\n\n- [[concepts/context]]\n');
      fs.writeFileSync(path.join(wiki, 'SCHEMA.md'), '# Schema\n');
      fs.writeFileSync(path.join(wiki, 'concepts', 'context.md'), '# Context\n\nWhat fits in a window.\n');
      fs.writeFileSync(path.join(wiki, 'notes.txt'), 'not a page');
      const owner = await start();

      expect(wikiFolder(await owner.read('/api/config?profile=default'))).toBe('~/wiki');
      // The folder is set the way the owner would, with Hermes's own CLI.
      await hermes.cli('config', 'set', 'skills.config.wiki.path', wiki);
      expect(wikiFolder(await owner.read('/api/config?profile=default'))).toBe(wiki);

      const root = parseWiki(await owner.read(wikiPath(wiki)));
      expect(root).toMatchObject({ kind: 'folder', folders: [{ name: 'concepts' }, { name: 'raw' }], pages: [{ name: 'index.md' }, { name: 'SCHEMA.md' }] });
      const page = parseTextFile(await owner.read(readTextPath(path.join(wiki, 'concepts', 'context.md'))));
      expect(page?.text).toBe('# Context\n\nWhat fits in a window.\n');
      expect(parseWiki(await owner.read(wikiPath(path.join(wiki, 'nowhere'))))).toEqual({ kind: 'missing' });
    } finally {
      fs.rmSync(wiki, { recursive: true, force: true });
    }
  });
});

describe('a profile of its own', () => {
  test('has its own provider, context engine and learning graph: a change for coder is not a change for default', async () => {
    await seedLearning();
    const owner = await start();

    expect((await owner.send(providerSelect('holographic', 'coder'))).status).toBe(200);
    expect((await owner.send(contextEngineSave('lcm', 'coder'))).status).toBe(200);

    expect(parseMemory(await owner.read('/api/memory?profile=coder')).active).toBe('holographic');
    expect(parseMemory(await owner.read('/api/memory?profile=default')).active).toBe('');
    const paths = contextEnginePaths('coder');
    expect(parseContextEngine(await owner.read(paths.config), await owner.read(paths.hub)).current).toBe('lcm');
    expect(parseContextEngine(await owner.read(contextEnginePaths('default').config), undefined).current).toBe('compressor');
    expect(parseGraph(await owner.read(graphPath('coder'))).nodes).toEqual([]);
    expect(parseGraph(await owner.read(graphPath('default'))).nodes.length).toBeGreaterThan(0);
  });
});
