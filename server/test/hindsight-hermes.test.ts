import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { installMemoryPlugins } from './fixtures/memory-plugins.ts';
import { startHindsightStub, type HindsightStub } from './fixtures/hindsight-stub.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { directivesPath, memoriesPath, mentalModelsPath, parseDirectives, parseMemories, parseMentalModels, parseRecall, parseReflect, parseStatus, recallRequest, reflectRequest, retainRequest, startBank, statusPath } from '../../web/src/modules/memory/hindsight-model.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Agents › Memory › Hindsight (M4 #10) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME and a Hindsight API
// stub (`fixtures/hindsight-stub.ts`) that follows Hindsight's published OpenAPI document. Hermes holds only the provider's settings
// (`hindsight/config.json`) and its key (`.env`); Caduceus reads both from Hermes and calls Hindsight itself.
const KEY = 'hsk_test_0123456789abcdef';
let hermes: TestHermes;
let stub: HindsightStub;
let server: CaduceusServer;
let owner: Owner;
// One Caduceus server serves every test: Hermes allows five reveals of a key per half minute for the whole process, and Caduceus asks once per minute.
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  const created = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'coder' }) });
  if (!created.ok) throw new Error(`Creating coder: HTTP ${created.status}`);
  // Hermes 0.22 does not carry Hindsight any more: it is a plugin each profile installs from the catalogue.
  installMemoryPlugins(hermes.home, ['hindsight']);
  installMemoryPlugins(path.join(hermes.home, 'profiles', 'coder'), ['hindsight']);
  stub = await startHindsightStub();
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const cookie = await ownerCookie(server.url);
  await stepUp(server.url, cookie, await addPasskey(server.url, cookie));
  owner = { url: server.url, cookie, call: (method, route, init) => call(server.url, cookie, method, route, init) };
}, 90_000);
afterAll(async () => {
  try {
    await server.close();
  } finally {
    try {
      await stub.close();
    } finally {
      await hermes.stop();
    }
  }
});
afterEach(async () => {
  await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
  fs.rmSync(path.join(hermes.home, 'hindsight'), { recursive: true, force: true });
  await hermes.cli('config', 'set', 'memory.provider', '');
  await hermes.cli('-p', 'coder', 'config', 'set', 'memory.provider', '');
  stub.reset();
});

interface Answer<T> {
  status: number;
  body: T;
  text: string;
}

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Answer<T>>;
  url: string;
  cookie: string;
}

