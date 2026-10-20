import YAML from 'yaml';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import { CONFIG_SECRET_MASK } from '@caduceus/contracts/config-keys';
import { changeRows, checkConfigYaml, exportFile, migrateOutput, rawSaveRequest, resetConfig } from '../../web/src/modules/config/config-yaml.ts';
import { buildConfigForm, configUpdateRequest, diffRows, matchingFields, stageValue, type ConfigValue } from '../../web/src/modules/config/config-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// System › Config (M5 #08) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME: what the page is
// given to build its form from, and what a save does. The page's own model (`web/src/modules/config/config-model.ts`) is run over
// what Hermes really answers.
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
  // Each test starts from a fresh config: what one saved is not what the next one reads.
  fs.rmSync(path.join(hermes.home, 'config.yaml'), { force: true });
});

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T; text: string }>;
}

async function start({ steppedUp = false }: { steppedUp?: boolean } = {}): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  return {
    async call(method, route, { body, headers } = {}) {
      const res = await fetch(`${url}${route}`, {
        method,
        headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, text, body: (text.startsWith('{') ? JSON.parse(text) : text) as never };
    },
  };
}

/** Writes straight to Hermes, as the owner's CLI would: the way a secret gets into the config of the temp home. */
async function seed(config: Record<string, unknown>): Promise<void> {
  const res = await hermes.backend.fetch('/api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }) });
  expect(res.status).toBe(200);
}

describe('the config the page reads', () => {
  test('carries no secret: a credential that is set is a mask, one that is not stays empty, and everything else is Hermes’s own value', async () => {
    await seed({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, dashboard: { basic_auth: { password: 'hunter2-hunter2' } }, display: { compact: true } });
    const owner = await start();

    const answer = await owner.call<{ auxiliary: { vision: { api_key: string }; curator: { api_key: string } }; dashboard: { basic_auth: { password: string; secret: string } }; display: { compact: boolean }; voice: { record_key: string } }>('GET', '/api/config?profile=default');

    expect(answer.status).toBe(200);
    expect(answer.text).not.toContain('sk-live-secret-value');
    expect(answer.text).not.toContain('hunter2-hunter2');
    expect(answer.body.auxiliary.vision.api_key).toBe(CONFIG_SECRET_MASK);
    expect(answer.body.dashboard.basic_auth.password).toBe(CONFIG_SECRET_MASK);
    expect(answer.body.auxiliary.curator.api_key).toBe('');
    expect(answer.body.dashboard.basic_auth.secret).toBe('');
    expect(answer.body.display.compact).toBe(true);
    // A name that only ends like a secret's is not one.
    expect(answer.body.voice.record_key).toBe('ctrl+b');
  });
});

/** The form for `profile`, made by the page's own code from what Caduceus answers. */
async function loadForm(owner: Owner, profile = 'default') {
  const read = async (route: string) => (await owner.call('GET', route)).body;
  const scoped = `?profile=${profile}`;
  const [schema, defaults, current, saved] = await Promise.all([read(`/api/config/schema${scoped}`), read('/api/config/defaults'), read(`/api/config${scoped}`), read(`/api/config${scoped}&include_defaults=false`)]);
  return { form: buildConfigForm({ schema, defaults, current, saved }), schema: schema as { fields: Record<string, unknown> } };
}

describe('the form over the real Hermes', () => {
  test('has a field for every key Hermes’s schema names, and in a fresh home nothing is modified or set by the profile', async () => {
    const owner = await start();

    const { form, schema } = await loadForm(owner);

    expect(form.fields.map((field) => field.key).sort()).toEqual(Object.keys(schema.fields).sort());
    expect(form.fields.length).toBeGreaterThan(500);
    expect(form.sections[0]).toMatchObject({ id: 'general', title: 'General' });
    expect(matchingFields(form.fields, { text: '', filters: ['modified'] }, new Set()).map((field) => field.key)).toEqual([]);
    expect(matchingFields(form.fields, { text: '', filters: ['profile'] }, new Set()).map((field) => field.key)).toEqual([]);
    // The only key the form cannot edit is one whose value Hermes keeps as a list of tables.
    expect(form.fields.filter((field) => field.readOnlyReason).map((field) => field.key)).toEqual(['moa.presets.default.reference_models']);
    expect(form.fields.find((field) => field.key === 'agent.max_turns')).toMatchObject({ kind: 'string', value: null, default: null });
    expect(form.fields.find((field) => field.key === 'gateway.restart_loop_guard.max_restarts')).toMatchObject({ restartRequired: true });
  });

  test('a save of staged edits is Tier 3 with a typed confirmation, lands in Hermes’s config, shows in the form as modified and set by the profile, and is audited by key', async () => {
    const owner = await start({ steppedUp: true });
    const { form } = await loadForm(owner);
    const field = (key: string) => form.fields.find((candidate) => candidate.key === key)!;
    let pending: ReadonlyMap<string, ConfigValue> = new Map();
    pending = stageValue(pending, field('display.compact'), true);
    pending = stageValue(pending, field('delegation.reasoning_effort'), 'high');
    pending = stageValue(pending, field('toolsets'), ['hermes-cli', 'web']);
    pending = stageValue(pending, field('auxiliary.vision.api_key'), 'sk-real-secret-value');
    const request = configUpdateRequest('default', pending);

    const refused = await owner.call('PUT', request.path, { body: request.body });
    const minted = await owner.call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', {
      body: { operation: `PUT ${request.path}`, target: 'default', typed: 'default', bodySha256: crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex') },
    });
    const saved = await owner.call('PUT', request.path, { body: request.body, headers: { 'x-caduceus-confirmation': minted.body.token } });

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    expect(saved.status).toBe(200);
    const after = (await loadForm(owner)).form;
    expect(matchingFields(after.fields, { text: '', filters: ['modified'] }, new Set()).map((candidate) => candidate.key)).toEqual(['toolsets', 'display.compact', 'delegation.reasoning_effort', 'auxiliary.vision.api_key']);
    expect(after.fields.find((candidate) => candidate.key === 'display.compact')).toMatchObject({ value: true, modified: true, inProfile: true });
    expect(after.fields.find((candidate) => candidate.key === 'auxiliary.vision.api_key')).toMatchObject({ secretSet: true, value: '' });
    expect(diffRows(after.fields, new Map([['display.compact', false]]))[0]).toMatchObject({ before: 'on', after: 'off' });
    const { entries } = (await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body;
    expect(entries.find((entry) => entry.action === 'PUT /api/config')).toMatchObject({ tier: 'T3', profile: 'default', target: '/api/config (display.compact, delegation.reasoning_effort, toolsets, auxiliary.vision.api_key)' });
    expect(JSON.stringify(entries)).not.toContain('sk-real-secret-value');
  });
});

describe('the raw YAML the page reads', () => {
  test('carries no secret: a credential that is set is a mask, and the rest of the file is Hermes’s own text', async () => {
    await seed({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, dashboard: { basic_auth: { password: 'hunter2-hunter2' } }, display: { compact: true } });
    const owner = await start();

    const answer = await owner.call<{ yaml: string; path: string }>('GET', '/api/config/raw?profile=default');

    expect(answer.status).toBe(200);
    expect(answer.text).not.toContain('sk-live-secret-value');
    expect(answer.text).not.toContain('hunter2-hunter2');
    expect(answer.body.path).toBe(path.join(hermes.home, 'config.yaml'));
    expect(YAML.parse(answer.body.yaml)).toMatchObject({ auxiliary: { vision: { api_key: CONFIG_SECRET_MASK } }, dashboard: { basic_auth: { password: CONFIG_SECRET_MASK } }, display: { compact: true } });
  });

  test('keeps a reference to a secret as the reference, finds credentials inside lists, and drops none that sit in a comment or under an anchor', async () => {
    fs.writeFileSync(
      path.join(hermes.home, 'config.yaml'),
      [
        '# api_key: sk-in-a-comment-secret',
        'auxiliary:',
        '  vision:',
        '    api_key: ${OPENAI_API_KEY}',
        '  curator:',
        '    api_key: &shared sk-anchored-secret',
        '  title:',
        '    api_key: *shared',
        'custom_providers:',
        '  - name: local',
        '    api_key: sk-in-a-list-secret',
        'display:',
        '  compact: true',
        '',
      ].join('\n'),
    );
    const owner = await start();

    const raw = await owner.call<{ yaml: string }>('GET', '/api/config/raw?profile=default');
    const config = await owner.call('GET', '/api/config?profile=default');

    for (const secret of ['sk-in-a-comment-secret', 'sk-anchored-secret', 'sk-in-a-list-secret']) {
      expect(raw.text).not.toContain(secret);
      expect(config.text).not.toContain(secret);
    }
    expect(YAML.parse(raw.body.yaml).auxiliary.title.api_key).toBe(CONFIG_SECRET_MASK);
    expect(YAML.parse(raw.body.yaml)).toMatchObject({ auxiliary: { vision: { api_key: '${OPENAI_API_KEY}' }, curator: { api_key: CONFIG_SECRET_MASK } }, custom_providers: [{ name: 'local', api_key: CONFIG_SECRET_MASK }], display: { compact: true } });
  });

  test('a file that does not parse still shows no credential, so it can be repaired in the editor', async () => {
    fs.writeFileSync(path.join(hermes.home, 'config.yaml'), 'auxiliary:\n  vision:\n    api_key: sk-broken-file-secret\n  bad: [unclosed\n# password: hunter2-in-comment\n');
    const owner = await start();

    const raw = await owner.call<{ yaml: string }>('GET', '/api/config/raw?profile=default');

    expect(raw.status).toBe(200);
    expect(raw.text).not.toContain('sk-broken-file-secret');
    expect(raw.text).not.toContain('hunter2-in-comment');
    expect(raw.body.yaml).toContain('bad: [unclosed');
  });
});

/** A T3 write the way the page makes one: the profile's name typed, the confirmation tied to the body. */
async function tieredPut(owner: Owner, route: string, body: unknown, profile = 'default') {
  const minted = await owner.call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', {
    body: { operation: `PUT ${route}`, target: profile, typed: profile, bodySha256: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') },
  });
  return owner.call('PUT', route, { body, headers: { 'x-caduceus-confirmation': minted.body.token } });
}

