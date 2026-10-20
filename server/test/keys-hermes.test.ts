import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { emptyEndpointForm, endpointDelete, endpointFormOf, endpointSave, followLogin, keyRemove, keyReplace, keyReveal, keyTest, keyVerdict, oauthCancelSession, oauthDisconnect, oauthPollPath, oauthStart, parseDeviceCode, parseEndpoints, parseKeys, parseKeyTest, parseOauth, parsePool, parsePortal, poolAdd, poolRemove, providerCheck, type DeviceCode, type EndpointForm, type KeysRequest } from '../../web/src/modules/keys/keys-model.ts';
import { openGatewayConnection } from './fixtures/gateway-client.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { PORTAL_ACCESS_TOKEN, PORTAL_REFRESH_TOKEN, PORTAL_USER_CODE, startDevicePortal, type DevicePortal } from './fixtures/device-code-portal.ts';
import { startStubLlm } from './fixtures/stub-llm.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// System › Keys (M5 #10) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The page's own reading and
// request code (`web/src/modules/keys/keys-model.ts`) is run over what Hermes really answers. Every key here is a made-up string, and
// nothing in this file reaches a provider: the one provider whose keys Hermes checks over the network is never asked, and the device-code
// sign-in is MiniMax's, against a portal on this machine (`fixtures/device-code-portal.ts`).
let hermes: TestHermes;
let portal: DevicePortal;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  portal = await startDevicePortal();
  hermes = await launchTestHermes({ env: { MINIMAX_PORTAL_BASE_URL: portal.url } });
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
  await portal.close();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

interface Answer<T> {
  status: number;
  body: T;
  headers: Headers;
  text: string;
}

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Answer<T>>;
  /** Sends one of the page's requests the way the tiered dialog does for a T3: with the typed confirmation of `typed`. */
  send<T = unknown>(request: KeysRequest, typed?: string): Promise<Answer<T>>;
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
    return { status: res.status, headers: res.headers, text, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as never };
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
  return { call, send, url, cookie };
}

