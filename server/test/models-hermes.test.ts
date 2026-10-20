import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { parseCatalogue, recommendedProvider, searchCatalogue, type ModelChoice } from '../../web/src/modules/models/model-catalogue.ts';
import { auxiliaryModelRequest, AUTO, type Auxiliary, mainModelRequest, parseAuxiliary, readReasoning, readSetAnswer, readModelInfo, readRecommended, REASONING_LEVELS, reasoningRequest, recommendedDefaultPath, resetAuxiliaryRequest } from '../../web/src/modules/models/model-settings.ts';
import { parseUsage, usagePath } from '../../web/src/modules/models/usage.ts';
import { addEntry, entryProblems, fallbackWriteRequest, moveEntry, parseFallback, removeEntry, settingsWriteRequest, turnOffEntry, turnOnEntry } from '../../web/src/modules/models/fallback.ts';
import { moaSaveRequest, parseMoa, presetProblems, removePreset, savePreset, type Moa, type MoaPreset, type MoaSlot } from '../../web/src/modules/models/moa.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedUsage } from './fixtures/seed-session.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Agents › Models (M4 #03) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME with a second
// profile. The page's own reading code (`web/src/modules/models/`) is run over what Hermes really answers.
//
// Hermes 0.21.4 breaks every later auxiliary-model call after a profile-scoped read (`?profile=`) that came before the process's
// first model call (`UnscopedSecretError`, see M4 #01). Nothing here makes a model call, so nothing here can meet it.
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

async function start(target: TestHermes = hermes): Promise<Owner> {
  server = await startCaduceusServer({ backend: target.backend, hermesRoot: target.home });
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

describe('the catalogue', () => {
  test('lists Hermes\'s live providers and models for the profile, with Hermes\'s own capability flags, and search narrows it', async () => {
    const owner = await start();
    const answer = await owner.call('GET', '/api/model/options?profile=coder&include_unconfigured=true');
    expect(answer.status).toBe(200);
    const catalogue = parseCatalogue(answer.body);

    const anthropic = catalogue.providers.find((p) => p.slug === 'anthropic')!;
    expect(anthropic).toMatchObject({ name: 'Anthropic', state: 'ready' });
    // `claude-opus-5` supports Hermes's fast mode and reasoning (its capability flags), and is one of the models Hermes lists.
    expect(anthropic.models.find((m) => m.id === 'claude-opus-5')!.badges.map((b) => b.id)).toEqual(['reasoning', 'fast']);
    // A provider the profile has no credential for is listed, and says what it needs.
    expect(catalogue.providers.find((p) => p.slug === 'fireworks')).toMatchObject({ state: 'needs-setup', note: 'paste FIREWORKS_API_KEY to activate', models: [] });

    // Search keeps the models whose id holds every word (case ignored), and drops the providers left with none.
    const found = searchCatalogue(catalogue, 'OPUS-5');
    expect(found.map((p) => p.slug)).toEqual(['anthropic']);
    const opusIds = anthropic.models.map((m) => m.id).filter((id) => id.toLowerCase().includes('opus-5'));
    expect(opusIds).toContain('claude-opus-5');
    expect(found[0].models.map((m) => m.id)).toEqual(opusIds);
    // A provider's own name keeps all its models.
    expect(searchCatalogue(catalogue, 'anthro')[0].models).toHaveLength(anthropic.models.length);
  });

  test('Refresh asks Hermes again; an endpoint of the owner\'s own is labelled as a saved list, not hidden, and belongs to its profile only', async () => {
    const owner = await start();
    // Seeded through Hermes's own config API, as the CLI would: `coder` has an endpoint that nothing listens on.
    const seeded = await hermes.backend.fetch('/api/config?profile=coder', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { custom_providers: [{ name: 'Dead box', base_url: 'http://127.0.0.1:9/v1', api_key: 'x', model: 'dead-model', models: { 'dead-model': {}, 'dead-2': {} } }] } }),
    });
    expect(seeded.status).toBe(200);

    const refreshed = parseCatalogue((await owner.call('GET', '/api/model/options?profile=coder&refresh=true&include_unconfigured=true')).body);
    const dead = refreshed.providers.find((p) => p.slug === 'custom:dead-box')!;
    expect(dead).toMatchObject({ name: 'Dead box', state: 'saved-list' });
    expect(dead.models.map((m) => m.id).sort()).toEqual(['dead-2', 'dead-model']);
    expect(dead.note).toContain('may be out of date');
    // The other profile never had it.
    const other = parseCatalogue((await owner.call('GET', '/api/model/options?profile=default&include_unconfigured=true')).body);
    expect(other.providers.map((p) => p.slug)).not.toContain('custom:dead-box');
  });
});