const savedFile = () => fs.readFileSync(path.join(hermes.home, 'config.yaml'), 'utf8');

describe('saving the raw YAML back', () => {
  test('a mask that comes back is the credential Hermes holds, so editing another line never clobbers it, and a comment of Hermes’s own survives', async () => {
    await seed({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, agent: { max_turns: 40 } });
    const owner = await start({ steppedUp: true });
    const { body } = await owner.call<{ yaml: string }>('GET', '/api/config/raw?profile=default');

    const saved = await tieredPut(owner, '/api/config/raw?profile=default', { yaml_text: body.yaml.replace('max_turns: 40', 'max_turns: 50') });

    expect(saved.status).toBe(200);
    expect(YAML.parse(savedFile())).toMatchObject({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, agent: { max_turns: 50 } });
    expect(savedFile()).not.toContain(CONFIG_SECRET_MASK);
  });

  test('a replaced credential is written as typed, and a mask with no credential behind it is refused with nothing written', async () => {
    await seed({ display: { compact: false } });
    const owner = await start({ steppedUp: true });
    const before = savedFile();

    const refused = await tieredPut(owner, '/api/config/raw?profile=default', { yaml_text: `auxiliary:\n  vision:\n    api_key: "${CONFIG_SECRET_MASK}"\n` });
    const typed = await tieredPut(owner, '/api/config/raw?profile=default', { yaml_text: 'auxiliary:\n  vision:\n    api_key: sk-typed-in-the-editor\n' });

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: 'masked-secret', keys: ['auxiliary.vision.api_key'] });
    expect(refused.text).not.toContain('sk-');
    expect(typed.status).toBe(200);
    expect(before).not.toContain('sk-typed-in-the-editor');
    expect(YAML.parse(savedFile())).toMatchObject({ auxiliary: { vision: { api_key: 'sk-typed-in-the-editor' } } });
  });

  test('a form save that sends a mask back keeps the credential, per profile', async () => {
    await seed({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } } });
    const owner = await start({ steppedUp: true });

    const saved = await tieredPut(owner, '/api/config', { config: { auxiliary: { vision: { api_key: CONFIG_SECRET_MASK }, curator: { model: 'm' } } }, profile: 'default' });

    expect(saved.status).toBe(200);
    expect(YAML.parse(savedFile())).toMatchObject({ auxiliary: { vision: { api_key: 'sk-live-secret-value' }, curator: { model: 'm' } } });
  });
});

