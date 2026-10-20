import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AuditEntry, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { actionLogPath, readActionLog } from '../../web/src/modules/skills/hub-model.ts';
import { parseChannels } from '../../web/src/modules/channels/channels-model.ts';
import { computerUseGrant, parseComputerUse, parsePlatformJson, parsePortal, parseToolsetConfig, parseToolsetModels, parseToolsets, platformGrid, platformToolsetsUpdate, readPlatformToolsets, readProviderAnswer, setCell, setupResult, toolsetEnv, toolsetModel, toolsetPostSetup, toolsetProvider, toolsetToggle } from '../../web/src/modules/tools/tools-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Agents › Tools & MCP › Toolsets (M4 #06) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The page's
// own reading and request code (`web/src/modules/tools/tools-model.ts`) is run over what Hermes really answers. No provider key is ever
// real: a key written here is only a string in the temp home's `.env`.
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
});

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T; headers: Headers; text: string }>;
  /** The typed confirmation of a T3 request, as the tiered dialog makes it: its token. */
  confirm(operation: string, target: string, body?: unknown): Promise<string>;
}

/** The owner signed in at the server; with `steppedUp`, a passkey step-up too (what a Tier 2 action asks for). */
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
    return { status: res.status, headers: res.headers, text, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as never };
  };
  const confirm: Owner['confirm'] = async (operation, target, body) => {
    const bodySha256 = body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation, target, typed: target, ...(bodySha256 ? { bodySha256 } : {}) } });
    return minted.body.token;
  };
  return { call, confirm };
}

describe('the grid of toolsets', () => {
  test('is every toolset Hermes reports, with whether it is on and whether it still needs keys, and it is never kept by a cache', async () => {
    const owner = await start();

    const answer = await owner.call<{ name: string }[]>('GET', '/api/tools/toolsets?profile=default');
    const toolsets = parseToolsets(answer.body);

    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(toolsets.map((toolset) => toolset.name)).toEqual(answer.body.map((row) => row.name));
    expect(toolsets.length).toBeGreaterThanOrEqual(25);
    expect(toolsets.find((toolset) => toolset.name === 'web')).toMatchObject({ label: 'Web Search & Scraping', enabled: true, setup: 'ready', platform: 'cli', tools: ['web_extract', 'web_search'] });
    // A fresh home has no key for vision's providers.
    expect(toolsets.find((toolset) => toolset.name === 'vision')).toMatchObject({ enabled: true, setup: 'needs-keys' });
    // Hermes's list of toolsets changes with its releases (Home Assistant left the core ones in 0.22): every row says what Hermes says of it.
    const hermesRows = (await (await hermes.backend.fetch('/api/tools/toolsets?profile=default')).json()) as { name: string; enabled: boolean; configured: boolean }[];
    expect(hermesRows.some((row) => !row.enabled)).toBe(true);
    expect(hermesRows.some((row) => !row.configured)).toBe(true);
    for (const row of hermesRows) {
      expect(toolsets.find((toolset) => toolset.name === row.name)).toMatchObject({ enabled: row.enabled, setup: row.configured ? 'ready' : 'needs-keys' });
    }
    expect(toolsets.find((toolset) => toolset.name === 'discord')).toMatchObject({ platform: 'discord', platformLabel: 'Discord' });
  });
});

const toolsetsOf = async (owner: Owner, profile = 'default') => parseToolsets((await owner.call('GET', `/api/tools/toolsets?profile=${profile}`)).body);

