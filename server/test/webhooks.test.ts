import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchFakeHermes, scriptFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Connect › Webhooks (M5 #04) at the Caduceus HTTP seam, in front of the fake Hermes: a stub upstream that can do what the real Hermes
// must never do (list a subscription's secret). What the real Hermes answers for the same routes is in webhooks-hermes.test.ts.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
let root: string | undefined;
afterEach(async () => {
  await server?.close();
  await backend?.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  server = undefined;
  backend = undefined;
  root = undefined;
});

async function start() {
  backend = launchFakeHermes();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  server = await startCaduceusServer({ backend, hermesRoot: root });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  return {
    backend,
    async get(route: string) {
      const res = await fetch(`${url}${route}`, { headers: { origin: url, cookie } });
      return { status: res.status, headers: res.headers, text: await res.text() };
    },
  };
}

const SECRET = 'q9f3-LEAKED-hmac-secret-0123456789abcdefghij';

describe('what the browser is told about a subscription’s secret', () => {
  test('a secret that Hermes lists by mistake does not leave Caduceus: the list carries only whether one is set', async () => {
    const { backend, get } = await start();
    await scriptFakeHermes(backend, {
      '/api/webhooks': {
        enabled: true,
        base_url: 'http://localhost:8644',
        subscriptions: [{ name: 'github-push', description: '', events: [], deliver: 'log', deliver_only: false, prompt: '', script: '', skills: [], created_at: null, url: 'http://localhost:8644/webhooks/github-push', secret_set: true, secret: SECRET, enabled: true }],
      },
    });

    const answer = await get('/api/webhooks?profile=default');

    expect(answer.status).toBe(200);
    expect(answer.text).not.toContain(SECRET);
    const [subscription] = (JSON.parse(answer.text) as { subscriptions: Record<string, unknown>[] }).subscriptions;
    expect(subscription).toMatchObject({ name: 'github-push', secret_set: true });
    expect(subscription).not.toHaveProperty('secret');
  });
});
