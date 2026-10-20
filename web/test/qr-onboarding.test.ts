import { describe, expect, test } from 'vitest';
import { clock, onboardingRequests, parseAllowedUsers, readOnboarding, readTelegramPoll, readWhatsAppPoll, secondsLeft } from '../src/modules/channels/qr-onboarding.ts';

describe('what Hermes answers to starting and polling', () => {
  const qr = { phase: 'qr', pairingId: 'p1', qr: 'tg://x', link: 'https://t.me/x', expiresAt: '2026-10-19T10:00:00Z' } as const;

  test('Telegram: starting gives the QR and the link to open instead, and a poll says waiting, ready (with the bot and who scanned) or expired', () => {
    expect(readOnboarding('telegram', { pairing_id: 'p1', deep_link: 'https://t.me/x', qr_payload: '', expires_at: '2026-10-19T10:00:00Z', suggested_username: 'hermes_bot' })).toEqual({ ...qr, qr: 'https://t.me/x', link: 'https://t.me/x', suggestedName: 'hermes_bot' });
    expect(readOnboarding('telegram', { pairing_id: 'p1' })).toBeUndefined();
    expect(readTelegramPoll(200, { status: 'waiting', expires_at: '2026-10-19T10:01:00Z' }, 'p1', qr)).toEqual({ ...qr, expiresAt: '2026-10-19T10:01:00Z' });
    expect(readTelegramPoll(200, { status: 'ready', bot_username: 'hermes_bot', owner_user_id: '42' }, 'p1', qr)).toEqual({ phase: 'linked', pairingId: 'p1', account: '@hermes_bot', suggestedUsers: '42' });
    expect(readTelegramPoll(410, { detail: 'Telegram setup expired. Start a new setup.' }, 'p1', qr)).toEqual({ phase: 'expired', message: 'Telegram setup expired. Start a new setup.' });
    expect(readTelegramPoll(502, { detail: 'Telegram setup service is not configured.' }, 'p1', qr).phase).toBe('failed');
  });

  test('WhatsApp: installing and starting have no QR yet, a waiting answer with a payload is the QR, connected is linked (the number is offered), and errors say why', () => {
    expect(readWhatsAppPoll(200, { pairing_id: 'w1', status: 'installing' })).toEqual({ phase: 'preparing', pairingId: 'w1' });
    expect(readWhatsAppPoll(200, { pairing_id: 'w1', status: 'waiting', qr_payload: '2@abc', expires_at: 'E' })).toEqual({ phase: 'qr', pairingId: 'w1', qr: '2@abc', link: '2@abc', expiresAt: 'E' });
    expect(readWhatsAppPoll(200, { pairing_id: 'w1', status: 'connected', account_name: 'Ada', account_phone: '61400111222', allowed_users: '' })).toEqual({ phase: 'linked', pairingId: 'w1', account: 'Ada', suggestedUsers: '61400111222' });
    expect(readWhatsAppPoll(200, { pairing_id: 'w1', status: 'error', error: 'bridge died' })).toEqual({ phase: 'failed', message: 'bridge died' });
    expect(readWhatsAppPoll(410, { detail: 'WhatsApp setup expired.' }).phase).toBe('expired');
    expect(readWhatsAppPoll(200, { pairing_id: 'w1', status: 'expired' }).phase).toBe('expired');
  });
});

describe('onboardingRequests', () => {
  test('are the routes the policy map classifies: start, status and cancel by pairing id, apply with the allowed users in the shape each platform takes', () => {
    expect(onboardingRequests.start('telegram', 'coder')).toEqual({ method: 'POST', path: '/api/messaging/telegram/onboarding/start', body: {} });
    expect(onboardingRequests.start('whatsapp', 'coder').body).toEqual({ mode: 'bot', allowed_users: '', profile: 'coder' });
    expect(onboardingRequests.status('telegram', 'a/b')).toEqual({ method: 'GET', path: '/api/messaging/telegram/onboarding/a%2Fb' });
    expect(onboardingRequests.cancel('whatsapp', 'w1').method).toBe('DELETE');
    expect(onboardingRequests.apply('telegram', 'p1', 'coder', ['1', '2']).body).toEqual({ allowed_user_ids: ['1', '2'], profile: 'coder' });
    expect(onboardingRequests.apply('whatsapp', 'w1', 'coder', ['6140', '6141']).body).toEqual({ allowed_users: '6140,6141', profile: 'coder' });
  });
});

describe('parseAllowedUsers', () => {
  test('Telegram needs numeric ids and at least one; WhatsApp needs phone numbers and may be blank', () => {
    expect(parseAllowedUsers('telegram', '123, 456\n123')).toEqual({ ok: true, users: ['123', '456'] });
    expect(parseAllowedUsers('telegram', '')).toMatchObject({ ok: false });
    expect(parseAllowedUsers('telegram', '12 @bob')).toMatchObject({ ok: false, message: expect.stringContaining('@bob') });
    expect(parseAllowedUsers('whatsapp', '+61400111222, 61400111333')).toEqual({ ok: true, users: ['+61400111222', '61400111333'] });
    expect(parseAllowedUsers('whatsapp', '')).toEqual({ ok: true, users: [] });
    expect(parseAllowedUsers('whatsapp', '12')).toMatchObject({ ok: false });
  });
});

describe('expiry', () => {
  test('counts seconds left, never below zero, and writes them as a clock', () => {
    const now = Date.parse('2026-10-19T10:00:00Z');
    expect(secondsLeft('2026-10-19T10:04:05Z', now)).toBe(245);
    expect(secondsLeft('2026-10-19T09:00:00Z', now)).toBe(0);
    expect(secondsLeft(null, now)).toBeUndefined();
    expect(secondsLeft('soon', now)).toBeUndefined();
    expect(clock(245)).toBe('4:05');
  });
});
