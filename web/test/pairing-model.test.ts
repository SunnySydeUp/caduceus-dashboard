import { describe, expect, test } from 'vitest';
import { ageWords, expiryWords, parsePairing, platformName } from '../src/modules/pairing/pairing-model.ts';

describe('reading Hermes’s pairing lists', () => {
  test('a request an older Hermes wrote has no id, so it is listed but cannot be approved; an answer that is not lists is no requests', () => {
    const { pending } = parsePairing({ pending: [{ platform: 'telegram', request_id: '', user_id: '1', user_name: '', age_minutes: 3 }, { user_id: 'no platform' }, 'junk'], approved: [] });
    expect(pending).toEqual([{ platform: 'telegram', requestId: '', userId: '1', userName: '', ageMinutes: 3, approvable: false }]);

    expect(parsePairing(undefined)).toEqual({ pending: [], approved: [] });
    expect(parsePairing({ pending: 'x', approved: {} })).toEqual({ pending: [], approved: [] });
  });

  test('a numeric user id is kept as the text it is, and an approval time without a number is no time', () => {
    const { approved } = parsePairing({ pending: [], approved: [{ platform: 'whatsapp', user_id: 4915123456789, user_name: 'Dee', approved_at: 'never' }] });
    expect(approved).toEqual([{ platform: 'whatsapp', userId: '4915123456789', userName: 'Dee', approvedAt: undefined }]);
  });
});

describe('how a request is named', () => {
  test('its age is in the words a person would use, rounded down, and a platform id reads as a name', () => {
    expect([0, 1, 2, 59, 60, 119, 600].map(ageWords)).toEqual(['just now', '1 minute ago', '2 minutes ago', '59 minutes ago', '1 hour ago', '1 hour ago', '10 hours ago']);
    expect([platformName('telegram'), platformName('whatsapp_cloud'), platformName('qqbot')]).toEqual(['Telegram', 'Whatsapp cloud', 'Qqbot']);
  });
});

describe('how long a request waits', () => {
  test('Hermes keeps it for an hour and then drops it, so an owner who ignores it has refused it', () => {
    expect([0, 10, 59, 60, 90].map(expiryWords)).toEqual([
      'Goes away by itself in about 60 minutes',
      'Goes away by itself in about 50 minutes',
      'Goes away by itself within a minute',
      'Goes away by itself within a minute',
      'Goes away by itself within a minute',
    ]);
  });
});