describe('the main model', () => {
  const coderConfig = () => fs.readFileSync(path.join(hermes.home, 'profiles', 'coder', 'config.yaml'), 'utf8');
  const mainOf = async (owner: Owner, profile: string) => parseAuxiliary((await owner.call('GET', `/api/model/auxiliary?profile=${profile}`)).body).main;

  test('is set for one profile through Hermes: its own config.yaml has it, another profile\'s does not, and a reload reads it back from Hermes', async () => {
    const owner = await start();
    expect(await mainOf(owner, 'coder')).toEqual({ provider: '', model: '' });

    const request = mainModelRequest('coder', { provider: 'anthropic', model: 'claude-sonnet-5' });
    const saved = await owner.call(request.method, request.path, { body: request.body });
    expect(saved.status).toBe(200);
    expect(readSetAnswer(saved.body)).toEqual({ kind: 'saved' });

    expect(await mainOf(owner, 'coder')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(coderConfig()).toContain('default: claude-sonnet-5');
    expect(await mainOf(owner, 'default')).toEqual({ provider: '', model: '' });
    // The picker marks it as the one in use.
    expect(parseCatalogue((await owner.call('GET', '/api/model/options?profile=coder')).body).current).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
  });

  test('an expensive model is not set until Hermes\'s warning is confirmed; confirming sends it again with the flag', async () => {
    const owner = await start();
    const expensive: ModelChoice = { provider: 'openrouter', model: 'openai/gpt-5.5-pro' };

    const first = mainModelRequest('coder', expensive);
    const asked = await owner.call(first.method, first.path, { body: first.body });
    const answer = readSetAnswer(asked.body);
    expect(answer.kind).toBe('confirm');
    expect(answer.kind === 'confirm' && answer.message).toContain('EXPENSIVE MODEL WARNING');
    expect((await mainOf(owner, 'coder')).model).not.toBe('openai/gpt-5.5-pro');

    const second = mainModelRequest('coder', expensive, { confirmExpensive: true });
    expect(readSetAnswer((await owner.call(second.method, second.path, { body: second.body })).body)).toEqual({ kind: 'saved' });
    expect(await mainOf(owner, 'coder')).toEqual(expensive);
  });

  test('with nothing set, the page offers Hermes\'s recommended default for the first provider the profile can use', async () => {
    const owner = await start();
    const made = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'fresh' }) });
    expect(made.status).toBe(200);
    expect(await mainOf(owner, 'fresh')).toEqual({ provider: '', model: '' });

    const catalogue = parseCatalogue((await owner.call('GET', '/api/model/options?profile=fresh&include_unconfigured=true')).body);
    const provider = recommendedProvider(catalogue)!;
    expect(provider).toBe('anthropic');
    const asked = await owner.call('GET', recommendedDefaultPath('fresh', provider));
    // Caduceus passes on what Hermes recommends, as Hermes says it, and the recommendation is one of the models Hermes lists for that provider.
    const hermesSays = (await (await hermes.backend.fetch(recommendedDefaultPath('fresh', provider))).json()) as { provider: string; model: string };
    expect(hermesSays.model).not.toBe('');
    expect(readRecommended(asked.body)).toEqual({ provider: 'anthropic', model: hermesSays.model });
    expect(catalogue.providers.find((p) => p.slug === provider)!.models.map((m) => m.id)).toContain(hermesSays.model);
    // A provider Hermes has no recommendation for gives none.
    expect(readRecommended((await owner.call('GET', recommendedDefaultPath('fresh', 'no-such-provider'))).body)).toBeUndefined();
  });

  test('shows what Hermes knows about the model in use: its context window and capabilities', async () => {
    const owner = await start();
    const request = mainModelRequest('fresh', { provider: 'anthropic', model: 'claude-opus-5' });
    await owner.call(request.method, request.path, { body: request.body });

    const info = readModelInfo((await owner.call('GET', '/api/model/info?profile=fresh')).body)!;
    expect(info).toMatchObject({ model: 'claude-opus-5', provider: 'anthropic', contextWindow: 1_000_000, maxOutput: 128_000 });
    expect(info.badges.map((badge) => badge.id)).toEqual(['tools', 'vision', 'reasoning']);
    // Nothing set: nothing to show.
    expect(readModelInfo((await owner.call('GET', '/api/model/info?profile=default')).body)).toBeUndefined();
  });
});

