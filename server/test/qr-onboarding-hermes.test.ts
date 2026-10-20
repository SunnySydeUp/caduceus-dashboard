import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import { parseChannels } from '../../web/src/modules/channels/channels-model.ts';
import { onboardingRequests, readOnboarding, readTelegramPoll, readWhatsAppPoll, type OnboardingState } from '../../web/src/modules/channels/qr-onboarding.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { OFFLINE_ENV } from './fixtures/plugin-repo.ts';
import { startStubTelegramSetup, type StubTelegramSetup } from './fixtures/stub-telegram-setup.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Channels › QR onboarding (M5 #03) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. Hermes's Telegram pairing talks to a local stand-in for
// Nous's setup service (`TELEGRAM_ONBOARDING_URL`); WhatsApp's link is the one Hermes finds on disk (its bridge is never started: it needs a phone). The page's own request and
// reading code (`qr-onboarding.ts`) is run over what Hermes really answers. No chat platform is contacted.
let hermes: TestHermes;
let telegram: StubTelegramSetup;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  telegram = await startStubTelegramSetup();
  hermes = await launchTestHermes({ env: { ...OFFLINE_ENV, TELEGRAM_ONBOARDING_URL: telegram.url } });
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
  await telegram.close();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start({ steppedUp = true }: { steppedUp?: boolean } = {}) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  const call = async (request: { method: string; path: string; body?: unknown }) => {
    const res = await fetch(`${url}${request.path}`, {
      method: request.method,
      headers: { origin: url, cookie, ...(request.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    const text = await res.text();
    return { status: res.status, body: (text.startsWith('{') ? JSON.parse(text) : text) as unknown };
  };
  const platform = async (id: string) => parseChannels((await call({ method: 'GET', path: '/api/messaging/platforms?profile=default' })).body).channels.find((channel) => channel.id === id)!;
  const audit = async () => ((await call({ method: 'GET', path: '/_caduceus/api/audit' })).body as { entries: AuditEntry[] }).entries;
  return { call, platform, audit };
}

const qrOf = (state: OnboardingState | undefined) => {
  if (state?.phase !== 'qr') throw new Error(`Expected a QR, got ${state?.phase}`);
  return state;
};

describe('Telegram: Create with QR', () => {
  test('starts a pairing and shows its QR and link, polls until the bot is made, saves the allowed users (T2, audited), and the platform reads as configured and enabled', async () => {
    const { call, platform, audit } = await start();
    const before = await platform('telegram');

    const started = await call(onboardingRequests.start('telegram', 'default'));
    const qr = qrOf(readOnboarding('telegram', started.body));
    const waiting = readTelegramPoll(...(await poll(call, 'telegram', qr.pairingId)), qr.pairingId, qr);
    telegram.scan({ username: 'hermes_test_bot', ownerUserId: '424242' });
    const ready = readTelegramPoll(...(await poll(call, 'telegram', qr.pairingId)), qr.pairingId, qr);
    const apply = onboardingRequests.apply('telegram', qr.pairingId, 'default', ['424242']);
    const saved = await call(apply);
    const after = await platform('telegram');

    expect(before).toMatchObject({ configured: false, enabled: false });
    expect(qr.link).toMatch(/^https:\/\/t\.me\//);
    expect(qr.qr.length).toBeGreaterThan(0);
    expect(waiting).toEqual(qr);
    expect(ready).toEqual({ phase: 'linked', pairingId: qr.pairingId, account: '@hermes_test_bot', suggestedUsers: '424242' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ok: true, platform: 'telegram', bot_username: 'hermes_test_bot' });
    expect(after).toMatchObject({ configured: true, enabled: true });
    expect(fs.readFileSync(path.join(hermes.home, '.env'), 'utf8')).toContain('TELEGRAM_ALLOWED_USERS=424242');
    expect(await audit()).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'POST /api/messaging/telegram/onboarding/{pairing_id}/apply', tier: 'T2' }));
  });

  test('saving the allowed users needs a passkey (T2), and Hermes refuses ids that are not numbers or none at all', async () => {
    const { call } = await start({ steppedUp: false });
    const refused = await call(onboardingRequests.apply('telegram', 'whatever', 'default', ['424242']));
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });

    const owner = await startAgain();
    const none = await owner.call(onboardingRequests.apply('telegram', 'whatever', 'default', []));
    const bad = await owner.call(onboardingRequests.apply('telegram', 'whatever', 'default', ['@bob']));
    expect([none.status, bad.status]).toEqual([400, 400]);
  });

  test('an expired pairing reads as expired, and cancelling leaves nothing configured behind', async () => {
    const { call, platform } = await start();
    const before = await platform('telegram');
    const started = await call(onboardingRequests.start('telegram', 'default'));
    const qr = qrOf(readOnboarding('telegram', started.body));
    telegram.expire();

    const [status, body] = await poll(call, 'telegram', qr.pairingId);
    const expired = readTelegramPoll(status, body, qr.pairingId, qr);
    const second = qrOf(readOnboarding('telegram', (await call(onboardingRequests.start('telegram', 'default'))).body));
    const cancelled = await call(onboardingRequests.cancel('telegram', second.pairingId));
    const afterCancel = await call(onboardingRequests.status('telegram', second.pairingId));

    expect(expired.phase).toBe('expired');
    expect(cancelled.status).toBe(200);
    expect(readTelegramPoll(afterCancel.status, afterCancel.body, second.pairingId, second).phase).toBe('expired');
    expect(await platform('telegram')).toEqual(before);
  });
});

describe('WhatsApp: Pair with QR', () => {
  test('a device Hermes already finds linked reads as linked at once; saving the allowed users (T2, audited) enables the platform, which the card reads without a reload', async () => {
    const session = path.join(hermes.home, 'platforms', 'whatsapp', 'session');
    fs.mkdirSync(session, { recursive: true });
    fs.writeFileSync(path.join(session, 'creds.json'), JSON.stringify({ me: { id: '61400111222:5@s.whatsapp.net', name: 'Ada' } }));
    const { call, platform, audit } = await start();

    const started = await call(onboardingRequests.start('whatsapp', 'default'));
    const linked = readOnboarding('whatsapp', started.body);
    const status = await call(onboardingRequests.status('whatsapp', (linked as { pairingId: string }).pairingId));
    const saved = await call(onboardingRequests.apply('whatsapp', (linked as { pairingId: string }).pairingId, 'default', ['61400111222']));
    const after = await platform('whatsapp');

    expect(linked).toMatchObject({ phase: 'linked', account: 'Ada', suggestedUsers: '61400111222' });
    expect(readWhatsAppPoll(status.status, status.body).phase).toBe('linked');
    expect(saved.status).toBe(200);
    expect(after).toMatchObject({ enabled: true });
    expect(fs.readFileSync(path.join(hermes.home, '.env'), 'utf8')).toContain('WHATSAPP_ALLOWED_USERS=61400111222');
    expect(await audit()).toContainEqual(expect.objectContaining({ action: 'POST /api/messaging/whatsapp/onboarding/{pairing_id}/apply', tier: 'T2' }));
  });
});

async function poll(call: Awaited<ReturnType<typeof start>>['call'], platform: 'telegram' | 'whatsapp', pairingId: string): Promise<[number, unknown]> {
  const answer = await call(onboardingRequests.status(platform, pairingId));
  return [answer.status, answer.body];
}

/** A second owner session that has a step-up, for what the first (without) cannot do. */
async function startAgain() {
  await server?.close();
  server = undefined;
  return start();
}
