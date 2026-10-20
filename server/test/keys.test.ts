import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchFakeHermes, scriptFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// System › Keys (M5 #10) at the Caduceus HTTP seam, in front of the fake Hermes: a stub upstream that can do what the real Hermes must
// never do (list a credential with more of it than its redaction, or whole). What the real Hermes answers for the same routes is in
// keys-hermes.test.ts.
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

const WHOLE_KEY = 'sk-WHOLE-0123456789-abcdefghijklmnop';

describe('what the browser is told about credentials', () => {
  test('the environment lists a key as set and never with a preview of it, even one Hermes sent whole', async () => {
    const { backend, get } = await start();
    await scriptFakeHermes(backend, {
      '/api/env': { OPENROUTER_API_KEY: { is_set: true, redacted_value: WHOLE_KEY, category: 'provider', is_password: true }, ANTHROPIC_API_KEY: { is_set: false, redacted_value: null, category: 'provider', is_password: true } },
    });

    const answer = await get('/api/env');

    expect(answer.status).toBe(200);
    expect(answer.text).not.toContain('sk-WHOLE');
    expect(JSON.parse(answer.text)).toMatchObject({ OPENROUTER_API_KEY: { is_set: true, redacted_value: null }, ANTHROPIC_API_KEY: { is_set: false, redacted_value: null } });
  });

  test('a pooled credential is listed by its standing; the token preview and any field Caduceus does not know are dropped', async () => {
    const { backend, get } = await start();
    await scriptFakeHermes(backend, {
      '/api/credentials/pool': {
        providers: [{ provider: 'fireworks', entries: [{ index: 1, id: 'abc123', label: 'main', auth_type: 'api_key', source: 'manual', priority: 0, last_status: 'ok', request_count: 7, has_refresh: false, token_preview: 'sk-W...mnop', access_token: WHOLE_KEY, refresh_token: WHOLE_KEY }] }],
      },
    });

    const answer = await get('/api/credentials/pool');

    expect(answer.text).not.toContain('sk-W');
    expect(answer.text).not.toContain('abcdefghijklmnop');
    expect(JSON.parse(answer.text)).toEqual({ providers: [{ provider: 'fireworks', entries: [{ index: 1, id: 'abc123', label: 'main', auth_type: 'api_key', source: 'manual', priority: 0, last_status: 'ok', request_count: 7, has_refresh: false }] }] });
  });

  test('an OAuth provider says whether it is signed in and until when; the token preview and any field Caduceus does not know are dropped', async () => {
    const { backend, get } = await start();
    await scriptFakeHermes(backend, {
      '/api/providers/oauth': {
        providers: [{ id: 'nous', name: 'Nous Portal', flow: 'device_code', disconnectable: true, status: { logged_in: true, source: 'nous_portal', source_label: 'Nous Portal', token_preview: '...mnop', expires_at: '2030-01-01T00:00:00Z', has_refresh_token: true, free_tier: false, account_tier: 'pro', access_token: WHOLE_KEY } }],
      },
    });

    const answer = await get('/api/providers/oauth');

    expect(answer.text).not.toContain('mnop');
    expect(answer.text).not.toContain('abcdefghijkl');
    expect(JSON.parse(answer.text).providers[0]).toEqual({ id: 'nous', name: 'Nous Portal', flow: 'device_code', disconnectable: true, status: { logged_in: true, source: 'nous_portal', source_label: 'Nous Portal', expires_at: '2030-01-01T00:00:00Z', has_refresh_token: true, free_tier: false, account_tier: 'pro' } });
  });

  test('a custom endpoint says it has a key and shows only the variable that holds it; a key written in its place is never shown', async () => {
    const { backend, get } = await start();
    await scriptFakeHermes(backend, {
      '/api/providers/custom-endpoints': {
        endpoints: [
          { id: 'held', name: 'Held', base_url: 'http://127.0.0.1:9/v1', model: 'm', models: ['m'], has_api_key: true, api_key_preview: '${HERMES_CUSTOM_HELD_API_KEY}', is_current: false, source: 'providers' },
          { id: 'legacy', name: 'Legacy', base_url: 'http://127.0.0.1:9/v1', model: 'm', models: ['m'], has_api_key: true, api_key_preview: 'sk-W...mnop', is_current: false, source: 'providers' },
        ],
        current: { provider: '', model: '', base_url: '' },
      },
    });

    const answer = await get('/api/providers/custom-endpoints');

    expect(answer.text).not.toContain('sk-W');
    const [held, legacy] = JSON.parse(answer.text).endpoints;
    expect(held).toMatchObject({ has_api_key: true, api_key_preview: '${HERMES_CUSTOM_HELD_API_KEY}' });
    expect(legacy).toMatchObject({ has_api_key: true, api_key_preview: '' });
  });
});