describe('switching a toolset on or off', () => {
  test('is a Tier 1 write through Hermes that changes only that toolset, audited by its name and the profile', async () => {
    const owner = await start();
    const request = toolsetToggle('x_search', 'default', true);

    const saved = await owner.call(request.method, request.path, { body: request.body });
    const audit = await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ok: true, name: 'x_search', platform: 'cli', enabled: true });
    const after = await toolsetsOf(owner);
    expect(after.find((toolset) => toolset.name === 'x_search')!.enabled).toBe(true);
    expect(after.find((toolset) => toolset.name === 'web')!.enabled).toBe(true);
    expect(after.find((toolset) => toolset.name === 'kanban')!.enabled).toBe(false);
    const config = await owner.call<{ platform_toolsets: Record<string, string[]> }>('GET', '/api/config?profile=default');
    expect(config.body.platform_toolsets.cli).toContain('x_search');
    expect(config.body.platform_toolsets.cli).toContain('web');
    expect(audit.body.entries.find((entry) => entry.action === 'PUT /api/tools/toolsets/{name}')).toMatchObject({ tier: 'T1', target: '/api/tools/toolsets/x_search', profile: 'default' });

    const off = toolsetToggle('x_search', 'default', false);
    await owner.call(off.method, off.path, { body: off.body });
    expect((await toolsetsOf(owner)).find((toolset) => toolset.name === 'x_search')!.enabled).toBe(false);
  });

  test('a toolset Hermes does not know is refused with Hermes’s own words, and nothing changes', async () => {
    const owner = await start();
    const request = toolsetToggle('nope', 'default', true);

    const refused = await owner.call<{ detail: string }>(request.method, request.path, { body: request.body });

    expect(refused.status).toBe(400);
    expect(refused.body.detail).toBe('Unknown toolset: nope');
  });
});

const configOf = async (owner: Owner, name: string, profile = 'default') => parseToolsetConfig((await owner.call('GET', `/api/tools/toolsets/${name}/config?profile=${profile}`)).body);

describe('a toolset’s provider, model and keys', () => {
  test('the providers are Hermes’s own matrix, each with the keys it needs and whether they are set, never a value', async () => {
    const owner = await start();

    const config = await configOf(owner, 'image_gen');

    expect(config).toMatchObject({ name: 'image_gen', hasCategory: true, activeProvider: undefined });
    expect(config.providers.map((provider) => provider.name)).toEqual(expect.arrayContaining(['Nous Subscription', 'DeepInfra', 'FAL.ai', 'OpenAI (Codex auth)']));
    expect(config.providers.find((provider) => provider.name === 'FAL.ai')).toMatchObject({ status: 'needs-keys', active: false, env: [{ key: 'FAL_KEY', isSet: false }] });
    expect(config.providers.find((provider) => provider.name === 'Nous Subscription')).toMatchObject({ status: 'needs-auth', requiresNousAuth: true, env: [] });
    expect(config.providers.find((provider) => provider.name === 'OpenAI (Codex auth)')).toMatchObject({ status: 'needs-auth', postSetup: 'openai_codex' });
    expect((await configOf(owner, 'todo')).hasCategory).toBe(false);
  });

  test('choosing a provider is a Tier 1 write; the models are then that provider’s catalogue, and choosing one writes only that', async () => {
    const owner = await start();
    expect(parseToolsetModels((await owner.call('GET', '/api/tools/toolsets/image_gen/models?profile=default')).body)).toMatchObject({ hasModels: false, models: [] });

    const provider = toolsetProvider('image_gen', 'default', 'FAL.ai');
    const chosen = await owner.call(provider.method, provider.path, { body: provider.body });
    const models = parseToolsetModels((await owner.call('GET', '/api/tools/toolsets/image_gen/models?profile=default')).body);

    expect(chosen.status).toBe(200);
    expect(readProviderAnswer(chosen.body)).toEqual({ needsNousAuth: false });
    expect((await configOf(owner, 'image_gen')).activeProvider).toBe('FAL.ai');
    expect(models.hasModels).toBe(true);
    expect(models.provider).toBe('FAL.ai');
    expect(models.models.find((model) => model.id === 'fal-ai/flux-2-pro')).toMatchObject({ display: 'FLUX 2 Pro', price: '$0.03/MP' });

    const pick = toolsetModel('image_gen', 'default', 'fal-ai/flux-2-pro', 'FAL.ai');
    const picked = await owner.call(pick.method, pick.path, { body: pick.body });
    expect(picked.status).toBe(200);
    const after = parseToolsetModels((await owner.call('GET', '/api/tools/toolsets/image_gen/models?profile=default')).body);
    expect(after.current).toBe('fal-ai/flux-2-pro');
    expect((await configOf(owner, 'image_gen')).activeProvider).toBe('FAL.ai');

    const bad = toolsetModel('image_gen', 'default', 'not-a-model', 'FAL.ai');
    const refused = await owner.call<{ detail: string }>(bad.method, bad.path, { body: bad.body });
    expect(refused.status).toBe(400);
    expect(refused.body.detail).toBe("Unknown model 'not-a-model' for backend 'fal'");
  });

  test('an unentitled Nous Portal provider is saved but Hermes says it cannot work until the Portal is signed in, and that is what the page shows', async () => {
    const owner = await start();
    const request = toolsetProvider('image_gen', 'default', 'Nous Subscription');

    const chosen = await owner.call(request.method, request.path, { body: request.body });

    expect(readProviderAnswer(chosen.body)).toEqual({ needsNousAuth: true, feature: 'image_gen' });
  });

  test('keys are Tier 2: without a step-up nothing is written; with one Hermes keeps the key, and no answer, audit entry or list ever has it', async () => {
    const owner = await start({ steppedUp: false });
    const secret = 'fal-test-key-0123456789abcdef';
    const request = toolsetEnv('image_gen', 'default', { FAL_KEY: secret });

    const refused = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect((await configOf(owner, 'image_gen')).providers.find((provider) => provider.name === 'FAL.ai')!.env[0].isSet).toBe(false);
    await server!.close();

    const steppedUp = await start();
    const saved = await steppedUp.call<{ saved: string[] }>(request.method, request.path, { body: request.body });
    const listed = await steppedUp.call('GET', '/api/tools/toolsets/image_gen/config?profile=default');
    const audit = await steppedUp.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');

    expect(saved.status).toBe(200);
    expect(saved.body.saved).toEqual(['FAL_KEY']);
    expect(fs.readFileSync(path.join(hermes.home, '.env'), 'utf8')).toContain(`FAL_KEY=${secret}`);
    expect(parseToolsetConfig(listed.body).providers.find((provider) => provider.name === 'FAL.ai')).toMatchObject({ status: 'ready', env: [{ key: 'FAL_KEY', isSet: true }] });
    expect(saved.text).not.toContain(secret);
    expect(listed.text).not.toContain(secret);
    expect(audit.text).not.toContain(secret);
    expect(audit.body.entries.find((entry) => entry.action === 'PUT /api/tools/toolsets/{name}/env')).toMatchObject({ tier: 'T2', target: '/api/tools/toolsets/image_gen/env', profile: 'default' });
  });

  test('a key that is not one of the toolset’s own is refused by Hermes and an empty value leaves the saved key alone', async () => {
    const owner = await start();
    const request = toolsetEnv('image_gen', 'default', { SOME_OTHER_KEY: 'x' });

    const refused = await owner.call<{ detail: string }>(request.method, request.path, { body: request.body });
    expect(refused.status).toBe(400);
    expect(refused.body.detail).toBe('Unknown env var(s) for toolset image_gen: SOME_OTHER_KEY');

    const blank = toolsetEnv('image_gen', 'default', { FAL_KEY: '   ' });
    expect(blank.body).toEqual({ env: {} });
  });
});