describe('the reasoning default', () => {
  const reasoningOf = async (owner: Owner, profile: string) => readReasoning((await owner.call('GET', `/api/config?profile=${profile}`)).body);

  test('is a config write: Tier 3, so it needs the typed confirmation; it lands in the one profile\'s config.yaml and a reload reads it from Hermes', async () => {
    const owner = await start();
    const request = reasoningRequest('coder', 'high');
    expect(await reasoningOf(owner, 'coder')).toBe('');

    const unconfirmed = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body });
    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.body.error).toBe('confirmation-required');
    expect(await reasoningOf(owner, 'coder')).toBe('');

    const token = await owner.confirm(`${request.method} ${request.path}`, 'coder', request.body);
    expect((await owner.call(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': token } })).status).toBe(200);
    expect(await reasoningOf(owner, 'coder')).toBe('high');
    expect(await reasoningOf(owner, 'default')).toBe('');
    expect(fs.readFileSync(path.join(hermes.home, 'profiles', 'coder', 'config.yaml'), 'utf8')).toContain('reasoning_effort: high');
  });

  test('is blocked in read-only mode before Hermes is asked', async () => {
    const owner = await start();
    const request = reasoningRequest('coder', 'low');
    const before = await reasoningOf(owner, 'coder');
    expect((await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } })).status).toBe(200);

    const token = await owner.confirm(`${request.method} ${request.path}`, 'coder', request.body);
    const refused = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': token } });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('read-only');
    expect(await reasoningOf(owner, 'coder')).toBe(before);
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
  });

  test('the levels the screen offers are the ones Hermes accepts for a reasoning effort', async () => {
    const schema = (await (await hermes.backend.fetch('/api/config/schema')).json()) as { fields: Record<string, { options: string[] }> };
    expect(REASONING_LEVELS.map((level) => level.value)).toEqual(schema.fields['delegation.reasoning_effort'].options);
  });
});

describe('the auxiliary slots', () => {
  // The slots Hermes reports (`_AUX_TASK_SLOTS` in hermes_cli/web_server_config.py) change with its releases: the expectation is Hermes's own answer, read
  // without the page's code, and a few slots that every release has.
  const reported = async (profile: string) => ((await (await hermes.backend.fetch(`/api/model/auxiliary?profile=${profile}`)).json()) as { tasks: { task: string }[] }).tasks.map((slot) => slot.task);
  const read = async (owner: Owner, profile: string) => parseAuxiliary((await owner.call('GET', `/api/model/auxiliary?profile=${profile}`)).body);
  const send = (owner: Owner, request: { method: string; path: string; body: Record<string, unknown> }) => owner.call(request.method, request.path, { body: request.body });
  const pinned = (aux: Auxiliary) => Object.fromEntries(aux.slots.filter((slot) => !slot.isAuto).map((slot) => [slot.task, `${slot.provider}/${slot.model}`]));

  test('lists every slot Hermes reports, in its order, each on auto until the owner pins a model', async () => {
    const owner = await start();
    const aux = await read(owner, 'coder');
    const slots = await reported('coder');
    expect(slots).toEqual(expect.arrayContaining(['vision', 'compression', 'title_generation']));
    expect(aux.slots.map((slot) => slot.task)).toEqual(slots);
    expect(pinned(aux)).toEqual({});
  });

  test('setting one slot changes only that slot, in that profile; putting it back on auto clears it', async () => {
    const owner = await start();
    const haiku: ModelChoice = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
    const mainBefore = (await read(owner, 'coder')).main;
    expect(readSetAnswer((await send(owner, auxiliaryModelRequest('coder', 'vision', haiku))).body)).toEqual({ kind: 'saved' });
    expect(pinned(await read(owner, 'coder'))).toEqual({ vision: 'anthropic/claude-haiku-4-5-20251001' });
    expect(pinned(await read(owner, 'default'))).toEqual({});
    // The main model is not touched by an auxiliary slot.
    expect((await read(owner, 'coder')).main).toEqual(mainBefore);

    await send(owner, auxiliaryModelRequest('coder', 'vision', AUTO));
    expect(pinned(await read(owner, 'coder'))).toEqual({});
  });

  test('Reset all to auto clears every override', async () => {
    const owner = await start();
    await send(owner, auxiliaryModelRequest('coder', 'vision', { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }));
    await send(owner, auxiliaryModelRequest('coder', 'compression', { provider: 'anthropic', model: 'claude-sonnet-4-6' }));
    expect(Object.keys(pinned(await read(owner, 'coder'))).sort()).toEqual(['compression', 'vision']);

    expect((await send(owner, resetAuxiliaryRequest('coder'))).status).toBe(200);
    expect(pinned(await read(owner, 'coder'))).toEqual({});
  });
});

