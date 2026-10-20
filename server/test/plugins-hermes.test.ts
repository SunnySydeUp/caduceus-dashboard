import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { isRecord } from '@caduceus/contracts/policy/guards';
import path from 'node:path';
import type { AuditEntry, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { disableRequest, enableRequest, foldOperation, parseCatalogue, parsePlugins, removeRequest, startOperation } from '../../web/src/modules/plugins/plugins-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { openEventStream, type EventStream } from './fixtures/event-stream.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { createPluginRepo, OFFLINE_ENV, type PluginRepo } from './fixtures/plugin-repo.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// System › Plugins (M5 #11) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. Every install comes from a
// git repository made on this machine (`fixtures/plugin-repo.ts`), and Hermes and git are kept off the internet (`OFFLINE_ENV`).
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const repos: PluginRepo[] = [];
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
  for (const repo of repos.splice(0)) repo.remove();
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

interface Answer<T> {
  status: number;
  body: T;
  text: string;
}

interface Request {
  method: string;
  path: string;
  body?: unknown;
}

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Answer<T>>;
  /** Sends a request the way the tiered dialog does for a T3: with the typed confirmation of `typed`. */
  send<T = unknown>(request: Request, typed?: string): Promise<Answer<T>>;
  /** Opens the live log of an operation, as the page's `EventSource` does. */
  log(id: string): Promise<EventStream>;
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
  return { call, send, log: (id) => openEventStream(url, `/_caduceus/api/plugins/operations/${id}/stream`, cookie) };
}

const auditOf = async (owner: Owner) => (await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body.entries;

/** What a log says of how it ended. */
interface LogEnd {
  ok: boolean;
  code: number | null;
  message: string;
}

/** Reads a log to its end: every line, and how it ended. */
async function readLog(stream: EventStream): Promise<{ lines: string[]; end: LogEnd }> {
  const lines: string[] = [];
  for (;;) {
    const { event, data } = await stream.next();
    if (event === 'line' && isRecord(data) && typeof data.text === 'string') lines.push(data.text);
    if (event === 'end' && isRecord(data) && typeof data.ok === 'boolean' && typeof data.message === 'string' && (typeof data.code === 'number' || data.code === null)) return { lines, end: { ok: data.ok, code: data.code, message: data.message } };
  }
}

/** The log as the page folds it, event by event, until Hermes's command has ended. */
async function followLog(stream: EventStream) {
  let state = startOperation();
  while (state.status === 'running') state = foldOperation(state, await stream.next());
  return state;
}

const install = (identifier: string, extra: Record<string, unknown> = {}): Request => ({ method: 'POST', path: '/_caduceus/api/plugins/operations', body: { action: 'install', identifier, ...extra } });

describe('installing a plugin from a git URL', () => {
  test('is a Tier 3 operation: it needs a passkey and the typed address, and then its log streams to the end', async () => {
    const repo = createPluginRepo({ name: 'fixture-notes' });
    repos.push(repo);

    const guest = await start({ steppedUp: false });
    const refused = await guest.send<PolicyRefusal>(install(repo.url), repo.url);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T3' });
    await server!.close();

    const owner = await start();
    const unconfirmed = await owner.send<PolicyRefusal>(install(repo.url));
    expect(unconfirmed.body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });

    const started = await owner.send<{ id: string }>(install(repo.url), repo.url);
    expect(started.status).toBe(202);
    const { lines, end } = await readLog(await owner.log(started.body.id));
    expect(end).toMatchObject({ ok: true, code: 0 });
    expect(lines.join('\n')).toContain('fixture-notes');
    // The page's own reading of the same log, replayed to a tab that opens late.
    expect(await followLog(await owner.log(started.body.id))).toEqual({ status: 'ok', lines, message: end.message });

    const audit = await auditOf(owner);
    expect(audit.find((row) => row.action === 'plugins.install')).toMatchObject({ tier: 'T3', target: repo.url });
    await owner.send(removeRequest('fixture-notes'));
  });
});