describe('running a toolset’s setup', () => {
  /** The log of the action Hermes started, until it has finished: it runs `hermes tools post-setup`, a process of its own, so only the operating system says when it is done. */
  async function untilFinished(owner: Owner, name: string) {
    for (let tries = 0; tries < 200; tries++) {
      const log = readActionLog((await owner.call('GET', actionLogPath(name))).body);
      if (!log.running) return log;
      // A bounded poll of a child process of Hermes: there is no event to wait on for it.
      await sleep(100);
    }
    throw new Error('Hermes’s setup did not finish');
  }

  test('is Tier 3, blocked in read-only mode, and then Hermes runs the provider’s own setup for the profile: the log it keeps says how it went', async () => {
    const owner = await start();
    const request = toolsetPostSetup('stt', 'default', 'faster_whisper');
    const operation = `POST ${request.path}`;
    expect((await configOf(owner, 'stt')).providers.some((provider) => provider.postSetup === 'faster_whisper')).toBe(true);

    const bare = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body });
    expect(bare).toMatchObject({ status: 403, body: { error: 'confirmation-required' } });
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    const readOnly = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': 'whatever' } });
    expect(readOnly).toMatchObject({ status: 403, body: { error: 'read-only' } });
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });

    const started = await owner.call<{ ok: boolean; name: string; key: string }>(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': await owner.confirm(operation, 'stt', request.body) } });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ ok: true, name: 'tools-post-setup', key: 'faster_whisper' });
    const log = await untilFinished(owner, started.body.name);

    expect(log).toMatchObject({ running: false, exitCode: 0 });
    expect(log.lines.join('\n')).toContain("Post-setup 'faster_whisper' complete");
    expect(setupResult(log)).toEqual({ ok: true });
  });

  test('a key Hermes does not list is refused in its words, and nothing runs', async () => {
    const owner = await start();
    const request = toolsetPostSetup('stt', 'default', 'nope');

    const refused = await owner.call<{ detail: string }>(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': await owner.confirm(`POST ${request.path}`, 'stt', request.body) } });

    expect(refused.status).toBe(400);
    expect(refused.body.detail).toBe('Unknown post-setup key: nope');
  });
});

