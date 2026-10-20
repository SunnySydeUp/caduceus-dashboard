import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { cliCommand, deleteRefusal, gatewayView, overviewMetrics, parseProfiles } from '../../web/src/modules/profiles/profiles-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { startHostGateway } from './fixtures/host-gateway.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { startStubLlm, STUB_TITLE, type StubLlm } from './fixtures/stub-llm.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Agents › Profiles (M4 #01) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME that has
// several profiles. The page's own reading code (`profiles-model.ts`) is run over what Hermes really answers.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
let llm: StubLlm;
/** Where Hermes 0.22's one gateway records itself for the host: the test's own, so the owner's is never read. */
let hostState: string;
beforeAll(async () => {
  hostState = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-host-state-'));
  hermes = await launchTestHermes({ sharedHostState: hostState });
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
  for (const name of ['coder', 'writer', 'scratch']) {
    const created = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!created.ok) throw new Error(`Creating ${name}: HTTP ${created.status}`);
  }
  // Hermes 0.21.4: a profile-scoped read (`?profile=`) made before the process's first model call breaks every later call of the
  // auxiliary client (`UnscopedSecretError`) until Hermes restarts. A Hermes that has been running for a while has made one,
  // so the first call is made here, before any test reads.
  const warmed = await hermes.backend.fetch('/api/profiles/scratch/describe-auto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ overwrite: true }) });
  if (!((await warmed.json()) as { ok: boolean }).ok) throw new Error('The stub model did not answer Hermes\'s describe call.');
}, 90_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
  fs.rmSync(hostState, { recursive: true, force: true });
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
    return { status: res.status, body: (text.startsWith('{') ? JSON.parse(text) : text) as never };
  };
  const confirm: Owner['confirm'] = async (operation, target, body) => {
    const bodySha256 = body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation, target, typed: target, ...(bodySha256 ? { bodySha256 } : {}) } });
    return minted.body.token;
  };
  return { url, call, confirm };
}

/** What the Profiles screen reads to draw its cards, through the proxy. */
async function loadCards(owner: Owner) {
  const [list, active] = await Promise.all([owner.call('GET', '/api/profiles'), owner.call('GET', '/api/profiles/active')]);
  return parseProfiles(list.body, active.body);
}

describe('the cards', () => {
  test('one card for every profile Hermes has, the sticky default marked, each with its live gateway status', async () => {
    const owner = await start();
    const cards = await loadCards(owner);

    expect(cards.map((c) => c.name).sort()).toEqual(['coder', 'default', 'scratch', 'writer']);
    expect(cards.filter((c) => c.isDefault).map((c) => c.name)).toEqual(['default']);
    expect(cards.filter((c) => c.isRoot).map((c) => c.name)).toEqual(['default']);

    const status = async (name: string) => (await owner.call<{ gateway_running: boolean; gateway_state: string | null }>('GET', `/api/status?profile=${name}`)).body;
    // Hermes 0.22 runs ONE gateway per host that serves every profile (`gateway/host_rendezvous.py`), and a served profile has no gateway files of its own: it
    // reads as running when the host's gateway record names it. Without a gateway, every profile is stopped, the default one too (Hermes's own `serve` is not one).
    for (const name of ['default', 'coder']) expect(gatewayView(await status(name))).toEqual({ badge: 'offline', label: 'Stopped' });

    const gateway = await startHostGateway({ lockDir: hostState, home: hermes.home, served: ['default', 'coder'] });
    try {
      // Hermes decides "running" with a health probe it gives up on after a short while (`_bounded_health_probe` in its `/api/status`), and answers
      // "Stopped" for that one request when a busy machine is slower than that. The next request is the true answer, so wait for it.
      await expect.poll(async () => gatewayView(await status('default')).badge, { timeout: 10_000 }).toBe('online');
      await expect.poll(async () => gatewayView(await status('coder')).badge, { timeout: 10_000 }).toBe('online');
      // A profile the gateway does not serve is still stopped.
      expect(gatewayView(await status('writer'))).toEqual({ badge: 'offline', label: 'Stopped' });
    } finally {
      await gateway.stop();
    }
  });
});