const auditOf = async (owner: Owner) => (await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body.entries;
const keysOf = async (owner: Owner, profile = 'default') => parseKeys((await owner.call('GET', `/api/env?profile=${profile}`)).body);

const FAKE = 'fw-FAKE-0123456789-abcdefghij';

describe('a provider key', () => {
  test('is replaced and removed at Tier 2, revealed only at Tier 3, never sent to the page, and every one is audited by name', async () => {
    const guest = await start({ steppedUp: false });
    const refused = await guest.send<PolicyRefusal>(keyReplace('FIREWORKS_API_KEY', FAKE, 'default'));
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    await server!.close();

    const owner = await start();
    expect((await keysOf(owner)).flatMap((group) => group.keys).find((key) => key.name === 'FIREWORKS_API_KEY')).toMatchObject({ isSet: false });
    const saved = await owner.send(keyReplace('FIREWORKS_API_KEY', FAKE, 'default'));
    const listing = await owner.call('GET', '/api/env?profile=default');
    expect(saved.status).toBe(200);
    expect(listing.text).not.toContain(FAKE);
    expect(listing.text).not.toContain('abcdefghij');
    expect((await keysOf(owner)).flatMap((group) => group.keys).find((key) => key.name === 'FIREWORKS_API_KEY')).toMatchObject({ isSet: true, provider: 'fireworks', secret: true });

    const unconfirmed = await owner.send<PolicyRefusal>(keyReveal('FIREWORKS_API_KEY', 'default'));
    expect(unconfirmed.body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    const revealed = await owner.send<{ value: string }>(keyReveal('FIREWORKS_API_KEY', 'default'), 'FIREWORKS_API_KEY');
    expect(revealed.status).toBe(200);
    expect(revealed.body.value).toBe(FAKE);
    // The one answer that carries a secret is kept by no cache.
    expect(revealed.headers.get('cache-control')).toBe('no-store');

    const removed = await owner.send(keyRemove('FIREWORKS_API_KEY', 'default'));
    expect(removed.status).toBe(200);
    expect((await keysOf(owner)).flatMap((group) => group.keys).find((key) => key.name === 'FIREWORKS_API_KEY')).toMatchObject({ isSet: false });

    const audit = await auditOf(owner);
    const entry = (action: string) => audit.find((row) => row.action === action);
    expect(entry('PUT /api/env')).toMatchObject({ tier: 'T2', profile: 'default', target: '/api/env (FIREWORKS_API_KEY)' });
    expect(entry('POST /api/env/reveal')).toMatchObject({ tier: 'T3', profile: 'default', target: '/api/env/reveal (FIREWORKS_API_KEY)' });
    expect(entry('DELETE /api/env')).toMatchObject({ tier: 'T2', profile: 'default', target: '/api/env (FIREWORKS_API_KEY)' });
    expect(JSON.stringify(audit)).not.toContain(FAKE);
  });
});

const POOLED = 'fw-POOLED-9876543210-zyxwvutsrq';
const poolOf = async (owner: Owner, profile = 'default') => parsePool((await owner.call('GET', `/api/credentials/pool?profile=${profile}`)).body);

describe('the credential pool', () => {
  test('lists, adds (Tier 2) and removes (Tier 2, by the entry the owner saw) pooled credentials, and no part of a credential reaches the page', async () => {
    const owner = await start();
    expect(await poolOf(owner)).toEqual([]);

    const added = await owner.send(poolAdd('fireworks', POOLED, 'backup', 'default'));
    const listing = await owner.call('GET', '/api/credentials/pool?profile=default');
    const pool = parsePool(listing.body);
    expect(added.status).toBe(200);
    expect(listing.text).not.toContain(POOLED);
    expect(listing.text).not.toContain('zyxwvutsrq');
    expect(listing.text).not.toContain('token_preview');
    const fireworks = pool.find((provider) => provider.provider === 'fireworks')!;
    expect(fireworks.entries).toEqual([expect.objectContaining({ index: 1, label: 'backup', authType: 'api_key', source: 'manual', status: undefined, requests: 0 })]);

    const removed = await owner.send(poolRemove('fireworks', fireworks.entries[0].index, 'default'));
    expect(removed.status).toBe(200);
    expect(await poolOf(owner)).toEqual([]);

    const audit = await auditOf(owner);
    expect(audit.find((row) => row.action === 'POST /api/credentials/pool')).toMatchObject({ tier: 'T2', profile: 'default', target: '/api/credentials/pool (fireworks)' });
    expect(audit.find((row) => row.action === 'DELETE /api/credentials/pool/{provider}/{index}')).toMatchObject({ tier: 'T2', profile: 'default', target: '/api/credentials/pool/fireworks/1' });
    expect(JSON.stringify(audit)).not.toContain(POOLED);
  });
});

const ENDPOINT_KEY = 'ep-SECRET-5566778899-endpointkey';

describe('custom endpoints', () => {
  test('are created, edited without losing their key, and deleted at Tier 2; the page is never shown any of the key', async () => {
    const llm = await startStubLlm();
    try {
      const owner = await start();
      const listOf = async () => {
        const listing = await owner.call('GET', '/api/providers/custom-endpoints?profile=default');
        expect(listing.text).not.toContain(ENDPOINT_KEY);
        expect(listing.text).not.toContain('endpointkey');
        return parseEndpoints(listing.body);
      };
      expect(await listOf()).toEqual([]);

      const form: EndpointForm = { ...emptyEndpointForm(), name: 'Local vLLM', baseUrl: llm.baseUrl, model: 'stub-model', apiKey: ENDPOINT_KEY, contextLength: '32000' };
      const created = await owner.send(endpointSave(form, 'default'));
      expect(created.status).toBe(200);
      expect(created.text).not.toContain(ENDPOINT_KEY);
      expect(created.text).not.toContain('endpointkey');
      const [endpoint] = await listOf();
      expect(endpoint).toMatchObject({ id: 'local-vllm', name: 'Local vLLM', baseUrl: llm.baseUrl, model: 'stub-model', models: ['stub-model'], contextLength: 32000, hasApiKey: true, isCurrent: false, apiMode: '' });

      // An edit that types no key keeps the one Hermes holds; one that asks to clear it clears it.
      const renamed = await owner.send(endpointSave({ ...endpointFormOf(endpoint), model: 'stub-model-large', apiMode: 'chat_completions' }, 'default'));
      expect(renamed.status).toBe(200);
      expect((await listOf())[0]).toMatchObject({ id: 'local-vllm', model: 'stub-model-large', apiMode: 'chat_completions', hasApiKey: true });
      await owner.send(endpointSave({ ...endpointFormOf(endpoint), clearKey: true }, 'default'));
      expect((await listOf())[0]).toMatchObject({ id: 'local-vllm', hasApiKey: false });

      const removed = await owner.send(endpointDelete('local-vllm', 'default'));
      expect(removed.status).toBe(200);
      expect(await listOf()).toEqual([]);

      const audit = await auditOf(owner);
      expect(audit.filter((row) => row.action === 'POST /api/providers/custom-endpoints')).toHaveLength(3);
      expect(audit.find((row) => row.action === 'POST /api/providers/custom-endpoints')).toMatchObject({ tier: 'T2', profile: 'default', target: '/api/providers/custom-endpoints (Local vLLM)' });
      expect(audit.find((row) => row.action === 'DELETE /api/providers/custom-endpoints/{endpoint_id}')).toMatchObject({ tier: 'T2', profile: 'default', target: '/api/providers/custom-endpoints/local-vllm' });
      expect(JSON.stringify(audit)).not.toContain(ENDPOINT_KEY);
    } finally {
      await llm.close();
    }
  });
});

describe('Test connection', () => {
  test('checks the key Hermes holds with Hermes\'s own validation, and reports the verdict per key without the page ever holding the key', async () => {
    const llm = await startStubLlm();
    try {
      const owner = await start();
      await owner.send(keyReplace('FIREWORKS_API_KEY', FAKE, 'default'));
      await owner.send(keyReplace('OPENAI_BASE_URL', llm.baseUrl, 'default'));

      // Hermes has no live check for this provider, so the verdict is that the key could not be checked, not that it works.
      const unchecked = await owner.send<unknown>(keyTest('FIREWORKS_API_KEY', 'default'));
      expect(unchecked.status).toBe(200);
      expect(unchecked.text).not.toContain(FAKE);
      expect(parseKeyTest(unchecked.body)).toEqual({ ok: true, reachable: false, message: '', models: [] });
      expect(keyVerdict(parseKeyTest(unchecked.body))).toMatchObject({ state: 'unchecked' });

      // An endpoint Hermes can reach answers with the models it lists.
      const reached = parseKeyTest((await owner.send<unknown>(keyTest('OPENAI_BASE_URL', 'default'))).body);
      expect(reached).toMatchObject({ ok: true, reachable: true, models: ['stub-model', 'stub-model-large'] });
      expect(keyVerdict(reached)).toMatchObject({ state: 'works' });

      // A value typed in the Replace sheet is checked the same way before it is saved: Hermes looks at it and stores nothing.
      const typed = parseKeyTest((await owner.send<unknown>(providerCheck('OPENAI_BASE_URL', llm.baseUrl))).body);
      expect(typed).toMatchObject({ ok: true, reachable: true, models: ['stub-model', 'stub-model-large'] });
      expect(llm.requests).toContain('GET /v1/models');

      // A key that is not set has nothing to check, and no request goes anywhere.
      const missing = await owner.send<{ error: string }>(keyTest('ANTHROPIC_API_KEY', 'default'));
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe('not-set');

      const audit = await auditOf(owner);
      const tests = audit.filter((row) => row.action === 'POST /_caduceus/api/keys/test');
      expect(tests.map((row) => row.target)).toEqual(['/_caduceus/api/keys/test (ANTHROPIC_API_KEY)', '/_caduceus/api/keys/test (OPENAI_BASE_URL)', '/_caduceus/api/keys/test (FIREWORKS_API_KEY)']);
      expect(tests[1]).toMatchObject({ tier: 'T1', profile: 'default' });
      expect(JSON.stringify(audit)).not.toContain(FAKE);

      // It changes nothing, so read-only mode lets it through; a key's reveal is the one T3, and read-only mode refuses that.
      await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
      expect((await owner.send(keyTest('OPENAI_BASE_URL', 'default'))).status).toBe(200);
      expect((await owner.send(keyReveal('OPENAI_BASE_URL', 'default'), 'OPENAI_BASE_URL')).status).toBe(403);
      await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
      await owner.send(keyRemove('FIREWORKS_API_KEY', 'default'));
      await owner.send(keyRemove('OPENAI_BASE_URL', 'default'));
    } finally {
      await llm.close();
    }
  });
});

/**
 * Follows a sign-in the way the page does, over the owner's session. The wait is a real one, because the sign-in ends on Hermes's own worker thread,
 * which checks the portal every two seconds, and nothing over REST says when: a bounded poll of an OS-level fact.
 */
function follow(owner: Owner, code: DeviceCode) {
  return followLogin(code, {
    poll: async () => {
      const answer = await owner.call('GET', oauthPollPath('minimax-oauth', code.sessionId, 'default'));
      return { status: answer.status, body: answer.body };
    },
    wait: (ms) => sleep(Math.min(ms, 250)).then(() => undefined),
    now: Date.now,
  });
}
const minimaxOf = async (owner: Owner) => {
  const listing = await owner.call('GET', '/api/providers/oauth?profile=default');
  // No token, in whole or in part, reaches the page.
  for (const secret of [PORTAL_ACCESS_TOKEN, PORTAL_REFRESH_TOKEN, 'token_preview']) expect(listing.text).not.toContain(secret);
  return parseOauth(listing.body).find((provider) => provider.id === 'minimax-oauth')!;
};

describe('signing in with an account', () => {
  test('Hermes runs the device-code sign-in: the page gets the code and the link, follows it to approval, and the account can be disconnected at Tier 2', async () => {
    // Disconnecting is a Tier 2 action: a session that has not been stepped up with a passkey is refused.
    const guest = await start({ steppedUp: false });
    const refused = await guest.send<PolicyRefusal>(oauthDisconnect('minimax-oauth', 'default'));
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    await server!.close();

    const owner = await start();
    expect(await minimaxOf(owner)).toMatchObject({ name: 'MiniMax (OAuth)', flow: 'device_code', loggedIn: false, disconnectable: true });

    const started = await owner.send(oauthStart('minimax-oauth', 'default'));
    const code = parseDeviceCode(started.body)!;
    expect(code).toMatchObject({ userCode: PORTAL_USER_CODE, expiresIn: 600, pollInterval: 2 });
    expect(code.verificationUrl).toBe(`${portal.url}/device`);
    expect(await minimaxOf(owner)).toMatchObject({ loggedIn: false });

    portal.approve();
    expect(await follow(owner, code)).toEqual({ state: 'approved' });
    const signedIn = await minimaxOf(owner);
    expect(signedIn).toMatchObject({ loggedIn: true, hasRefresh: true, sourceLabel: 'MiniMax (global)' });
    expect(Date.parse(signedIn.expiresAt!)).toBeGreaterThan(Date.now());

    expect((await owner.send(oauthDisconnect('minimax-oauth', 'default'))).status).toBe(200);
    expect(await minimaxOf(owner)).toMatchObject({ loggedIn: false });

    const audit = await auditOf(owner);
    expect(audit.find((row) => row.action === 'POST /api/providers/oauth/{provider_id}/start')).toMatchObject({ tier: 'T1', profile: 'default', target: '/api/providers/oauth/minimax-oauth/start' });
    expect(audit.find((row) => row.action === 'DELETE /api/providers/oauth/{provider_id}')).toMatchObject({ tier: 'T2', profile: 'default', target: '/api/providers/oauth/minimax-oauth' });
    for (const secret of [PORTAL_ACCESS_TOKEN, PORTAL_REFRESH_TOKEN]) expect(JSON.stringify(audit)).not.toContain(secret);
  });

  test('a sign-in the person declines ends with the reason Hermes gives, and nothing is signed in', async () => {
    const owner = await start();
    portal.next(600);
    portal.deny();
    const code = parseDeviceCode((await owner.send(oauthStart('minimax-oauth', 'default'))).body)!;

    const end = await follow(owner, code);

    expect(end).toMatchObject({ state: 'error', message: expect.stringContaining('MiniMax OAuth reported an error') });
    expect(await minimaxOf(owner)).toMatchObject({ loggedIn: false });
  });

  test('a code nobody approves in time ends as expired', async () => {
    const owner = await start();
    portal.next(3);
    const code = parseDeviceCode((await owner.send(oauthStart('minimax-oauth', 'default'))).body)!;
    expect(code.expiresIn).toBe(3);

    expect(await follow(owner, code)).toMatchObject({ state: 'expired' });
    expect(await minimaxOf(owner)).toMatchObject({ loggedIn: false });
  });

  test('a sign-in that is cancelled is forgotten by Hermes, and a provider Hermes cannot sign in is refused in its words', async () => {
    const owner = await start();
    portal.next(600);
    const code = parseDeviceCode((await owner.send(oauthStart('minimax-oauth', 'default'))).body)!;

    const cancelled = await owner.send<{ ok: boolean }>(oauthCancelSession(code.sessionId, 'default'));
    expect(cancelled.body.ok).toBe(true);
    expect(await follow(owner, code)).toMatchObject({ state: 'expired', message: expect.stringContaining('no longer') });

    const external = await owner.send<{ detail: string }>(oauthStart('qwen-oauth', 'default'));
    expect(external.status).toBe(400);
    expect(external.body.detail).toContain('hermes auth add qwen-oauth');
    const providers = parseOauth((await owner.call('GET', '/api/providers/oauth?profile=default')).body);
    expect(providers.find((provider) => provider.id === 'qwen-oauth')).toMatchObject({ flow: 'external', cliCommand: expect.stringContaining('qwen-oauth'), disconnectable: false, disconnectHint: expect.any(String) });
  });
});

describe('the Nous Portal card', () => {
  test('shows what Hermes says of the subscription, and every billing or subscription call is refused by the proxy', async () => {
    const owner = await start();
    const portalAnswer = await owner.call('GET', '/api/portal?profile=default');
    expect(portalAnswer.status).toBe(200);
    expect(parsePortal(portalAnswer.body)).toMatchObject({ loggedIn: false, freeTier: false, subscriptionUrl: 'https://portal.nousresearch.com/manage-subscription', features: expect.arrayContaining([{ label: 'Web tools', state: 'not configured' }]) });

    // Nothing in Hermes's REST API is a billing or subscription action, and anything the proxy does not know is not forwarded.
    const attempts = [
      ['POST', '/api/portal/subscribe'],
      ['POST', '/api/billing/charge'],
      ['PUT', '/api/billing/auto-reload'],
      ['POST', '/api/subscription/change'],
      ['DELETE', '/api/subscription'],
    ];
    const refused = await Promise.all(attempts.map(([method, route]) => owner.call<PolicyRefusal>(method, route, { body: {} })));
    expect(refused.map((answer) => [answer.status, answer.body.error, answer.body.tier])).toEqual(attempts.map(() => [403, 'denied', 'denied']));

    // The gateway's billing and subscription methods are Denied by name, and the answer to the page is the policy's.
    const gateway = openGatewayConnection(owner.url, owner.cookie);
    await gateway.until((status) => status.state === 'connected');
    const methods = ['billing.state', 'billing.charge', 'billing.auto_reload', 'subscription.change', 'subscription.preview', 'subscription.resume'];
    const answers = await Promise.all(methods.map((method) => gateway.connection.client.request(method, {}).then(() => 'allowed', (error: unknown) => (error instanceof Error ? error.message : String(error)))));
    gateway.connection.close();
    expect(answers).toEqual(methods.map(() => 'Billing and subscription changes are not available through Caduceus. Make them on the provider’s own site.'));
  });
});