describe('Mixture-of-Agents presets', () => {
  const read = async (owner: Owner, profile: string) => parseMoa((await owner.call('GET', `/api/model/moa?profile=${profile}`)).body);
  const save = (owner: Owner, request: { method: string; path: string; body: Record<string, unknown> }) => owner.call(request.method, request.path, { body: request.body });
  const opus: MoaSlot = { provider: 'anthropic', model: 'claude-opus-5', enabled: true };
  const sonnet = { provider: 'anthropic', model: 'claude-sonnet-5' };

  test('lists what Hermes holds: with nothing saved, Hermes\'s own default preset, which is the default one', async () => {
    const owner = await start();
    const moa = await read(owner, 'coder');
    expect(moa.defaultPreset).toBe('default');
    expect(moa.presets.map((preset) => preset.name)).toEqual(['default']);
    expect(moa.presets[0]).toMatchObject({
      enabled: true,
      references: [
        { provider: 'openai-codex', model: 'gpt-5.5', enabled: true },
        { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', enabled: true },
      ],
      aggregator: { provider: 'openrouter', model: 'anthropic/claude-opus-4.8' },
      fanout: 'user_turn',
    });
  });

  test('saves a new preset and makes it the default; a reload reads both back from Hermes, and another profile has neither', async () => {
    const owner = await start();
    const before = await read(owner, 'coder');
    const deep: MoaPreset = { ...before.presets[0], name: 'deep', references: [opus, { provider: 'openrouter', model: 'x/y', enabled: false }], aggregator: { ...sonnet, enabled: true }, referenceTemperature: 0.5, fanout: 'every_n:3' };

    const request = moaSaveRequest('coder', savePreset(before, deep, { makeDefault: true }));
    expect(request.path).toBe('/api/model/moa?profile=coder');
    expect((await save(owner, request)).status).toBe(200);

    const after = await read(owner, 'coder');
    expect(after.defaultPreset).toBe('deep');
    expect(after.presets.map((preset) => preset.name)).toEqual(['default', 'deep']);
    expect(after.presets[1]).toMatchObject({ references: [opus, { provider: 'openrouter', model: 'x/y', enabled: false }], aggregator: { ...sonnet, enabled: true }, referenceTemperature: 0.5, fanout: 'every_n:3' });
    expect(await read(owner, 'default')).toMatchObject({ defaultPreset: 'default', presets: [{ name: 'default' }] });
  });

  test('a preset Hermes would refuse is caught first with the reasons in plain words, and Hermes keeps what it had', async () => {
    const owner = await start();
    const before = await read(owner, 'coder');
    const broken: MoaPreset = { ...before.presets[0], name: 'broken', references: [{ provider: 'anthropic', model: '', enabled: true }], aggregator: { provider: 'moa', model: 'x', enabled: true } };

    expect(presetProblems(before, broken)).toEqual(['Reference model 1 has no model.', 'The aggregator cannot be a Mixture-of-Agents preset.']);
    expect(presetProblems(before, { ...before.presets[0], name: '  ' })).toEqual(['Give the preset a name.']);
    expect(presetProblems(before, { ...before.presets[0], references: [{ ...opus, enabled: false }] })).toEqual(['Turn on at least one reference model.']);
    expect(presetProblems(before, { ...before.presets[0] })).toEqual([]);

    // Hermes itself refuses the same preset, and nothing it holds changes.
    const refused = await save(owner, moaSaveRequest('coder', savePreset(before, broken)));
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('model is required');
    expect(await read(owner, 'coder')).toEqual(before);
  });

  test('Delete leaves the preset out of the save, which Hermes keeps as the whole list, and hands the default on', async () => {
    const owner = await start();
    const made = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'turnoff' }) });
    expect(made.status).toBe(200);
    const first = await read(owner, 'turnoff');
    const deep: MoaPreset = { ...first.presets[0], name: 'deep', references: [opus], aggregator: { ...sonnet, enabled: true } };
    await save(owner, moaSaveRequest('turnoff', savePreset(first, deep, { makeDefault: true })));
    const withDeep = await read(owner, 'turnoff');
    expect(withDeep.defaultPreset).toBe('deep');

    const removed = removePreset(withDeep, 'deep');
    expect(removed).toMatchObject({ ok: true });
    await save(owner, moaSaveRequest('turnoff', (removed as { ok: true; moa: Moa }).moa));
    const after = await read(owner, 'turnoff');
    expect(after.presets.map((preset) => preset.name)).toEqual(['default']);
    expect(after.defaultPreset).toBe('default');
    // The last preset cannot be removed (Hermes would put its own default back).
    expect(removePreset(after, 'default')).toEqual({ ok: false, reason: 'This is the only preset. Add another preset before you remove it.' });
  });

  test('a preset that is off can be deleted, and the last one that is on cannot', () => {
    const base: MoaPreset = { name: '', enabled: true, references: [opus], aggregator: { ...sonnet, enabled: true }, referenceTemperature: undefined, aggregatorTemperature: undefined, referenceTimeout: undefined, degradedPolicy: 'loud', fanout: 'user_turn' };
    const on: MoaPreset = { ...base, name: 'on' };
    const off: MoaPreset = { ...base, name: 'off', enabled: false };
    const moa: Moa = { defaultPreset: 'on', activePreset: 'off', presets: [on, off] };
    expect(removePreset(moa, 'on')).toEqual({ ok: false, reason: 'This is the only preset that is on. Add another preset before you remove it.' });
    expect(removePreset(moa, 'off')).toEqual({ ok: true, moa: { defaultPreset: 'on', activePreset: '', presets: [on] } });
    expect(removePreset(moa, 'nope')).toEqual({ ok: false, reason: 'There is no preset called “nope”.' });
  });
});

