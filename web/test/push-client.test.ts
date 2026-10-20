import { describe, expect, test } from 'vitest';
import type { PushMessage } from '@caduceus/contracts/push';
import { badgeCommand } from '../src/app-badge.ts';
import { pushOffer, testPushFailure } from '../src/push-offer.ts';
import { clickTarget, readPush } from '../src/sw/push-rules.ts';

// The device's side of Web Push (M2 #03): what the service worker shows for a message (the fallback for browsers that do not draw a declarative one
// themselves) and where a tap goes, when the page may ask for permission, and the app badge. The server's half is `server/test/push.test.ts`.
const ORIGIN = 'https://mac.tailnet.ts.net:9443';

const declarative = (over: Partial<PushMessage['notification']> = {}): string =>
  JSON.stringify({ web_push: 8030, notification: { title: 'Approve `git push` on coder?', body: 'git push origin main', lang: 'en', dir: 'ltr', navigate: `${ORIGIN}/notices/srq-1`, silent: false, app_badge: 3, ...over } });

describe('what the service worker shows', () => {
  test('a declarative message gives the title, the body, where a tap goes and the badge count', () => {
    expect(readPush(declarative(), ORIGIN)).toEqual({ title: 'Approve `git push` on coder?', body: 'git push origin main', url: `${ORIGIN}/notices/srq-1`, badge: 3 });
  });

  test('a tap never leaves Caduceus: another origin\'s address, or none, opens Today', () => {
    expect(readPush(declarative({ navigate: 'https://evil.example/notices/1' }), ORIGIN).url).toBe(`${ORIGIN}/today`);
    expect(readPush(declarative({ navigate: '' }), ORIGIN).url).toBe(`${ORIGIN}/today`);
    // A path is this origin's.
    expect(readPush(declarative({ navigate: '/notices/srq-2' }), ORIGIN).url).toBe(`${ORIGIN}/notices/srq-2`);
  });

  test('a message that is not declarative (an older server, a plain string) still shows something a person can use, and never throws', () => {
    expect(readPush(JSON.stringify({ title: 'Hello', body: 'World' }), ORIGIN)).toMatchObject({ title: 'Hello', body: 'World', url: `${ORIGIN}/today` });
    expect(readPush('Just some words', ORIGIN)).toMatchObject({ title: 'Caduceus', body: 'Just some words' });
    expect(readPush(undefined, ORIGIN)).toMatchObject({ title: 'Caduceus', body: 'Something needs you.' });
    expect(readPush(JSON.stringify({ web_push: 8030, notification: { title: 7 } }), ORIGIN).title).toBe('Caduceus');
  });

  test('a badge count that is not a count is no badge', () => {
    expect(readPush(declarative({ app_badge: -2 as number }), ORIGIN).badge).toBeUndefined();
    expect(readPush(declarative({ app_badge: 1.5 }), ORIGIN).badge).toBeUndefined();
  });
});

describe('a tap on a notification', () => {
  test('goes to a Caduceus window that is open, and opens one when none is', () => {
    expect(clickTarget(`${ORIGIN}/notices/srq-1`, [{ url: 'https://other.example/', focused: false }, { url: `${ORIGIN}/today`, focused: false }])).toEqual({ kind: 'reuse', index: 1 });
    expect(clickTarget(`${ORIGIN}/notices/srq-1`, [{ url: `${ORIGIN}/today`, focused: false }, { url: `${ORIGIN}/chat`, focused: true }])).toEqual({ kind: 'reuse', index: 1 });
    expect(clickTarget(`${ORIGIN}/notices/srq-1`, [{ url: 'https://other.example/', focused: false }])).toEqual({ kind: 'open' });
    expect(clickTarget(`${ORIGIN}/notices/srq-1`, [])).toEqual({ kind: 'open' });
  });
});

describe('the app badge', () => {
  test('shows the number of items that need a decision and clears at zero', () => {
    expect(badgeCommand(4)).toEqual({ kind: 'set', count: 4 });
    expect(badgeCommand(0)).toEqual({ kind: 'clear' });
    expect(badgeCommand(-1)).toEqual({ kind: 'clear' });
  });
});

describe('when notifications are offered', () => {
  const env = { supported: true, installed: true, platform: 'other' as const, permission: 'default' as const, subscribed: false };

  test('on iOS only to the installed app, which until then is sent to the install guide', () => {
    expect(pushOffer({ ...env, platform: 'ios', installed: false, supported: false })).toBe('needs-install');
    expect(pushOffer({ ...env, platform: 'ios', installed: true })).toBe('ready');
  });

  test('elsewhere to any browser that can, with its refusal respected', () => {
    expect(pushOffer(env)).toBe('ready');
    expect(pushOffer({ ...env, supported: false })).toBe('unsupported');
    expect(pushOffer({ ...env, permission: 'denied' })).toBe('denied');
    expect(pushOffer({ ...env, permission: 'granted', subscribed: true })).toBe('subscribed');
    // Permission taken away in the browser's settings while Caduceus still thinks it is subscribed.
    expect(pushOffer({ ...env, permission: 'denied', subscribed: true })).toBe('denied');
  });
});

describe('why a test notification did not arrive', () => {
  test('says what the push service answered, in words, and what to do', () => {
    expect(testPushFailure(502, { status: 'gone' })).toBe('The push service says this device’s subscription has ended, so Caduceus forgot it. Turn notifications on again.');
    expect(testPushFailure(502, { status: 'failed' })).toBe('The push service did not take the test notification. Try again in a moment.');
    expect(testPushFailure(404, { error: 'not-subscribed' })).toBe('This device is not subscribed. Turn notifications on first.');
    expect(testPushFailure(500, undefined)).toBe('Caduceus could not send the test notification (HTTP 500).');
  });
});
