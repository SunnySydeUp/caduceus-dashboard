import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { credentialIssue, parseEnv } from '../../web/src/modules/chat/composer-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The credential warning of the composer (M1 #08): the chat's provider has no key. Hermes's environment (`GET /api/env`) says which provider
// has which variables set; Add key writes the variable with `PUT /api/env` (T2) and no key is ever read back. Through the Caduceus server, in front of the real Hermes.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  await stepUp(url, cookie, await addPasskey(url, cookie));
  const call = async (method: string, route: string, body?: unknown) => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, text: await res.text() };
  };
  return { url, cookie, call };
}

const SECRET = 'sk-ant-test-0123456789-SECRETVALUE';

describe('adding a key for the chat\'s provider', () => {
  test('Hermes\'s environment shows the provider has no key, Add key sets it, and the key is never read back by anything the page calls', async () => {
    const owner = await start();
    const before = await owner.call('GET', '/api/env');
    expect(credentialIssue({ provider: 'anthropic', env: parseEnv(JSON.parse(before.text)) })).toMatchObject({ provider: 'anthropic', keyVar: 'ANTHROPIC_API_KEY' });

    const saved = await owner.call('PUT', '/api/env', { key: 'ANTHROPIC_API_KEY', value: SECRET });
    expect(saved.status).toBe(200);
    expect(saved.text).not.toContain(SECRET);

    const after = await owner.call('GET', '/api/env');
    expect(credentialIssue({ provider: 'anthropic', env: parseEnv(JSON.parse(after.text)) })).toBeUndefined();
    // Hermes sends a redacted preview of a key that is set; Caduceus takes even that out, so no part of a key reaches the page.
    expect(after.text).not.toContain(SECRET);
    const rows = Object.values(JSON.parse(after.text) as Record<string, { is_set: boolean; redacted_value: string | null }>);
    expect(rows.some((row) => row.is_set)).toBe(true);
    expect(rows.filter((row) => row.redacted_value !== null)).toEqual([]);
    // The page has no way to ask for it: Hermes's reveal is T3 and is refused without the owner typing the variable's name.
    const revealed = await owner.call('POST', '/api/env/reveal', { key: 'ANTHROPIC_API_KEY' });
    expect(revealed.status).not.toBe(200);
    expect(revealed.text).not.toContain(SECRET);
    // Hermes's model list agrees: the provider is set up now.
    const options = JSON.parse((await owner.call('GET', '/api/model/options?include_unconfigured=true')).text) as { providers: { slug: string; authenticated?: boolean }[] };
    expect(options.providers.find((provider) => provider.slug === 'anthropic')).toMatchObject({ authenticated: true });
  });
});
