import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchFakeHermes, scriptFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Connect › Channels (M5 #02) at the Caduceus HTTP seam, in front of the fake Hermes: a stub upstream that can do what the real
// Hermes must never do (echo a secret whole). What the real Hermes answers for the same routes is in channels-hermes.test.ts.
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

const RAW_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789';

const platform = (envVars: Record<string, unknown>[]) => ({
  env_path: '/home/.env',
  gateway_start_command: 'hermes gateway start',
  platforms: [{ id: 'telegram', name: 'Telegram', enabled: true, configured: true, state: 'connected', env_vars: envVars }],
});

describe('what the browser is told about a channel’s secrets', () => {
  test('a secret that Hermes sends whole is masked on the way, and what Hermes redacts is passed on as it came', async () => {
    const { backend, get } = await start();
    await scriptFakeHermes(backend, {
      '/api/messaging/platforms': platform([
        { key: 'TELEGRAM_BOT_TOKEN', is_password: true, is_set: true, redacted_value: RAW_TOKEN },
        { key: 'TELEGRAM_ALLOWED_USERS', is_password: false, is_set: true, redacted_value: '***' },
        { key: 'TELEGRAM_PROXY', is_password: false, is_set: false, redacted_value: null },
        { key: 'OTHER_TOKEN', is_password: true, is_set: true, redacted_value: '1234...6789' },
      ]),
    });

    const answer = await get('/api/messaging/platforms');

    expect(answer.status).toBe(200);
    expect(answer.text).not.toContain(RAW_TOKEN);
    const [telegram] = (JSON.parse(answer.text) as { platforms: { env_vars: { key: string; redacted_value: string | null }[] }[] }).platforms;
    expect(telegram.env_vars.map((field) => [field.key, field.redacted_value])).toEqual([
      ['TELEGRAM_BOT_TOKEN', '***'],
      ['TELEGRAM_ALLOWED_USERS', '***'],
      ['TELEGRAM_PROXY', null],
      ['OTHER_TOKEN', '1234...6789'],
    ]);
  });
});