describe('the overview', () => {
  test('a profile with no runs shows zeros; tasks assigned to it on the Kanban board count as runs and queued, and its usage analytics are its own', async () => {
    const owner = await start();
    const read = async (name: string) => {
      const [usage, stats, assignees, mcpServers] = await Promise.all([
        owner.call('GET', `/api/analytics/usage?profile=${name}`),
        owner.call('GET', '/api/plugins/kanban/stats'),
        owner.call('GET', '/api/plugins/kanban/assignees'),
        owner.call('GET', `/api/mcp/servers?profile=${name}`),
      ]);
      const card = (await loadCards(owner)).find((c) => c.name === name)!;
      return overviewMetrics({ usage: usage.body, stats: stats.body, assignees: assignees.body, profile: name, mcpServers: mcpServers.body, skillCount: card.skillCount });
    };

    expect(await read('scratch')).toMatchObject({ sessions: 0, tokens: 0, runs: 0, successRate: 0, queued: 0, mcpServers: 0 });

    const task = async (title: string, status?: string) => {
      const made = await owner.call<{ task: { id: string } }>('POST', '/api/plugins/kanban/tasks', { body: { title, assignee: 'writer' } });
      expect(made.status).toBe(200);
      if (status) expect((await owner.call('PATCH', `/api/plugins/kanban/tasks/${made.body.task.id}`, { body: { status, ...(status === 'done' ? { summary: 'Finished' } : {}) } })).status).toBe(200);
    };
    await task('Draft the post', 'done');
    await task('Edit the post', 'done');
    await task('Stuck on a source', 'blocked');
    await task('Next week');
    const writer = await read('writer');
    expect(writer).toMatchObject({ runs: 3, successRate: 2 / 3 });
    expect(writer.queued).toBe(1);
    // Tasks are assigned to one profile only.
    expect(await read('coder')).toMatchObject({ runs: 0, queued: 0 });
  });
});

describe('Make default', () => {
  test('is Tier 2: refused without a fresh step-up, then it writes Hermes\'s active profile, and only that does', async () => {
    const owner = await start();
    const activeFile = path.join(hermes.home, 'active_profile');
    const active = async () => ((await owner.call<{ active: string }>('GET', '/api/profiles/active')).body.active);

    // Everything else the Profiles screen does, short of Make default, leaves the sticky default alone.
    expect((await owner.call('PUT', '/api/profiles/coder/description', { body: { description: 'Writes code' } })).status).toBe(200);
    expect((await owner.call('POST', '/api/profiles', { body: { name: 'extra' } })).status).toBe(200);
    expect((await owner.call('PATCH', '/api/profiles/extra', { body: { new_name: 'extra2' } })).status).toBe(200);
    expect((await owner.call('PUT', '/_caduceus/api/preferences/profiles/coder', { body: { assistantName: 'Cody' } })).status).toBe(200);
    expect((await owner.call('DELETE', '/api/profiles/extra2', { headers: { 'x-caduceus-confirmation': await owner.confirm('DELETE /api/profiles/extra2', 'extra2') } })).status).toBe(200);
    expect(await active()).toBe('default');
    expect(fs.existsSync(activeFile)).toBe(false);

    const made = await owner.call('POST', '/api/profiles/active', { body: { name: 'coder' } });
    expect(made.status).toBe(200);
    expect(await active()).toBe('coder');
    expect(fs.readFileSync(activeFile, 'utf8').trim()).toBe('coder');
    expect((await loadCards(owner)).filter((c) => c.isDefault).map((c) => c.name)).toEqual(['coder']);

    // Put it back for the tests that follow.
    expect((await owner.call('POST', '/api/profiles/active', { body: { name: 'default' } })).status).toBe(200);
    expect(await active()).toBe('default');
  });

  test('without a step-up the server refuses it and nothing is written', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    const cookie = await ownerCookie(server.url);
    const res = await fetch(`${server.url}/api/profiles/active`, {
      method: 'POST',
      headers: { origin: server.url, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'coder' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as PolicyRefusal).error).toBe('step-up-required');
    expect(fs.existsSync(path.join(hermes.home, 'active_profile'))).toBe(false);
  });
});

describe('rename', () => {
  test('is Tier 0 (no confirmation, no step-up) and can be undone by renaming back; the root profile only takes a display name', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    const cookie = await ownerCookie(server.url);
    const patch = (name: string, newName: string) =>
      fetch(`${server!.url}/api/profiles/${name}`, { method: 'PATCH', headers: { origin: server!.url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ new_name: newName }) });
    const names = async () => (await (await hermes.backend.fetch('/api/profiles')).json() as { profiles: { name: string }[] }).profiles.map((p) => p.name).sort();

    expect((await patch('scratch', 'scratch-2')).status).toBe(200);
    expect(await names()).toEqual(['coder', 'default', 'scratch-2', 'writer']);
    // Undo.
    expect((await patch('scratch-2', 'scratch')).status).toBe(200);
    expect(await names()).toEqual(['coder', 'default', 'scratch', 'writer']);

    const root = await patch('default', 'Prime');
    expect(await root.json()).toMatchObject({ name: 'default', display_name: 'Prime' });
    expect(await names()).toContain('default');
    // Undo of a display name: put the name it had (none shows as the id) back.
    expect((await patch('default', 'default')).status).toBe(200);
  });
});