async function call<T>(url: string, cookie: string, method: string, route: string, { body, headers }: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Answer<T>> {
  const res = await fetch(`${url}${route}`, {
    method,
    headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as T };
}

/** Points Hermes's Hindsight provider at the stub, the way the Memory screen's form does, and makes it the profile's provider. */
async function connectHindsight(values: Record<string, unknown> = {}, profile = 'default'): Promise<void> {
  // Hermes refuses to make Hindsight the provider when it is not available (the embedded mode has no runtime in the test home), after it has saved the form's values.
  await hermes.backend.fetch(`/api/memory/providers/hindsight/config?profile=${profile}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ values: { mode: 'local_external', api_url: stub.url, api_key: KEY, bank_id: 'hermes', ...values } }),
  });
  await hermes.cli(...(profile === 'default' ? [] : ['-p', profile]), 'config', 'set', 'memory.provider', 'hindsight');
}

const auditOf = async (owner: Owner) => (await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body.entries;

describe('Hindsight', () => {
  test('sends the key only to the address it was first used with: a changed address is called without it', async () => {
    stub.requireKey(KEY);
    await connectHindsight();
    const first = await owner.call<{ state: string }>('GET', '/_caduceus/api/hindsight/status?profile=default');
    expect(first.body.state).toBe('connected');
    stub.reset();

    // Hermes's setting now points somewhere else (a T2 edit with a stolen cookie is all it takes): the key stays where it was approved.
    await connectHindsight({ api_url: `${stub.url}/elsewhere` });
    const moved = await owner.call<{ state: string; message?: string }>('GET', '/_caduceus/api/hindsight/status?profile=default');

    expect(stub.requests.length).toBeGreaterThan(0);
    expect(stub.requests.map((request) => request.authorization)).toEqual(stub.requests.map(() => undefined));
    expect(moved.body.state).not.toBe('connected');
  });

  test('after a legitimate address change the owner can use the key with the new address: a T3 that shows the old and the new address and is audited', async () => {
    stub.requireKey(KEY);
    await connectHindsight({}, 'coder');
    expect((await owner.call<{ state: string }>('GET', '/_caduceus/api/hindsight/status?profile=coder')).body.state).toBe('connected');
    const moved = stub.url.replace('127.0.0.1', 'localhost');
    await connectHindsight({ api_url: moved }, 'coder');
    const held = await owner.call<{ apiUrl: string; keyPinnedTo?: string }>('GET', '/_caduceus/api/hindsight/status?profile=coder');
    expect(held.body).toMatchObject({ apiUrl: moved, keyPinnedTo: stub.url });

    const route = '/_caduceus/api/hindsight/key-address?profile=coder';
    const body = { to: moved };
    expect((await owner.call('POST', route, { body })).status).toBe(403);
    const minted = await owner.call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', {
      body: { operation: `POST ${route}`, target: moved, typed: moved, bodySha256: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') },
    });
    const done = await owner.call('POST', route, { body, headers: { 'x-caduceus-confirmation': minted.body.token } });
    expect(done.status).toBe(200);

    stub.reset();
    const after = await owner.call<{ state: string; keyPinnedTo?: string }>('GET', '/_caduceus/api/hindsight/status?profile=coder');
    expect(after.body.state).toBe('connected');
    expect(after.body.keyPinnedTo).toBeUndefined();
    expect(stub.requests.map((request) => request.authorization)).toEqual(stub.requests.map(() => `Bearer ${KEY}`));
    expect((await auditOf(owner)).find((entry) => entry.action === 'hindsight.key-address')).toMatchObject({ tier: 'T3', profile: 'coder', target: `${stub.url} → ${moved}` });
  });

  test('in cloud mode calls only a public https address: a loopback, private or plain-http one is refused before anything is sent, key included', async () => {
    stub.requireKey(KEY);
    const refused: string[] = [];
    for (const api_url of [stub.url, 'https://127.0.0.1/', 'https://localhost:8888', 'https://10.0.0.5', 'https://192.168.1.2', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://printer.local', 'http://api.hindsight.vectorize.io']) {
      await connectHindsight({ mode: 'cloud', api_url });
      refused.push((await owner.call<{ message: string }>('GET', '/_caduceus/api/hindsight/status?profile=default')).body.message);
    }

    expect(refused.map((message) => /must be a public https address/.test(message))).toEqual(Array(9).fill(true));
    expect(stub.requests).toEqual([]);
  });

  test('says Hindsight is not this profile’s memory provider, and how to turn it on, without calling any Hindsight server', async () => {

    const status = await owner.call<{ state: string; message: string }>('GET', '/_caduceus/api/hindsight/status?profile=default');

    expect(status.status).toBe(200);
    expect(status.body.state).toBe('off');
    expect(status.body.message).toMatch(/Provider tab/);
    expect(stub.requests).toEqual([]);
  });

  test('says the plugin is missing when Hermes names Hindsight as the provider and the profile has no Hindsight plugin: not a bad address, and nothing is called', async () => {
    await hermes.cli('-p', 'coder', 'config', 'set', 'memory.provider', 'hindsight');
    fs.rmSync(path.join(hermes.home, 'profiles', 'coder', 'plugins', 'hindsight'), { recursive: true, force: true });

    try {
      const status = await owner.call<{ state: string; message: string }>('GET', '/_caduceus/api/hindsight/status?profile=coder');

      expect(status.status).toBe(200);
      expect(status.body.state).toBe('unreachable');
      expect(status.body.message).toMatch(/plugin is not installed.*hermes plugins install hindsight/);
      expect(stub.requests).toEqual([]);
    } finally {
      installMemoryPlugins(path.join(hermes.home, 'profiles', 'coder'), ['hindsight']);
    }
  });

  test('is connected for a configured profile: the bank Hermes names, the banks Hindsight lists and its version, called with the key Hermes holds, which the answer never repeats', async () => {
    stub.requireKey(KEY);
    stub.bank('hermes').memories.push({ id: 'm1', text: 'The owner prefers tea.', fact_type: 'world' });
    stub.bank('other').memories.push({ id: 'm2', text: 'Another bank.', fact_type: 'world' });
    await connectHindsight();

    const status = await owner.call<{ state: string; mode: string; apiUrl: string; bank: string; version: string; banks: { id: string; facts: number }[] }>('GET', '/_caduceus/api/hindsight/status?profile=default');

    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ state: 'connected', mode: 'local_external', apiUrl: stub.url, bank: 'hermes', version: '0.6.2' });
    expect(status.body.banks).toEqual([expect.objectContaining({ id: 'hermes', facts: 1 }), expect.objectContaining({ id: 'other', facts: 1 })]);
    expect(stub.requests.length).toBeGreaterThan(0);
    for (const request of stub.requests.filter((r) => r.path.startsWith('/v1/'))) expect(request.authorization).toBe(`Bearer ${KEY}`);
    expect(status.text).not.toContain(KEY);
  });

  test('is “rejected” in words, not an error, when Hindsight refuses the key; the key is not in the words', async () => {
    stub.requireKey('a-different-key');
    await connectHindsight();

    const status = await owner.call<{ state: string; message: string; banks: unknown[] }>('GET', '/_caduceus/api/hindsight/status?profile=default');

    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ state: 'rejected', message: 'Hindsight refused the key Hermes holds for it.' });
    expect(status.text).not.toContain(KEY);
  });

  test('is “unreachable” with the banks it listed last time when Hindsight does not answer: a closed port, and a server that fails', async () => {
    stub.bank('hermes').memories.push({ id: 'm1', text: 'The owner prefers tea.', fact_type: 'world' });
    await connectHindsight();
    const connected = await owner.call<{ state: string }>('GET', '/_caduceus/api/hindsight/status?profile=default');
    expect(connected.body.state).toBe('connected');

    stub.fail(true);
    const failing = await owner.call<{ state: string; message: string; stale: boolean; banks: { id: string }[] }>('GET', '/_caduceus/api/hindsight/status?profile=default');
    expect(failing.status).toBe(200);
    expect(failing.body).toMatchObject({ state: 'unreachable', message: 'Hindsight answered HTTP 500.', stale: true, banks: [expect.objectContaining({ id: 'hermes' })] });

    const gone = await startHindsightStub();
    const deadUrl = gone.url;
    await gone.close();
    await connectHindsight({ api_url: deadUrl });
    const closed = await owner.call<{ state: string; message: string; stale: boolean; banks: { id: string }[] }>('GET', '/_caduceus/api/hindsight/status?profile=default');
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ state: 'unreachable', apiUrl: deadUrl, stale: true, banks: [expect.objectContaining({ id: 'hermes' })] });
    expect(closed.body.message).toMatch(/did not answer/);
  });

  test('lists a bank’s memories (searched and by kind), directives and mental models as Hindsight answers them, each call audited as a read', async () => {
    const bank = stub.bank('hermes');
    bank.memories.push({ id: 'm1', text: 'The owner prefers tea.', fact_type: 'world' }, { id: 'm2', text: 'The owner ran the Sunday deploy.', fact_type: 'experience' }, { id: 'm3', text: 'Deploys happen on Sundays.', fact_type: 'observation' });
    bank.directives.push({ id: 'd1', name: 'Be brief', content: 'Answer in two sentences.', priority: 5, is_active: true, tags: [] });
    bank.mentalModels.push({ id: 'mm1', name: 'Deploy habits', source_query: 'When does the owner deploy?', content: 'The owner deploys on Sundays.', tags: ['ops'] });
    await connectHindsight();
    const base = '/_caduceus/api/hindsight/banks/hermes';

    const all = await owner.call<{ items: { id: string }[]; total: number }>('GET', `${base}/memories?profile=default`);
    const searched = await owner.call<{ items: { id: string }[] }>('GET', `${base}/memories?profile=default&q=deploy&type=observation&limit=10`);
    const directives = await owner.call<{ items: { name: string; content: string }[] }>('GET', `${base}/directives?profile=default`);
    const models = await owner.call<{ items: { name: string; content: string }[] }>('GET', `${base}/mental-models?profile=default`);

    expect(all.body.items.map((item) => item.id)).toEqual(['m1', 'm2', 'm3']);
    expect(all.body.total).toBe(3);
    expect(searched.body.items.map((item) => item.id)).toEqual(['m3']);
    expect(directives.body.items).toEqual([expect.objectContaining({ name: 'Be brief', content: 'Answer in two sentences.' })]);
    expect(models.body.items).toEqual([expect.objectContaining({ name: 'Deploy habits', content: 'The owner deploys on Sundays.' })]);
    const reached = stub.requests.map((request) => `${request.method} ${request.path}${request.search}`);
    expect(reached).toContain('GET /v1/default/banks/hermes/memories/list?limit=50&offset=0');
    expect(reached).toContain('GET /v1/default/banks/hermes/memories/list?q=deploy&type=observation&limit=10&offset=0');
    expect(reached).toContain('GET /v1/default/banks/hermes/directives?active_only=false&limit=50&offset=0');
    expect(reached).toContain('GET /v1/default/banks/hermes/mental-models?detail=full&limit=50&offset=0');
    const audit = await auditOf(owner);
    expect(audit.filter((entry) => entry.action.startsWith('hindsight.'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'hindsight.memories', target: 'hermes', tier: 'T0', profile: 'default' }), expect.objectContaining({ action: 'hindsight.directives' }), expect.objectContaining({ action: 'hindsight.mental-models' })]),
    );
  });

  test('recalls and reflects: the owner’s query and budget reach Hindsight, its results come back, and each call is audited as a read that names no query text', async () => {
    const bank = stub.bank('hermes');
    bank.memories.push({ id: 'm1', text: 'The owner prefers green tea.', fact_type: 'world' }, { id: 'm2', text: 'Deploys happen on Sundays.', fact_type: 'observation' });
    bank.directives.push({ id: 'd1', name: 'Be brief', content: 'Answer in two sentences.', priority: 5, is_active: true, tags: [] });
    await connectHindsight();
    const base = '/_caduceus/api/hindsight/banks/hermes';

    const recalled = await owner.call<{ results: { id: string; text: string; type: string }[] }>('POST', `${base}/recall?profile=default`, { body: { query: 'what tea does the owner like', budget: 'high', types: ['world'] } });
    const reflected = await owner.call<{ text: string; based_on: { memories: { id: string }[]; directives: { name: string }[] } }>('POST', `${base}/reflect?profile=default`, { body: { query: 'tea', budget: 'low' } });
    const bad = await owner.call<{ error: string }>('POST', `${base}/recall?profile=default`, { body: { query: '' } });
    const badBudget = await owner.call<{ error: string }>('POST', `${base}/reflect?profile=default`, { body: { query: 'tea', budget: 'enormous' } });

    expect(recalled.status).toBe(200);
    expect(recalled.body.results).toEqual([expect.objectContaining({ id: 'm1', text: 'The owner prefers green tea.', type: 'world' })]);
    expect(reflected.body.text).toContain('green tea');
    expect(reflected.body.based_on.memories).toEqual([expect.objectContaining({ id: 'm1' })]);
    expect(reflected.body.based_on.directives).toEqual([expect.objectContaining({ name: 'Be brief' })]);
    expect(bad.status).toBe(400);
    expect(badBudget.status).toBe(400);
    const sent = stub.requests.filter((request) => request.method === 'POST');
    expect(sent.map((request) => request.path)).toEqual(['/v1/default/banks/hermes/memories/recall', '/v1/default/banks/hermes/reflect']);
    expect(sent[0].body).toEqual({ query: 'what tea does the owner like', budget: 'high', types: ['world'], max_tokens: 2048 });
    expect(sent[1].body).toEqual({ query: 'tea', budget: 'low' });
    const entries = (await auditOf(owner)).filter((entry) => entry.action === 'hindsight.recall' || entry.action === 'hindsight.reflect');
    expect(entries.map((entry) => `${entry.action} ${entry.target} ${entry.tier}`).sort()).toEqual(['hindsight.recall hermes T0', 'hindsight.reflect hermes T0']);
    expect(JSON.stringify(entries)).not.toContain('tea');
  });

  test('adds a memory as a Tier 1 write: Hindsight gets it as a retain call, the policy audits it by bank and never by text, and read-only mode refuses it while recall still works', async () => {
    await connectHindsight();
    const base = '/_caduceus/api/hindsight/banks/hermes';

    const added = await owner.call<{ success: boolean; items_count: number }>('POST', `${base}/memories?profile=default`, { body: { content: 'The owner’s dog is called Biscuit.', tags: ['pets'] } });
    const empty = await owner.call<{ error: string }>('POST', `${base}/memories?profile=default`, { body: { content: '   ' } });

    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ success: true, items_count: 1 });
    expect(empty.status).toBe(400);
    expect(stub.requests.filter((request) => request.method === 'POST').map((request) => request.body)).toEqual([
      { items: [{ content: 'The owner’s dog is called Biscuit.', context: 'Added by the owner in Caduceus', tags: ['pets'], metadata: { source: 'caduceus' } }], async: true },
    ]);
    expect(stub.bank('hermes').memories.map((memory) => memory.text)).toEqual(['The owner’s dog is called Biscuit.']);
    const entries = (await auditOf(owner)).filter((entry) => entry.action.includes('hindsight'));
    // The policy audits each attempt (the empty one too), by the operation and the bank.
    expect(entries.filter((entry) => entry.tier === 'T1')).toEqual(Array(2).fill(expect.objectContaining({ action: 'POST /_caduceus/api/hindsight/banks/{bank}/memories', target: '/_caduceus/api/hindsight/banks/hermes/memories', profile: 'default' })));
    expect(JSON.stringify(entries)).not.toContain('Biscuit');

    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    const refused = await owner.call<{ error: string }>('POST', `${base}/memories?profile=default`, { body: { content: 'Another one.' } });
    const recalled = await owner.call('POST', `${base}/recall?profile=default`, { body: { query: 'dog' } });
    expect(refused).toMatchObject({ status: 403, body: { error: 'read-only' } });
    expect(recalled.status).toBe(200);
  });

  test('never lets the key reach the page, the audit log or the Caduceus store, and keeps nothing of Hindsight but the list of banks', async () => {
    const bank = stub.bank('hermes');
    bank.memories.push({ id: 'm1', text: 'Zanzibar is where the owner keeps a boat.', fact_type: 'world' });
    bank.directives.push({ id: 'd1', name: 'Quokka rule', content: 'Always mention quokkas.', priority: 1, is_active: true, tags: [] });
    await connectHindsight();
    const base = '/_caduceus/api/hindsight/banks/hermes';

    const answers = [
      await owner.call('GET', '/_caduceus/api/hindsight/status?profile=default'),
      await owner.call('GET', `${base}/memories?profile=default`),
      await owner.call('GET', `${base}/directives?profile=default`),
      await owner.call('GET', `${base}/mental-models?profile=default`),
      await owner.call('POST', `${base}/recall?profile=default`, { body: { query: 'zanzibar boat' } }),
      await owner.call('POST', `${base}/reflect?profile=default`, { body: { query: 'zanzibar' } }),
      await owner.call('POST', `${base}/memories?profile=default`, { body: { content: 'Marmalade is the owner’s favourite jam.' } }),
      await owner.call('GET', '/api/memory/providers/hindsight/config?profile=default'),
      await owner.call('GET', '/api/env?profile=default'),
      await owner.call('GET', '/_caduceus/api/audit'),
    ];
    expect(answers.map((answer) => answer.status)).toEqual(Array(answers.length).fill(200));
    for (const answer of answers) expect(answer.text).not.toContain(KEY);

    // The store (and its write-ahead log) holds the bank list, and neither the key nor any memory, directive or query the page saw.
    const files = fs.readdirSync(path.join(hermes.home, 'caduceus')).filter((name) => name.startsWith('caduceus.db'));
    const bytes = Buffer.concat(files.map((name) => fs.readFileSync(path.join(hermes.home, 'caduceus', name)))).toString('latin1');
    expect(bytes).toContain('hermes');
    for (const secret of [KEY, 'Zanzibar', 'zanzibar', 'Quokka', 'quokkas', 'Marmalade']) expect(bytes).not.toContain(secret);
  });

  test('works for a profile of its own: its bank from a template, and no Authorization header when Hermes holds no key for it', async () => {
    await connectHindsight({ api_key: undefined, bank_id_template: 'hermes-{profile}' }, 'coder');
    stub.bank('hermes-coder').memories.push({ id: 'c1', text: 'Coder likes tabs.', fact_type: 'world' });

    const status = await owner.call<{ state: string; bank: string }>('GET', '/_caduceus/api/hindsight/status?profile=coder');
    const memories = await owner.call<{ items: { id: string }[] }>('GET', '/_caduceus/api/hindsight/banks/hermes-coder/memories?profile=coder');

    expect(status.body).toMatchObject({ state: 'connected', bank: 'hermes-coder' });
    expect(memories.body.items.map((item) => item.id)).toEqual(['c1']);
    for (const request of stub.requests.filter((r) => r.path.startsWith('/v1/'))) expect(request.authorization).toBeUndefined();

    stub.requireKey('needed');
    const refused = await owner.call<{ state: string; message: string }>('GET', '/_caduceus/api/hindsight/status?profile=coder');
    expect(refused.body).toMatchObject({ state: 'rejected', message: 'Hindsight wants a key, and Hermes holds none for this profile.' });
  });

  test('says why Hindsight cannot be browsed when it runs inside Hermes, and asks it nothing', async () => {
    await connectHindsight({ mode: 'local_embedded' });

    const status = await owner.call<{ state: string; mode: string; message: string }>('GET', '/_caduceus/api/hindsight/status?profile=default');
    const memories = await owner.call<{ error: string }>('GET', '/_caduceus/api/hindsight/banks/hermes/memories?profile=default');

    expect(status.body).toMatchObject({ state: 'embedded', mode: 'local_embedded' });
    expect(status.body.message).toMatch(/inside Hermes/);
    expect(memories).toMatchObject({ status: 409, body: { error: 'not-connected' } });
    expect(stub.requests).toEqual([]);
  });

  test('calls nothing but the routes it lists: no delete, no config, and a bank name with a slash or dots in it is refused', async () => {
    await connectHindsight();

    const deleted = await owner.call('DELETE', '/_caduceus/api/hindsight/banks/hermes?profile=default');
    const config = await owner.call('GET', '/_caduceus/api/hindsight/banks/hermes/config?profile=default');
    const odd = await owner.call<{ error: string; reason: string }>('GET', `/_caduceus/api/hindsight/banks/${encodeURIComponent('a/b')}/memories?profile=default`);
    const dots = await owner.call<{ error: string }>('GET', '/_caduceus/api/hindsight/banks/../memories?profile=default');

    expect([deleted.status, config.status]).toEqual([404, 404]);
    expect(odd).toMatchObject({ status: 403, body: { reason: 'bad-path' } });
    expect(dots.status).not.toBe(200);
    expect(stub.requests).toEqual([]);
  });

  test('asks Hermes for the key again after Hindsight refuses the one it held, so a key changed in Hermes works at the next look', async () => {
    await connectHindsight();
    const first = await owner.call<{ state: string }>('GET', '/_caduceus/api/hindsight/status?profile=default');
    expect(first.body.state).toBe('connected');

    stub.requireKey('rotated-key');
    await hermes.backend.fetch('/api/env?profile=default', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'HINDSIGHT_API_KEY', value: 'rotated-key' }) });
    const refused = await owner.call<{ state: string }>('GET', '/_caduceus/api/hindsight/status?profile=default');
    const again = await owner.call<{ state: string }>('GET', '/_caduceus/api/hindsight/status?profile=default');

    expect(refused.body.state).toBe('rejected');
    expect(again.body.state).toBe('connected');
  });

  test('is read by the page’s own code (hindsight-model.ts) from what the server answers: status, memories, directives, mental models, recall, reflect and the request that adds a memory', async () => {
    const bank = stub.bank('hermes');
    bank.memories.push({ id: 'm1', text: 'The owner prefers green tea.', fact_type: 'world', tags: ['drinks'], context: 'chat' }, { id: 'm2', text: 'Deploys happen on Sundays.', fact_type: 'observation' });
    bank.directives.push({ id: 'd1', name: 'Be brief', content: 'Answer in two sentences.', priority: 5, is_active: true, tags: [] });
    bank.mentalModels.push({ id: 'mm1', name: 'Deploy habits', source_query: 'When does the owner deploy?', content: 'Sundays.', tags: ['ops'] });
    await connectHindsight();
    const read = async (route: string) => (await owner.call('GET', route)).body;

    const status = parseStatus(await read(statusPath('default')));
    const memories = parseMemories(await read(memoriesPath('hermes', 'default', { q: '', kind: '', offset: 0 })));
    const observed = parseMemories(await read(memoriesPath('hermes', 'default', { q: 'sundays', kind: 'observation', offset: 0 })));
    const directives = parseDirectives(await read(directivesPath('hermes', 'default')));
    const models = parseMentalModels(await read(mentalModelsPath('hermes', 'default')));
    const recallAsked = recallRequest('hermes', 'default', { query: ' green tea ', budget: 'mid' });
    const recalled = parseRecall((await owner.call(recallAsked.method, recallAsked.path, { body: recallAsked.body })).body);
    const reflectAsked = reflectRequest('hermes', 'default', { query: 'deploys', budget: 'low' });
    const reflected = parseReflect((await owner.call(reflectAsked.method, reflectAsked.path, { body: reflectAsked.body })).body);
    const retainAsked = retainRequest('hermes', 'default', '  Cats are lovely.  ', ['pets']);
    const retained = await owner.call(retainAsked.method, retainAsked.path, { body: retainAsked.body });

    expect(startBank(status)).toBe('hermes');
    expect(status).toMatchObject({ state: 'connected', version: '0.6.2', banks: [{ id: 'hermes', facts: 2 }] });
    expect(memories).toEqual({ total: 2, rows: [expect.objectContaining({ id: 'm1', text: 'The owner prefers green tea.', kind: 'world', tags: ['drinks'], context: 'chat' }), expect.objectContaining({ id: 'm2', kind: 'observation' })] });
    expect(observed.rows.map((row) => row.id)).toEqual(['m2']);
    expect(directives.rows).toEqual([{ id: 'd1', name: 'Be brief', content: 'Answer in two sentences.', priority: 5, active: true, tags: [] }]);
    expect(models.rows).toEqual([expect.objectContaining({ id: 'mm1', name: 'Deploy habits', content: 'Sundays.', sourceQuery: 'When does the owner deploy?', tags: ['ops'], stale: false })]);
    expect(recalled).toEqual([expect.objectContaining({ id: 'm1', text: 'The owner prefers green tea.', kind: 'world' })]);
    expect(recalled[0].score).toBeGreaterThan(0);
    expect(reflected.answer).toContain('Sundays');
    expect(reflected.memories).toEqual([expect.objectContaining({ id: 'm2' })]);
    expect(reflected.directives).toEqual([{ id: 'd1', name: 'Be brief' }]);
    expect(retained.status).toBe(200);
    expect(stub.bank('hermes').memories.at(-1)).toMatchObject({ text: 'Cats are lovely.', tags: ['pets'] });
  });
});