describe('the installed plugins', () => {
  test('are what Hermes lists now: installed, enabled by the install, disabled, enabled and removed at Tier 1, each named in the audit log', async () => {
    const repo = createPluginRepo({ name: 'fixture-toggle', version: '2.3.4', description: 'Toggles in a test.' });
    repos.push(repo);
    const owner = await start();
    const listed = async () => parsePlugins((await owner.call('GET', '/api/dashboard/plugins/hub')).body).find((plugin) => plugin.name === 'fixture-toggle');

    expect(await listed()).toBeUndefined();
    const started = await owner.send<{ id: string }>(install(repo.url), repo.url);
    expect((await readLog(await owner.log(started.body.id))).end.ok).toBe(true);
    // The list is read from Hermes the moment the log ends: it is never the one Hermes built before the install.
    expect(await listed()).toMatchObject({ name: 'fixture-toggle', version: '2.3.4', description: 'Toggles in a test.', source: 'user', state: 'enabled', removable: true, updatable: true });

    const disabled = await owner.send(disableRequest('fixture-toggle'));
    expect(disabled.status).toBe(200);
    expect(await listed()).toMatchObject({ state: 'disabled' });
    expect((await owner.send(enableRequest('fixture-toggle'))).status).toBe(200);
    expect(await listed()).toMatchObject({ state: 'enabled' });

    const removed = await owner.send(removeRequest('fixture-toggle'));
    expect(removed.status).toBe(200);
    expect(await listed()).toBeUndefined();

    const audit = await auditOf(owner);
    const rows = audit.filter((row) => row.action.includes('/api/dashboard/agent-plugins/{name}'));
    expect(rows.map((row) => [row.action, row.tier, row.target])).toEqual([
      ['DELETE /api/dashboard/agent-plugins/{name}', 'T1', '/api/dashboard/agent-plugins/fixture-toggle'],
      ['POST /api/dashboard/agent-plugins/{name}/enable', 'T1', '/api/dashboard/agent-plugins/fixture-toggle/enable'],
      ['POST /api/dashboard/agent-plugins/{name}/disable', 'T1', '/api/dashboard/agent-plugins/fixture-toggle/disable'],
    ]);
  });
});

