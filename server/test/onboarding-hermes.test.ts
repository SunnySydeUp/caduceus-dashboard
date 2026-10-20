import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { setupChecks } from '../../web/src/modules/onboarding/setup-checks.ts';
import { readSetup } from '../../web/src/modules/onboarding/setup-hermes.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';

// The wizard's checks (M5 #16) read what Hermes says through the browser's gateway connection: `setup.status` and `setup.runtime_check`, in front of the
// real Hermes in a temp home. Hermes starts with no provider; the stub LLM is what a provider looks like once the owner has set one up.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let page: TestGatewayConnection | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
afterEach(async () => {
  page?.connection.close();
  page = undefined;
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function openPage() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  page = openGatewayConnection(server.url, await ownerCookie(server.url));
  await page.until((status) => status.state === 'connected');
  return page.connection.client;
}

describe('reading Hermes for the checks', () => {
  test('a Hermes with no provider fails the provider check in Hermes\u2019s words; once the owner has set one up it passes, naming the model', async () => {
    const client = await openPage();

    const before = await readSetup(client, 'default');
    expect(before.status?.provider_configured).toBe(false);
    expect(before.runtime?.ok).toBe(false);
    const failing = setupChecks({ hermesReachable: true, ...before, gateway: { running: false }, connection: 'local', installed: false, passkeys: 0 });
    expect(failing.find((check) => check.id === 'provider')).toMatchObject({ state: 'fail', detail: before.runtime!.error, fix: { to: '/system/keys' } });

    await llm.connect(hermes);
    const after = await readSetup(client, 'default');
    expect(after.status?.provider_configured).toBe(true);
    expect(after.runtime).toMatchObject({ ok: true, model: expect.any(String) });
    const passing = setupChecks({ hermesReachable: true, ...after, gateway: { running: false }, connection: 'local', installed: false, passkeys: 0 });
    expect(passing.find((check) => check.id === 'provider')).toMatchObject({ state: 'pass' });
  });

  test('a profile Hermes does not have is a failed answer, not a crash', async () => {
    const client = await openPage();
    const answer = await readSetup(client, 'no-such-profile');
    expect(answer.status).toMatchObject({ ok: false });
    expect(answer.runtime).toMatchObject({ ok: false });
  });

  test('a provider the owner has just connected is checked on its own, strictly, so another provider\u2019s fallback cannot hide a failed connection', async () => {
    const client = await openPage();
    await llm.connect(hermes);
    // The profile can serve a model (the stub), but OpenRouter has no key: asking about it alone says so.
    expect((await readSetup(client, 'default')).runtime?.ok).toBe(true);
    const strict = await readSetup(client, 'default', 'openrouter');
    expect(strict.runtime).toMatchObject({ ok: false, provider: 'openrouter', error: expect.stringMatching(/openrouter/i) });
  });
});