describe('the fallback chain', () => {
  const configOf = async (owner: Owner, profile: string) => (await owner.call('GET', `/api/config?profile=${profile}`)).body;
  const readChain = async (owner: Owner, profile: string) => parseFallback(await configOf(owner, profile));
  const seed = async (profile: string, config: Record<string, unknown>) => {
    const res = await hermes.backend.fetch(`/api/config?profile=${profile}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }) });
    expect(res.status).toBe(200);
  };
  const write = async (owner: Owner, request: { method: string; path: string; body: Record<string, unknown> }, target: string) => {
    const token = await owner.confirm(`${request.method} ${request.path}`, target, request.body);
    return owner.call(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': token } });
  };

  test('reads what Hermes holds: the chain in order with endpoint overrides, entries turned off, a legacy single fallback, and the retry settings', async () => {
    const owner = await start();
    const made = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'chain' }) });
    expect(made.status).toBe(200);
    expect(await readChain(owner, 'chain')).toMatchObject({ chain: [], parked: [], legacy: [], settings: { apiMaxRetries: 3, autoRecoveryCycles: 5, minSwitchResetSeconds: 0 } });

    await seed('chain', {
      fallback_providers: [
        { provider: 'anthropic', model: 'claude-sonnet-5' },
        { provider: 'openrouter', model: 'x/y', base_url: 'https://gateway.example.test/v1', reasoning_echo: true },
      ],
      fallback_providers_disabled: [{ provider: 'zai', model: 'glm-5' }],
      fallback_model: { provider: 'openai-codex', model: 'gpt-5.5' },
      agent: { api_max_retries: 1, auto_recovery_cycles: 2 },
      fallback: { min_switch_reset_seconds: 30 },
    });
    const state = await readChain(owner, 'chain');
    expect(state.chain).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet-5', baseUrl: '', extra: {} },
      { provider: 'openrouter', model: 'x/y', baseUrl: 'https://gateway.example.test/v1', extra: { reasoning_echo: true } },
    ]);
    expect(state.parked).toEqual([{ provider: 'zai', model: 'glm-5', baseUrl: '', extra: {} }]);
    expect(state.legacy).toEqual([{ provider: 'openai-codex', model: 'gpt-5.5', baseUrl: '', extra: {} }]);
    expect(state.settings).toEqual({ apiMaxRetries: 1, autoRecoveryCycles: 2, minSwitchResetSeconds: 30 });
  });

  test('saving reorders, turns off and removes entries as one config write (Tier 3): unconfirmed it is refused, confirmed it lands in that profile\'s config.yaml, extra keys survive, a reload reads it back', async () => {
    const owner = await start();
    const start0 = await readChain(owner, 'chain');
    // chain: anthropic, openrouter(+endpoint, reasoning_echo); parked: zai
    // openrouter moved first, anthropic turned off, zai turned on.
    const edited = turnOnEntry(turnOffEntry(moveEntry(start0, 1, -1), 1), 0);
    expect(edited.chain.map((e) => e.provider)).toEqual(['openrouter', 'zai']);
    expect(edited.parked.map((e) => e.provider)).toEqual(['anthropic']);

    const request = fallbackWriteRequest('chain', edited);
    expect(request).toMatchObject({ method: 'PUT', path: '/api/config?profile=chain' });
    const unconfirmed = await owner.call<PolicyRefusal>(request.method, request.path, { body: request.body });
    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.body.error).toBe('confirmation-required');
    expect(await readChain(owner, 'chain')).toEqual(start0);

    expect((await write(owner, request, 'chain')).status).toBe(200);
    const after = await readChain(owner, 'chain');
    expect(after.chain).toEqual(edited.chain);
    expect(after.chain[0]).toMatchObject({ provider: 'openrouter', baseUrl: 'https://gateway.example.test/v1', extra: { reasoning_echo: true } });
    expect(after.parked).toEqual(edited.parked);
    expect(after.legacy).toEqual(start0.legacy);
    const yaml = fs.readFileSync(path.join(hermes.home, 'profiles', 'chain', 'config.yaml'), 'utf8');
    expect(yaml).toContain('fallback_providers:');
    expect(yaml).toContain('base_url: https://gateway.example.test/v1');
    expect(yaml).toContain('reasoning_echo: true');
    // Another profile has no chain.
    expect((await readChain(owner, 'default')).chain).toEqual([]);

    // Removing an entry drops it for good, from the chain or from the ones turned off.
    const trimmed = removeEntry(removeEntry(after, 'parked', 0), 'chain', 1);
    expect((await write(owner, fallbackWriteRequest('chain', trimmed), 'chain')).status).toBe(200);
    expect(await readChain(owner, 'chain')).toMatchObject({ chain: [{ provider: 'openrouter' }], parked: [] });
  });

  test('adds an entry from the catalogue or a custom one, refusing a repeat or a bad endpoint; the retry settings are a config write too, blocked in read-only mode', async () => {
    const owner = await start();
    const before = await readChain(owner, 'chain');
    expect(entryProblems(before, { provider: 'openrouter', model: 'x/y', baseUrl: '' })).toEqual([]);
    expect(entryProblems(before, { provider: 'openrouter', model: 'x/y', baseUrl: 'https://gateway.example.test/v1/' })).toEqual(['That model is already in the chain with that endpoint.']);
    expect(entryProblems(before, { provider: 'custom', model: 'local-1', baseUrl: 'ftp://nope' })).toEqual(['The endpoint must start with http:// or https://.']);
    expect(entryProblems(before, { provider: 'custom', model: '', baseUrl: '' })).toEqual(['Choose or type a model.']);
    expect(entryProblems(before, { provider: ' ', model: 'm', baseUrl: '' })).toEqual(['Choose or type a provider.']);

    const grown = addEntry(before, { provider: 'custom', model: 'local-1', baseUrl: 'http://127.0.0.1:11434/v1/' });
    expect(grown.chain.at(-1)).toEqual({ provider: 'custom', model: 'local-1', baseUrl: 'http://127.0.0.1:11434/v1', extra: {} });
    expect((await write(owner, fallbackWriteRequest('chain', grown), 'chain')).status).toBe(200);
    expect((await readChain(owner, 'chain')).chain.map((e) => e.model)).toEqual(['x/y', 'local-1']);

    const settings = settingsWriteRequest('chain', { apiMaxRetries: 2, autoRecoveryCycles: 0, minSwitchResetSeconds: 45 });
    expect((await owner.call<PolicyRefusal>(settings.method, settings.path, { body: settings.body })).status).toBe(403);
    expect((await write(owner, settings, 'chain')).status).toBe(200);
    expect((await readChain(owner, 'chain')).settings).toEqual({ apiMaxRetries: 2, autoRecoveryCycles: 0, minSwitchResetSeconds: 45 });
    // Only those keys changed.
    expect((await readChain(owner, 'chain')).chain).toHaveLength(2);

    expect((await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } })).status).toBe(200);
    const request = fallbackWriteRequest('chain', removeEntry(grown, 'chain', 0));
    const refused = await write(owner, request, 'chain');
    expect(refused.status).toBe(403);
    expect((refused.body as PolicyRefusal).error).toBe('read-only');
    expect((await readChain(owner, 'chain')).chain).toHaveLength(2);
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
  });
});

describe('usage cards', () => {
  // Hermes reads capabilities (context window, tools, vision, reasoning) from its models.dev cache on disk. This home gets a cache of
  // its own before Hermes first reads it, so the numbers do not depend on the network or on what another test warmed.
  let usageHermes: TestHermes;
  beforeAll(async () => {
    usageHermes = await launchTestHermes();
    fs.writeFileSync(
      path.join(usageHermes.home, 'models_dev_cache.json'),
      JSON.stringify({ anthropic: { id: 'anthropic', name: 'Anthropic', env: ['ANTHROPIC_API_KEY'], models: { 'claude-opus-5': { id: 'claude-opus-5', family: 'claude-opus', attachment: true, reasoning: true, tool_call: true, modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 1_000_000, output: 128_000 } } } } }),
    );
    await usageHermes.backend.ready();
  }, 90_000);
  afterAll(async () => {
    await usageHermes.stop();
  });

  test('show Hermes\'s numbers for the chosen period: requests, tokens, cost marked billed or estimated or left out, context window and capabilities', async () => {
    const owner = await start(usageHermes);
    seedUsage(usageHermes.home, [
      { id: 'u-opus', model: 'claude-opus-5', provider: 'anthropic', inputTokens: 1200, outputTokens: 800, apiCalls: 5, estimatedCost: 0.12 },
      { id: 'u-billed', model: 'gpt-5.5', provider: 'openai-codex', inputTokens: 300, outputTokens: 100, apiCalls: 2, estimatedCost: 0.02, actualCost: 0.5 },
      { id: 'u-free', model: 'qwen-local', provider: 'llamacpp', inputTokens: 50, outputTokens: 10, apiCalls: 1 },
      { id: 'u-old', model: 'claude-haiku-4-5-20251001', provider: 'anthropic', inputTokens: 90, outputTokens: 10, apiCalls: 1, estimatedCost: 0.01, daysOld: 20 },
      { id: 'u-older', model: 'claude-sonnet-4-6', provider: 'anthropic', inputTokens: 70, outputTokens: 5, apiCalls: 1, estimatedCost: 0.01, daysOld: 60 },
    ]);
    const cards = async (days: 7 | 30 | 90) => parseUsage((await owner.call('GET', usagePath('default', days))).body);

    const week = await cards(7);
    expect(week.days).toBe(7);
    expect(week.cards.map((card) => card.model)).toEqual(['claude-opus-5', 'gpt-5.5', 'qwen-local']);
    const [opus, billed, free] = week.cards;
    expect(opus).toMatchObject({ provider: 'anthropic', requests: 5, inputTokens: 1200, outputTokens: 800, cost: { usd: 0.12, kind: 'estimated' }, contextWindow: 1_000_000 });
    expect(opus.badges.map((badge) => badge.id)).toEqual(['tools', 'vision', 'reasoning']);
    // What the provider billed wins over Hermes's estimate, and is not marked as one.
    expect(billed.cost).toEqual({ usd: 0.5, kind: 'billed' });
    // No cost from Hermes, none shown.
    expect(free.cost).toBeUndefined();

    expect((await cards(30)).cards.map((card) => card.model)).toEqual(['claude-opus-5', 'gpt-5.5', 'claude-haiku-4-5-20251001', 'qwen-local']);
    expect((await cards(90)).cards).toHaveLength(5);
    // Another profile has its own usage.
    expect(parseUsage((await owner.call('GET', usagePath('coder', 30))).body).cards).toEqual([]);
  });
});