describe('updating a plugin', () => {
  test('is a Tier 3 operation that streams what git brings in, and says so when there is nothing new', async () => {
    const repo = createPluginRepo({ name: 'fixture-update' });
    repos.push(repo);
    const owner = await start();
    const first = await owner.send<{ id: string }>(install(repo.url), repo.url);
    expect((await readLog(await owner.log(first.body.id))).end.ok).toBe(true);
    repo.commit('notes.txt', 'new in the second version\n');

    const update: Request = { method: 'POST', path: '/_caduceus/api/plugins/operations', body: { action: 'update', name: 'fixture-update' } };
    expect((await owner.send<PolicyRefusal>(update)).body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    const started = await owner.send<{ id: string }>(update, 'fixture-update');
    expect(started.status).toBe(202);
    const { lines, end } = await readLog(await owner.log(started.body.id));
    expect(end).toMatchObject({ ok: true, code: 0 });
    // What git printed, line by line.
    expect(lines.join('\n')).toContain('notes.txt');

    const again = await owner.send<{ id: string }>(update, 'fixture-update');
    const quiet = await readLog(await owner.log(again.body.id));
    expect(quiet.end.ok).toBe(true);
    expect(quiet.lines.join('\n')).toMatch(/up to date/i);

    expect((await auditOf(owner)).filter((row) => row.action === 'plugins.update').map((row) => [row.tier, row.target])).toEqual([
      ['T3', 'fixture-update'],
      ['T3', 'fixture-update'],
    ]);
    await owner.send(removeRequest('fixture-update'));
  });
});

describe('an install that fails', () => {
  test('ends its log as a failure in Hermes’s own words, installs nothing, and is refused while another runs, in read-only mode and for a bad request', async () => {
    const owner = await start();
    const missing = 'file:///caduceus-no-such-plugin-repository';
    const started = await owner.send<{ id: string }>(install(missing), missing);
    expect(started.status).toBe(202);
    // One plugin operation at a time: the plugins folder is shared.
    const second = await owner.send<{ error: string }>(install(missing), missing);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('busy');

    const { lines, end } = await readLog(await owner.log(started.body.id));
    expect(end.ok).toBe(false);
    expect(end.code).toBe(1);
    expect(end.message).toMatch(/^Error: Could not download the plugin/);
    expect(lines.join('\n')).toContain('does not appear to be a git repository');
    // Reading the finished log again is the same log: a tab that was away still sees how it ended.
    expect((await readLog(await owner.log(started.body.id))).end).toEqual(end);
    expect(parsePlugins((await owner.call('GET', '/api/dashboard/plugins/hub')).body).filter((plugin) => plugin.source === 'user')).toEqual([]);

    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    const readOnly = await owner.send<PolicyRefusal>(install(missing), missing);
    expect(readOnly.status).toBe(403);
    expect(readOnly.body.error).toBe('read-only');
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });

    // A request is judged before anything runs: an option in place of an address, a catalogue name that is a URL, a ref that is not a commit.
    for (const body of [
      { action: 'install', identifier: '--force' },
      { action: 'install', identifier: 'https://example.invalid/repo', catalogue: true },
      { action: 'install', identifier: 'strava' },
      { action: 'install', identifier: 'owner/repo', ref: 'main' },
      { action: 'install', identifier: 'owner/repo', surprise: true },
      { action: 'update', name: '../etc' },
      { action: 'update', name: '--all' },
      { action: 'remove', name: 'x' },
    ]) {
      const refused = await owner.send<{ error: string }>({ method: 'POST', path: '/_caduceus/api/plugins/operations', body }, JSON.stringify(body).slice(0, 40));
      expect([JSON.stringify(body), refused.status, refused.body.error]).toEqual([JSON.stringify(body), 400, 'bad-request']);
    }
  });

  test('never puts a credential in the address into the log or the audit log', async () => {
    const owner = await start();
    const address = 'https://someone:s3cret-token-value@caduceus-no-such-host.invalid/owner/repo.git';
    const started = await owner.send<{ id: string }>(install(address), 'https://caduceus-no-such-host.invalid/owner/repo.git');
    const { lines } = await readLog(await owner.log(started.body.id));

    expect(lines.join('\n')).not.toContain('s3cret-token-value');
    expect(JSON.stringify(await auditOf(owner))).not.toContain('s3cret-token-value');
    expect((await auditOf(owner)).find((row) => row.action === 'plugins.install')).toMatchObject({ target: 'https://caduceus-no-such-host.invalid/owner/repo.git' });
  });
});

describe('the catalogue', () => {
  test('is Hermes’s curated list with a description for each entry, read with no copy kept; installing from it runs Hermes’s catalogue install, and fails cleanly with no network', async () => {
    const owner = await start();
    const catalogue = parseCatalogue((await owner.call('GET', '/api/dashboard/plugins/catalog')).body);

    expect(catalogue.entries.length).toBeGreaterThan(10);
    for (const entry of catalogue.entries) {
      expect(entry.name).not.toBe('');
      expect(entry.description).not.toBe('');
      expect(entry.installed).toBe(false);
    }
    expect(catalogue.entries.some((entry) => entry.tier === 'official')).toBe(true);
    expect(catalogue.entries.some((entry) => entry.tier === 'community')).toBe(true);

    // The install goes out to the entry's own repository, which this machine cannot reach: the log says Hermes could not download it, and nothing is installed.
    const [entry] = catalogue.entries;
    const started = await owner.send<{ id: string }>(install(entry.name, { catalogue: true }), entry.name);
    expect(started.status).toBe(202);
    const { lines, end } = await readLog(await owner.log(started.body.id));
    expect(end.ok).toBe(false);
    expect(lines.join('\n')).toContain(entry.name);
    expect(lines.join('\n')).toMatch(/pinned @ [0-9a-f]{8}/);
    expect(parsePlugins((await owner.call('GET', '/api/dashboard/plugins/hub')).body).filter((plugin) => plugin.source === 'user')).toEqual([]);
  });
});