/** The page's own pipeline for the raw YAML: the text as it is exported, and the checks and rows made from it. */
async function openYaml(owner: Owner, profile = 'default') {
  const { form } = await loadForm(owner, profile);
  const raw = await owner.call<{ yaml: string }>('GET', `/api/config/raw?profile=${profile}`);
  const current = (await owner.call('GET', `/api/config?profile=${profile}&include_defaults=false`)).body;
  return { form, text: raw.body.yaml, current, check: (text: string) => checkConfigYaml(text, { form, current }) };
}

describe('Config › YAML over the real Hermes', () => {
  test('the exported file is what Hermes keeps with no credential in it, and checks clean as the editor’s own starting text', async () => {
    await seed({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, agent: { max_turns: 40 } });
    const owner = await start();

    const { text, check } = await openYaml(owner);
    const file = exportFile('default', text, new Date('2026-10-18T00:00:00Z'));

    expect(file.name).toBe('hermes-config-default-2026-10-18.yaml');
    expect(file.text).not.toContain('sk-live-secret-value');
    expect(YAML.parse(file.text)).toMatchObject({ auxiliary: { vision: { api_key: CONFIG_SECRET_MASK } }, agent: { max_turns: 40 } });
    expect(check(file.text).problems).toEqual([]);
  });

  test('Hermes’s own schema finds a wrong kind on its line, and Hermes saves what passes (Tier 3) with the credential kept, audited and refused in read-only mode', async () => {
    await seed({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, agent: { max_turns: 40 }, display: { compact: true } });
    const owner = await start({ steppedUp: true });
    const { form, text, check } = await openYaml(owner);
    const lineOf = (needle: string) => text.split('\n').findIndex((line) => line.includes(needle)) + 1;

    const wrong = check(text.replace('compact: true', 'compact: maybe'));
    const request = rawSaveRequest('default', text.replace('max_turns: 40', 'max_turns: 55'));
    const refused = await owner.call('PUT', request.path, { body: request.body });
    const saved = await tieredPut(owner, request.path, request.body);

    expect(wrong.problems).toMatchObject([{ kind: 'schema', key: 'display.compact', line: lineOf('compact') }]);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    expect(saved.status).toBe(200);
    expect(YAML.parse(savedFile())).toMatchObject({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, agent: { max_turns: 55 } });
    const { entries } = (await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body;
    expect(entries.find((entry) => entry.action === 'PUT /api/config/raw')).toMatchObject({ tier: 'T3', profile: 'default' });
    expect(JSON.stringify(entries)).not.toContain('sk-live-secret-value');
    expect(changeRows(form, YAML.parse(text), YAML.parse(request.body.yaml_text)).map((row) => row.key)).toEqual(['agent.max_turns']);

    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    const whileReadOnly = await tieredPut(owner, request.path, { yaml_text: 'agent:\n  max_turns: 70\n' });
    expect(whileReadOnly.status).toBe(403);
    expect(YAML.parse(savedFile())).toMatchObject({ agent: { max_turns: 55 } });
  });

  test('an import is only read until it is applied: its rows and problems come from the file, Hermes’s file is untouched, and applying it replaces the config keeping credentials the file masks', async () => {
    await seed({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, agent: { max_turns: 40 }, display: { compact: true } });
    const owner = await start({ steppedUp: true });
    const { form, text, current, check } = await openYaml(owner);
    const before = savedFile();
    const imported = `auxiliary:\n  vision:\n    api_key: "${CONFIG_SECRET_MASK}"\nagent:\n  max_turns: 12\n`;

    const staged = check(imported);
    const rows = changeRows(form, current, staged.value);

    expect(staged.problems).toEqual([]);
    expect(rows.map(({ key, kind, after }) => ({ key, kind, after }))).toEqual([
      { key: 'agent.max_turns', kind: 'changed', after: '12' },
      { key: 'display.compact', kind: 'removed', after: 'Hermes’s default' },
    ]);
    expect(savedFile()).toBe(before);
    expect(text).not.toContain('sk-live-secret-value');

    const request = rawSaveRequest('default', imported);
    expect((await tieredPut(owner, request.path, request.body)).status).toBe(200);
    expect(YAML.parse(savedFile())).toMatchObject({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, agent: { max_turns: 12 } });
    expect(YAML.parse(savedFile()).display).toBeUndefined();
  });

  test('an import from a profile that had a credential this one has not is a problem on its line, and nothing of it is written', async () => {
    await seed({ agent: { max_turns: 40 } });
    const owner = await start({ steppedUp: true });
    const { check } = await openYaml(owner);
    const before = savedFile();

    const staged = check(`agent:\n  max_turns: 12\nauxiliary:\n  vision:\n    api_key: "${CONFIG_SECRET_MASK}"\n`);
    const request = rawSaveRequest('default', `auxiliary:\n  vision:\n    api_key: "${CONFIG_SECRET_MASK}"\n`);
    const sent = await tieredPut(owner, request.path, request.body);

    expect(staged.problems).toMatchObject([{ kind: 'secret', key: 'auxiliary.vision.api_key', line: 5 }]);
    expect(sent.status).toBe(422);
    expect(savedFile()).toBe(before);
  });

  test('a reset of a section puts its settings back to Hermes’s defaults, and of the whole config all of them, and neither clears a credential', async () => {
    await seed({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, agent: { max_turns: 40 }, display: { compact: true } });
    const owner = await start({ steppedUp: true });
    const { form, text } = await openYaml(owner);
    const config = YAML.parse(text) as Record<string, unknown>;

    const section = resetConfig(form, config, { section: 'agent' });
    const request = rawSaveRequest('default', YAML.stringify(section.value));
    expect((await tieredPut(owner, request.path, request.body)).status).toBe(200);

    expect(section.keys).toEqual(['agent.max_turns']);
    expect(YAML.parse(savedFile())).toMatchObject({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } }, display: { compact: true } });
    expect(YAML.parse(savedFile()).agent?.max_turns).toBeUndefined();

    const all = resetConfig(form, YAML.parse((await openYaml(owner)).text), 'all');
    const wholeRequest = rawSaveRequest('default', YAML.stringify(all.value));
    expect((await tieredPut(owner, wholeRequest.path, wholeRequest.body)).status).toBe(200);
    expect(all.keys).toContain('display.compact');
    expect(YAML.parse(savedFile())).toMatchObject({ auxiliary: { vision: { api_key: 'sk-live-secret-value' } } });
    expect(YAML.parse(savedFile()).display?.compact).toBeUndefined();
  });
});