describe('delete', () => {
  test('is Tier 3: it needs the step-up and the typed confirmation of that profile, then removes the profile', async () => {
    const owner = await start();
    await owner.call('POST', '/api/profiles', { body: { name: 'doomed' } });

    const bare = await owner.call<PolicyRefusal>('DELETE', '/api/profiles/doomed');
    expect(bare.status).toBe(403);
    expect(bare.body.error).toBe('confirmation-required');
    expect((await loadCards(owner)).map((c) => c.name)).toContain('doomed');

    const done = await owner.call('DELETE', '/api/profiles/doomed', { headers: { 'x-caduceus-confirmation': await owner.confirm('DELETE /api/profiles/doomed', 'doomed') } });
    expect(done.status).toBe(200);
    expect((await loadCards(owner)).map((c) => c.name)).not.toContain('doomed');
  });

  test('is blocked in read-only mode before Hermes is asked', async () => {
    const owner = await start();
    await owner.call('POST', '/api/profiles', { body: { name: 'kept' } });
    expect((await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } })).status).toBe(200);

    const res = await owner.call<PolicyRefusal>('DELETE', '/api/profiles/kept', { headers: { 'x-caduceus-confirmation': await owner.confirm('DELETE /api/profiles/kept', 'kept') } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('read-only');
    expect((await loadCards(owner)).map((c) => c.name)).toContain('kept');

    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
    expect((await owner.call('DELETE', '/api/profiles/kept', { headers: { 'x-caduceus-confirmation': await owner.confirm('DELETE /api/profiles/kept', 'kept') } })).status).toBe(200);
  });

  test('what the page refuses before asking, Hermes refuses too: the root profile cannot be deleted', async () => {
    const owner = await start();
    const cards = await loadCards(owner);
    const root = cards.find((c) => c.isRoot)!;
    expect(deleteRefusal(root, cards)).toBeDefined();

    const res = await owner.call('DELETE', '/api/profiles/default', { headers: { 'x-caduceus-confirmation': await owner.confirm('DELETE /api/profiles/default', 'default') } });
    expect(res.status).toBe(400);
    expect((await loadCards(owner)).map((c) => c.name)).toContain('default');
  });
});

describe('description', () => {
  test('a manual edit is saved through Hermes as the owner\'s own text', async () => {
    const owner = await start();
    const saved = await owner.call('PUT', '/api/profiles/writer/description', { body: { description: '  Drafts and edits posts  ' } });
    expect(saved.body).toMatchObject({ ok: true, description: 'Drafts and edits posts', description_auto: false });

    const writer = (await loadCards(owner)).find((c) => c.name === 'writer')!;
    expect(writer).toMatchObject({ description: 'Drafts and edits posts', descriptionAuto: false });
  });

  test('Auto-describe asks Hermes\'s describe endpoint, which writes what its model proposes and marks it as automatic; a user-written one needs overwrite', async () => {
    const owner = await start();
    await owner.call('PUT', '/api/profiles/coder/description', { body: { description: 'Mine' } });

    const refused = await owner.call('POST', '/api/profiles/coder/describe-auto', { body: { overwrite: false } });
    expect(refused.body).toMatchObject({ ok: false, reason: expect.stringContaining('user-authored') });
    expect((await loadCards(owner)).find((c) => c.name === 'coder')!.description).toBe('Mine');

    const described = await owner.call('POST', '/api/profiles/coder/describe-auto', { body: { overwrite: true } });
    // The stub model answers every completion that is not streamed with its title text.
    expect(described.body).toMatchObject({ ok: true, description: STUB_TITLE, description_auto: true });
    expect((await loadCards(owner)).find((c) => c.name === 'coder')).toMatchObject({ description: STUB_TITLE, descriptionAuto: true });
  });
});

describe('Copy CLI command', () => {
  test('the command it copies names a profile Hermes can start on: `hermes -p <name>` is the same profile Hermes lists', async () => {
    const owner = await start();
    const cards = await loadCards(owner);
    for (const card of cards) expect(cliCommand(card.name)).toBe(`hermes -p ${card.name}`);
  });
});