describe('toolsets per platform', () => {
  /** What Hermes's own CLI says is on for a platform: an independent reading of the same config. */
  const cliEnabled = async (platform: string): Promise<string[]> =>
    (await hermes.cli('tools', 'list', '--platform', platform))
      .split('\n')
      .flatMap((line) => /^\s+✓ enabled\s+(\S+)/.exec(line)?.[1] ?? []);

  /** Every test of the group starts with no saved list, as a fresh home has: an earlier test's lists are removed the way the page removes them. */
  async function startClean(): Promise<Owner> {
    const owner = await start();
    const saved = readPlatformToolsets((await owner.call('GET', '/api/config?profile=default')).body);
    const request = platformToolsetsUpdate('default', saved.value, {}, [], saved);
    if (request) await owner.call(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': await owner.confirm(`${request.method} ${request.path}`, 'default', request.body) } });
    return owner;
  }

  async function gridOf(owner: Owner, profile = 'default') {
    const source = readPlatformToolsets((await owner.call('GET', `/api/config?profile=${profile}`)).body);
    const toolsets = await toolsetsOf(owner, profile);
    const platforms = parseChannels((await owner.call('GET', `/api/messaging/platforms?profile=${profile}`)).body).channels;
    return { source, toolsets, grid: platformGrid(source.value, toolsets, platforms) };
  }

  test('a fresh home has no saved list: the CLI row shows what Hermes reports, and the grid offers every toolset that has tools', async () => {
    const owner = await startClean();

    const { source, grid } = await gridOf(owner);

    expect(source.value).toEqual({});
    expect(grid.rows.map((row) => row.platform)).toEqual(['cli']);
    expect(grid.rows[0].cells).toMatchObject({ web: 'on', terminal: 'on', x_search: 'off', kanban: 'off', discord: 'unavailable' });
    expect(grid.columns.map((column) => column.name)).not.toContain('stt');
    expect(grid.columns.length).toBeGreaterThanOrEqual(25);
  });

  test('saving is Tier 3 and blocked in read-only mode; then Hermes reads the platform’s list as the grid wrote it, and a toolset left unchecked stays off', async () => {
    const owner = await startClean();
    const { source, toolsets, grid } = await gridOf(owner);
    const telegram = { ...grid.rows[0], platform: 'telegram', label: 'Telegram', saved: false };
    const draft = setCell(setCell(source.value, telegram, 'x_search', true), { ...telegram, saved: true, cells: { ...telegram.cells, x_search: 'on' } }, 'web', false);
    const request = platformToolsetsUpdate('default', source.value, draft, grid.columns.map((column) => column.name), source)!;

    const bare = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body });
    expect(bare).toMatchObject({ status: 403, body: { error: 'confirmation-required' } });
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    const readOnly = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': 'whatever' } });
    expect(readOnly).toMatchObject({ status: 403, body: { error: 'read-only' } });
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
    expect(await cliEnabled('telegram')).toContain('web');

    const saved = await owner.call(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': await owner.confirm(`${request.method} ${request.path}`, 'default', request.body) } });

    expect(saved.status).toBe(200);
    const enabled = await cliEnabled('telegram');
    expect(enabled).toContain('x_search');
    expect(enabled).not.toContain('web');
    expect(enabled).toContain('terminal');
    expect(enabled).not.toContain('kanban');
    expect(enabled).not.toContain('a2a');
    // Only that platform changed: the CLI still has what Hermes reports.
    expect((await toolsetsOf(owner)).find((toolset) => toolset.name === 'web')!.enabled).toBe(true);
    const after = await gridOf(owner);
    expect(after.grid.rows.map((row) => row.platform)).toEqual(['cli', 'telegram']);
    expect(after.grid.rows[1].cells).toMatchObject({ web: 'off', x_search: 'on', terminal: 'on', discord: 'unavailable' });
    expect(toolsets.length).toBe(after.toolsets.length);
  });

  test('the advanced JSON is the same value: what it holds saves to the same list, and dropping a platform in it puts Hermes’s default back', async () => {
    const owner = await startClean();
    const before = await gridOf(owner);
    const names = before.grid.columns.map((column) => column.name);
    const written = parsePlatformJson('{"telegram": ["terminal", "file"], "slack": ["web"]}');
    expect(written.ok).toBe(true);
    const save = async (saved: typeof before.source, value: Record<string, string[]>) => {
      const request = platformToolsetsUpdate('default', saved.value, value, names, saved)!;
      return owner.call(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': await owner.confirm(`${request.method} ${request.path}`, 'default', request.body) } });
    };

    expect((await save(before.source, written.ok ? written.value : {})).status).toBe(200);
    expect((await cliEnabled('telegram')).sort()).toEqual(['file', 'terminal']);
    expect(await cliEnabled('slack')).toEqual(['web']);
    const mid = await gridOf(owner);
    expect(mid.source.value).toEqual({ telegram: ['file', 'terminal'], slack: ['web'] });

    expect((await save(mid.source, { telegram: ['file', 'terminal'] })).status).toBe(200);
    const end = await gridOf(owner);
    expect(end.source.value).toEqual({ telegram: ['file', 'terminal'] });
    expect(await cliEnabled('slack')).toContain('terminal');
    expect(await cliEnabled('slack')).toContain('web');
  }, HERMES_WORK_TIMEOUT_MS);
});

describe('how tools are routed', () => {
  test('the Tool gateway card is what Hermes reports of the Nous Portal and of where each kind of tool comes from, and it is never kept by a cache', async () => {
    const owner = await start();

    const answer = await owner.call('GET', '/api/portal?profile=default');
    const portal = parsePortal(answer.body);

    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(portal).toMatchObject({ loggedIn: false, freeTier: false, subscriptionUrl: 'https://portal.nousresearch.com/manage-subscription' });
    expect(portal.features.map((feature) => feature.label)).toEqual(expect.arrayContaining(['Web tools', 'Image generation', 'Video generation', 'Speech-to-text', 'Browser automation', 'Modal execution']));
    // What each feature says depends on what the profile has chosen; speech-to-text runs locally in any fresh home.
    expect(portal.features).toContainEqual({ label: 'Speech-to-text', state: 'Local faster-whisper', viaPortal: false });
    expect(portal.features.every((feature) => feature.state !== '')).toBe(true);
  });

  test('computer use is Hermes’s status for the profile; granting its permissions is Tier 3 and blocked in read-only mode, and is never run here', async () => {
    const owner = await start();

    const answer = await owner.call('GET', '/api/tools/computer-use/status?profile=default');
    const status = parseComputerUse(answer.body);

    expect(answer.status).toBe(200);
    // Whether the driver is installed and has its permissions is a fact of the machine under test, so the expectation is Hermes's own answer.
    const hermesStatus = (await (await hermes.backend.fetch('/api/tools/computer-use/status?profile=default')).json()) as { installed: boolean; ready?: boolean | null };
    expect(status).toMatchObject({ platform: 'darwin', supported: true, canGrant: true, installed: hermesStatus.installed });
    expect(status.state).toBe(!hermesStatus.installed ? 'not-installed' : hermesStatus.ready === true ? 'ready' : hermesStatus.ready === false ? 'needs-permission' : 'unknown');
    const request = computerUseGrant('default');
    const bare = await owner.call<PolicyRefusal>(request.method, request.path);
    expect(bare).toMatchObject({ status: 403, body: { error: 'confirmation-required' } });
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    const readOnly = await owner.call<PolicyRefusal>(request.method, request.path, { headers: { 'x-caduceus-confirmation': 'whatever' } });
    expect(readOnly).toMatchObject({ status: 403, body: { error: 'read-only' } });
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
  });
});