describe('config migrate over the real Hermes', () => {
  test('is Tier 1 for the profile, audited, and Hermes’s own log of the run ends with an exit code the page can show', async () => {
    const owner = await start({ steppedUp: true });

    const started = await owner.call<{ ok: boolean; name: string }>('POST', '/api/ops/config-migrate?profile=default', { body: {} });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ ok: true, name: 'config-migrate' });

    // The run is a process of Hermes's own with no event to wait for: its status is read until it ends (a bounded poll of an OS-level fact).
    let log = { running: true, exit_code: null as number | null, lines: [] as string[] };
    await vi.waitFor(
      async () => {
        log = (await owner.call<typeof log>('GET', '/api/actions/config-migrate/status?lines=500')).body;
        expect(log.running).toBe(false);
      },
      { timeout: 30_000, interval: 100 },
    );
    expect(log.running).toBe(false);
    expect(log.exit_code).toBe(0);
    expect(migrateOutput(log.lines).join('\n')).toContain('Checking configuration for updates');
    const { entries } = (await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body;
    expect(entries.find((entry) => entry.action === 'POST /api/ops/config-migrate')).toMatchObject({ tier: 'T1' });
  });
});

const MCP = { fixture: { command: 'node', args: ['server.js'], env: { FIXTURE_TOKEN: 'tok-env-secret-1', REGION: 'eu' } }, remote: { url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer hdr-bearer-secret-2', 'X-Org': 'org-header-secret-3' } } };
const MCP_SECRETS = ['tok-env-secret-1', 'eu', 'hdr-bearer-secret-2', 'org-header-secret-3'];

describe('the MCP servers in the config the page reads', () => {
  test('every value under a server’s env and headers is a mask, in the config and in the raw file, and the names, commands and addresses stay', async () => {
    await seed({ mcp_servers: MCP });
    const owner = await start();

    const config = await owner.call<{ mcp_servers: typeof MCP }>('GET', '/api/config?profile=default');
    const raw = await owner.call<{ yaml: string }>('GET', '/api/config/raw?profile=default');

    for (const secret of MCP_SECRETS.filter((value) => value !== 'eu')) {
      expect(config.text).not.toContain(secret);
      expect(raw.text).not.toContain(secret);
    }
    for (const answer of [config.body.mcp_servers, YAML.parse(raw.body.yaml).mcp_servers as typeof MCP]) {
      expect(answer.fixture).toEqual({ command: 'node', args: ['server.js'], env: { FIXTURE_TOKEN: CONFIG_SECRET_MASK, REGION: CONFIG_SECRET_MASK } });
      expect(answer.remote).toEqual({ url: 'http://127.0.0.1:9/mcp', headers: { Authorization: CONFIG_SECRET_MASK, 'X-Org': CONFIG_SECRET_MASK } });
    }
  });

  test('a header named like a credential is masked wherever it sits, and a save that sends the masks back keeps every real value, through the raw file, the form’s save and the MCP map', async () => {
    await seed({ mcp_servers: MCP, custom: { headers: { 'X-Api-Key': 'key-in-another-place' } } });
    const owner = await start({ steppedUp: true });
    const config = (await owner.call<Record<string, unknown>>('GET', '/api/config?profile=default')).body;
    const real = () => YAML.parse(savedFile()) as { mcp_servers: typeof MCP; custom: { headers: Record<string, string> } };
    expect((config.custom as { headers: Record<string, string> }).headers['X-Api-Key']).toBe(CONFIG_SECRET_MASK);

    const raw = await owner.call<{ yaml: string }>('GET', '/api/config/raw?profile=default');
    expect((await tieredPut(owner, '/api/config/raw?profile=default', { yaml_text: raw.body.yaml })).status).toBe(200);
    expect(real().mcp_servers).toEqual(MCP);
    expect(real().custom.headers['X-Api-Key']).toBe('key-in-another-place');

    const servers = (config as { mcp_servers: Record<string, unknown> }).mcp_servers;
    const edited = { servers: { ...servers, fixture: { ...(servers.fixture as object), args: ['other.js'] } } };
    expect((await tieredPut(owner, '/api/mcp/servers?profile=default', edited)).status).toBe(200);
    expect(real().mcp_servers).toEqual({ ...MCP, fixture: { ...MCP.fixture, args: ['other.js'] } });

    expect((await tieredPut(owner, '/api/config', { config: { mcp_servers: servers }, profile: 'default' })).status).toBe(200);
    expect(real().mcp_servers).toEqual(MCP);
  });

  test('a mask for a variable the server does not have is refused with nothing written, and a value typed in its place is saved as typed', async () => {
    await seed({ mcp_servers: { fixture: MCP.fixture } });
    const owner = await start({ steppedUp: true });
    const before = savedFile();

    const refused = await tieredPut(owner, '/api/mcp/servers?profile=default', { servers: { fixture: { ...MCP.fixture, env: { FIXTURE_TOKEN: CONFIG_SECRET_MASK, NEW_VARIABLE: CONFIG_SECRET_MASK } } } });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: 'masked-secret', keys: ['mcp_servers.fixture.env.NEW_VARIABLE'] });
    expect(savedFile()).toBe(before);
    const typed = await tieredPut(owner, '/api/mcp/servers?profile=default', { servers: { fixture: { ...MCP.fixture, env: { FIXTURE_TOKEN: CONFIG_SECRET_MASK, NEW_VARIABLE: 'typed-value-9' } } } });
    expect(typed.status).toBe(200);
    expect(YAML.parse(savedFile()).mcp_servers.fixture.env).toEqual({ FIXTURE_TOKEN: 'tok-env-secret-1', NEW_VARIABLE: 'typed-value-9' });
  });
});

