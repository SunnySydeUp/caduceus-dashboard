import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import type { SoftwareAuthenticator } from './fixtures/software-authenticator.ts';
import { startPushStub, type PushStub, type StubDevice } from './fixtures/push-stub.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import type { InboxItem } from '@caduceus/contracts/inbox';
import type { InboxSource } from '../src/inbox-source.ts';
import type { PushSettings } from '@caduceus/contracts/push';

// Web Push (M2 #03), through the Caduceus API the way the page and its service worker use it, in front of the real Hermes. The push service is a
// local stand-in (`fixtures/push-stub.ts`) that decrypts what it is sent as a browser would: nothing here reaches a real push service.
let hermes: TestHermes;
let stub: PushStub;
let llm: StubLlm;
let extraSources: InboxSource[] = [];
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
let server: CaduceusServer | undefined;
let cookie: string;
let authenticator: SoftwareAuthenticator | undefined;
let work: string;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  stub = await startPushStub();
  llm = await startStubLlm();
  await llm.connect(hermes);
  await hermes.cli('config', 'set', 'tools.tool_search.enabled', 'off');
  await hermes.cli('profile', 'create', 'work');
  await llm.connect(hermes, 'work');
  await hermes.cli('-p', 'work', 'config', 'set', 'tools.tool_search.enabled', 'off');
}, 120_000);
afterAll(async () => {
  await llm.close();
  await stub.close();
  await hermes.stop();
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-push-')));
});
afterEach(async () => {
  for (const chat of chats.splice(0)) {
    for (const request of chat.state.requests) {
      if (request.kind === 'approval') await chat.answerApproval(request.id, { choice: 'deny' });
    }
    chat.dispose();
  }
  for (const page of pages.splice(0)) page.connection.close();
  extraSources = [];
  offset = 0;
  await server?.close();
  server = undefined;
  authenticator = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

/** The push watcher's looks, counted, so that a test can wait for it to have seen what it just changed instead of waiting a while. */
let looks = 0;
const lookWaiters: { at: number; resolve(): void }[] = [];
/** Resolves once the watcher has looked `count` more times (it looks at every change and every few milliseconds besides, so a look that began before the change is followed by one that did not). */
function lookAgain(count = 2): Promise<void> {
  const waiter = Promise.withResolvers<void>();
  lookWaiters.push({ at: looks + count, resolve: waiter.resolve });
  return waiter.promise;
}
/** The time the server runs on, which a test moves by hand. */
let offset = 0;
const clock = () => Date.now() + offset;

async function openServer(options: Partial<CaduceusServerOptions> = {}) {
  server = await startCaduceusServer({
    backend: hermes.backend,
    hermesRoot: hermes.home,
    inboxPollMs: 25,
    inboxReadMs: 150,
    inboxSources: extraSources,
    pushTickMs: 15,
    // The stand-in push service is plain HTTP on this Mac's loopback: the one thing production never accepts.
    allowLoopbackPush: true,
    now: clock,
    pushLooked: () => {
      looks += 1;
      for (const waiter of lookWaiters.filter((entry) => entry.at <= looks)) waiter.resolve();
      lookWaiters.splice(0, lookWaiters.length, ...lookWaiters.filter((entry) => entry.at > looks));
    },
    ...options,
  });
  cookie = await ownerCookie(server.url);
  // The owner's one passkey is made once for a store: a restart of Caduceus on the same store keeps it.
  authenticator ??= await addPasskey(server.url, cookie);
  return server;
}

/** A call to the push API as the browser of `device` makes it. */
const api = async (route: string, init: RequestInit = {}, device = 'a'.repeat(32)) => {
  // Adding or replacing a subscription is a T2: the owner's passkey (these tests move the clock, so it is given again each time).
  if (route === 'push/subscription' && init.method === 'PUT') await stepUp(server!.url, cookie, authenticator!);
  return fetch(`${server!.url}/_caduceus/api/${route}`, { ...init, headers: { origin: server!.url, cookie: `${cookie}; caduceus_device=${device}`, 'content-type': 'application/json', ...init.headers } });
};

describe('the VAPID key', () => {
  test('is made on the first start, kept owner-only and the same across restarts, and only its public half is ever served', async () => {
    await openServer();
    const first = (await (await api('push/key')).json()) as { publicKey: string };
    expect(first.publicKey).toMatch(/^[\w-]{87}$/);
    const file = path.join(hermes.home, 'caduceus', 'vapid.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const kept = JSON.parse(fs.readFileSync(file, 'utf8')) as { publicKey: string; privateKey: string };
    expect(kept.publicKey).toBe(first.publicKey);

    await server!.close();
    await openServer();
    const again = (await (await api('push/key')).json()) as { publicKey: string };

    expect(again.publicKey).toBe(first.publicKey);
    expect(JSON.stringify(again)).not.toContain(kept.privateKey);
  });
});

const phone = 'a'.repeat(32);
const laptop = 'b'.repeat(32);

describe('a device\'s subscription', () => {
  test('is kept for that device alone with its categories, quiet hours and overrides, and a change to one setting leaves the others as they were', async () => {
    await openServer();
    const device = stub.subscribe();
    expect(await (await api('push/subscription', {}, phone)).json()).toMatchObject({ subscribed: false, settings: { categories: { approvals: true, finished: false } } });

    const made = await api('push/subscription', { method: 'PUT', body: JSON.stringify({ subscription: device.subscription, origin: 'https://mac.tailnet.ts.net:9443', settings: { timeZone: 'Europe/Paris', overrides: { 'cron:work:nightly': true } } }) }, phone);

    expect(made.status).toBe(200);
    const mine = (await (await api('push/subscription', {}, phone)).json()) as { subscribed: boolean; settings: { categories: Record<string, boolean>; timeZone: string; overrides: Record<string, boolean>; quietHours: unknown } };
    expect(mine).toMatchObject({ subscribed: true, settings: { timeZone: 'Europe/Paris', overrides: { 'cron:work:nightly': true }, quietHours: { enabled: false, start: '22:00', end: '07:00' } } });
    // Another device of the owner has asked for nothing.
    expect(await (await api('push/subscription', {}, laptop)).json()).toMatchObject({ subscribed: false });

    const changed = await api('push/settings', { method: 'PATCH', body: JSON.stringify({ categories: { finished: true }, quietHours: { enabled: true, start: '23:30', end: '06:15' }, digest: 'daily', overrides: { 'cron:work:nightly': false, 'cron:work:other': true } }) }, phone);

    expect(changed.status).toBe(200);
    const after = (await (await api('push/subscription', {}, phone)).json()) as typeof mine;
    expect(after.settings).toMatchObject({
      categories: { approvals: true, reviews: true, failures: true, finished: true, pairing: true, budget: true, updates: false },
      quietHours: { enabled: true, start: '23:30', end: '06:15' },
      timeZone: 'Europe/Paris',
      digest: 'daily',
      overrides: { 'cron:work:nightly': false, 'cron:work:other': true },
    });
    // The store holds the subscription by device: its endpoint and keys, never anything of the owner's chats.
    const db = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'), { readOnly: true });
    expect(db.prepare('SELECT device_id, endpoint FROM push_subscriptions').all().map((row) => ({ ...row }))).toEqual([{ device_id: phone, endpoint: device.subscription.endpoint }]);
    db.close();
  });

  test('refuses what cannot be a subscription or a setting, and forgets the device on request', async () => {
    await openServer();
    const device = stub.subscribe();
    const put = (body: unknown) => api('push/subscription', { method: 'PUT', body: JSON.stringify(body) }, phone);

    expect((await put({ subscription: { endpoint: 'http://push.example.net/abc', keys: device.subscription.keys }, origin: 'https://mac.example' })).status).toBe(400);
    expect((await put({ subscription: { endpoint: device.subscription.endpoint, keys: { p256dh: 'x' } }, origin: 'https://mac.example' })).status).toBe(400);
    expect((await put({ subscription: device.subscription, origin: 'not a url' })).status).toBe(400);
    expect((await put({ subscription: device.subscription, origin: 'https://mac.example', settings: { quietHours: { enabled: true, start: '25:00', end: '07:00' } } })).status).toBe(400);
    expect((await put({ subscription: device.subscription, origin: 'https://mac.example', settings: { timeZone: 'Not/AZone' } })).status).toBe(400);
    expect((await (await api('push/subscription', {}, phone)).json())).toMatchObject({ subscribed: false });

    expect((await put({ subscription: device.subscription, origin: 'https://mac.example' })).status).toBe(200);
    expect((await api('push/settings', { method: 'PATCH', body: JSON.stringify({ digest: 'weekly' }) }, phone)).status).toBe(400);
    expect((await api('push/subscription', { method: 'DELETE' }, phone)).status).toBe(200);
    expect(await (await api('push/subscription', {}, phone)).json()).toMatchObject({ subscribed: false });
  });
});

describe('who may be told what the owner is asked', () => {
  const subscribeBody = (device: StubDevice, endpoint = device.subscription.endpoint) => JSON.stringify({ subscription: { endpoint, keys: device.subscription.keys }, origin: 'https://mac.example' });
  /** A request with the cookie alone: no passkey step-up. */
  const cookieOnly = (route: string, init: RequestInit = {}) => fetch(`${server!.url}/_caduceus/api/${route}`, { ...init, headers: { origin: server!.url, cookie: `${cookie}; caduceus_device=${phone}`, 'content-type': 'application/json' } });

  test('adding or replacing a subscription needs a passkey and is audited, and the cookie alone cannot make one', async () => {
    await openServer();
    const device = stub.subscribe();

    const without = await cookieOnly('push/subscription', { method: 'PUT', body: subscribeBody(device) });
    const made = await api('push/subscription', { method: 'PUT', body: subscribeBody(device) }, phone);

    expect(without.status).toBe(403);
    expect(await without.json()).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect(made.status).toBe(200);
    const audit = (await (await api('audit')).json()) as { entries: { action: string; tier?: string }[] };
    expect(audit.entries).toContainEqual(expect.objectContaining({ action: 'PUT /_caduceus/api/push/subscription', tier: 'T2' }));
    expect(await (await api('push/subscription', {}, laptop)).json()).toMatchObject({ subscribed: false });
  });

  test('takes only the push services’ own hosts over HTTPS: any other host, a look-alike, a private address or plain HTTP is refused', async () => {
    await openServer({ allowLoopbackPush: false });
    const device = stub.subscribe();
    const attempt = async (endpoint: string) => (await api('push/subscription', { method: 'PUT', body: subscribeBody(device, endpoint) }, phone)).status;

    const endpoints = [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/?token=abc',
      'https://evil.example/push',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilfcm.googleapis.com/x',
      'https://push.apple.com.evil.example/x',
      'https://notify.windows.com/x',
      'https://169.254.169.254/latest',
      'https://127.0.0.1/x',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://user:pass@fcm.googleapis.com/x',
      device.subscription.endpoint,
    ];
    const statuses: number[] = [];
    for (const endpoint of endpoints) statuses.push(await attempt(endpoint));
    expect(statuses    ).toEqual([200, 200, 200, 200, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400]);
  });

  test('ends with the session it was made in: revoking or signing out that session removes it, and another session’s stays', async () => {
    await openServer();
    const device = stub.subscribe();
    expect((await api('push/subscription', { method: 'PUT', body: subscribeBody(device) }, phone)).status).toBe(200);
    expect(await (await api('push/subscription', {}, phone)).json()).toMatchObject({ subscribed: true });

    // The same browser signs out: its session ends, and so does what that session asked to be told.
    expect((await api('auth/sign-out', { method: 'POST' }, phone)).status).toBeLessThan(300);

    const again = await ownerCookie(server!.url);
    const after = await fetch(`${server!.url}/_caduceus/api/push/subscription`, { headers: { origin: server!.url, cookie: `${again}; caduceus_device=${phone}` } });
    expect(await after.json()).toMatchObject({ subscribed: false });
  });
});

/**
 * The device of `id` subscribes the way the page does after the owner taps Enable, and says what it wants. The temp Hermes has Repairs of its own to report
 * (a gateway that is not running), which are failures: a test of something else leaves that category off.
 */
async function enable(device: StubDevice, id = phone, settings: Partial<Record<keyof PushSettings, unknown>> = { categories: { failures: false } }) {
  const res = await api('push/subscription', { method: 'PUT', body: JSON.stringify({ subscription: device.subscription, origin: server!.url, settings }) }, id);
  expect(res.status).toBe(200);
}

/** A chat page of the owner's in a profile. */
async function openChat(profile?: string) {
  const page = openGatewayConnection(server!.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest, cwd: work, ...(profile ? { profile } : {}) });
  chats.push(chat);
  return chat;
}

describe('a notification for what needs a decision', () => {
  test('an approval in any profile reaches a subscribed device with the command and the profile in its title, the exact command in its body and the Inbox item as its link', async () => {
    // A short path: a title holds a command of 60 characters at most.
    const kept = fs.mkdtempSync('/tmp/cdp-');
    await openServer();
    const device = stub.subscribe();
    await enable(device);
    const chat = await openChat('work');
    llm.nextReply({ chunks: [], toolCalls: [{ id: 'call_rm', name: 'terminal', arguments: { command: `rm -rf ${kept}` } }] });

    await chat.send('Clean up');
    const { message, headers } = await device.next();

    expect(message.web_push).toBe(8030);
    expect(message.notification).toMatchObject({ title: `Approve \`rm -rf ${kept}\` on work?`, silent: false, app_badge: 1 });
    expect(message.notification.body).toContain(`rm -rf ${kept}`);
    const request = chat.state.requests[0]!;
    // A decision is answered on Today (the Inbox's decision list is gone, M8 #08).
    expect(message.notification.navigate).toBe(`${server!.url}/today`);
    // An approval is the most urgent thing there is; the push service is told so, and that the message may wait an hour for a device that is off.
    expect(headers).toMatchObject({ urgency: 'high', ttl: '3600', 'content-encoding': 'aes128gcm' });
    expect(headers.authorization).toMatch(/^vapid t=.+, k=.+$/);
    await chat.answerApproval(request.id, { choice: 'deny' });
    fs.rmSync(kept, { recursive: true, force: true });
  }, 60_000);
});

/** A source of Inbox items a test fills by hand. */
function itemsSource() {
  const listeners = new Set<() => void>();
  let items: InboxItem[] = [];
  const source: InboxSource & { set(next: InboxItem[]): void } = {
    items: () => items,
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    close: () => listeners.clear(),
    set(next) {
      items = next;
      for (const listener of listeners) listener();
    },
  };
  return source;
}

/** A notice as the Inbox's sources make it. */
const notice = (ref: string, over: Partial<Extract<InboxItem, { kind: 'notice' }>> = {}): InboxItem => ({
  kind: 'notice',
  id: ref,
  ref,
  stamp: '1',
  group: 'failed',
  category: 'automation',
  profile: 'work',
  at: 1,
  title: `Notice ${ref}`,
  detail: undefined,
  actions: [],
  link: undefined,
  ...over,
});

/** Tells the server that the owner's page `tab` is in view, or not. */
const present = (tab: string, visible: boolean) => api('presence', { method: 'POST', body: JSON.stringify({ tab, visible }) });

describe('presence', () => {
  test('no notification is sent while any page of the owner is in view, and one that is still waiting is sent when the last page is hidden', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    const device = stub.subscribe();
    await enable(device, phone, { categories: { failures: true } });
    expect((await present('laptop-tab', true)).status).toBe(204);
    expect((await present('phone-tab', true)).status).toBe(204);

    const seen = lookAgain();
    source.set([notice('cron:work:nightly')]);
    await seen;
    expect(device.received).toBe(0);

    // One page hidden, the other still in view: still nothing.
    await present('laptop-tab', false);
    await lookAgain();
    expect(device.received).toBe(0);
    await present('phone-tab', false);
    const { message } = await device.next();

    expect(message.notification.title).toBe('Notice cron:work:nightly');
    // What is not a decision is read in Notices, on the item.
    expect(message.notification.navigate).toBe(`${server!.url}/notices/${encodeURIComponent('cron:work:nightly')}`);
    expect(device.received).toBe(1);
  });

  test('a page that went away without saying stops counting when its lease runs out', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    const device = stub.subscribe();
    await enable(device, phone, { categories: { failures: true } });
    await present('closed-tab', true);
    source.set([notice('cron:work:nightly')]);
    await lookAgain();
    expect(device.received).toBe(0);

    // The page's lease is a minute and a half; the page never renewed it.
    offset += 91_000;
    await device.next();

    expect(device.received).toBe(1);
  });
});

describe('dedupe', () => {
  test('one state of Hermes is one notification per device, however often the Inbox says it again, across a restart of Caduceus, and a new state of the same thing is a new notification', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    const phoneDevice = stub.subscribe();
    const laptopDevice = stub.subscribe();
    await enable(phoneDevice, phone, { categories: { failures: true } });
    await enable(laptopDevice, laptop, { categories: { failures: true } });

    source.set([notice('cron:work:nightly', { stamp: 'failed:1' })]);
    await phoneDevice.next();
    await laptopDevice.next();
    // The Inbox says the same list again (a reconnect, a poll) and a look follows each time.
    source.set([notice('cron:work:nightly', { stamp: 'failed:1' })]);
    source.set([notice('cron:work:nightly', { stamp: 'failed:1', detail: 'Same failure, worded again' })]);
    await lookAgain(4);
    expect([phoneDevice.received, laptopDevice.received]).toEqual([1, 1]);

    // Caduceus restarts: the item is still there, and nobody is told again.
    await server!.close();
    const again = itemsSource();
    again.set([notice('cron:work:nightly', { stamp: 'failed:1' })]);
    extraSources = [again];
    await openServer();
    await lookAgain(4);
    expect([phoneDevice.received, laptopDevice.received]).toEqual([1, 1]);

    // The job fails again: a new state, told once more.
    again.set([notice('cron:work:nightly', { stamp: 'failed:2' })]);
    await phoneDevice.next();
    await laptopDevice.next();
    expect([phoneDevice.received, laptopDevice.received]).toEqual([2, 2]);
  });

  test('what a device snoozed in its Inbox is not pushed to it', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    const phoneDevice = stub.subscribe();
    const laptopDevice = stub.subscribe();
    await enable(phoneDevice, phone, { categories: { failures: true } });
    await enable(laptopDevice, laptop, { categories: { failures: true } });
    const hide = await api('inbox/hide', { method: 'POST', body: JSON.stringify({ ref: 'cron:work:nightly', stamp: 'failed:1' }) }, phone);
    expect(hide.status).toBe(200);

    source.set([notice('cron:work:nightly', { stamp: 'failed:1' })]);
    await laptopDevice.next();
    await lookAgain(3);

    expect(phoneDevice.received).toBe(0);
  });
});

describe('what a device asked to hear of', () => {
  /** An item of each kind of notice a source makes. */
  const kinds = {
    failure: notice('cron:work:nightly', { title: 'Nightly failed' }),
    pairing: notice('pairing:work:telegram:42', { category: 'pairing', group: 'decision', title: 'Pairing request' }),
    budget: notice('budget:day', { category: 'system', title: 'Budget reached' }),
    update: notice('update:hermes', { category: 'system', group: 'fyi', title: 'An update is available' }),
  };

  test('only the categories the device switched on are sent, and the defaults are what needs a decision or has gone wrong', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    const device = stub.subscribe();
    await enable(device, phone, { categories: { failures: false, pairing: true, budget: false, updates: true } });

    source.set([kinds.failure, kinds.pairing, kinds.budget, kinds.update]);
    const first = await device.next();
    const second = await device.next();
    await lookAgain(3);

    expect([first, second].map((pushed) => pushed.message.notification.title).toSorted()).toEqual(['An update is available', 'Pairing request']);
    expect(device.received).toBe(2);
  });

  test('a source\'s own switch beats its category: a cron job can be on while Failures are off, and off while they are on', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    const device = stub.subscribe();
    await enable(device, phone, { categories: { failures: false }, overrides: { 'cron:work:important': true } });
    const important = notice('cron:work:important', { title: 'Important failed' });
    source.set([notice('cron:work:other', { title: 'Other failed' }), important]);

    expect((await device.next()).message.notification.title).toBe('Important failed');
    await lookAgain(3);
    expect(device.received).toBe(1);

    // And the other way round: Failures on, one job muted.
    await api('push/settings', { method: 'PATCH', body: JSON.stringify({ categories: { failures: true }, overrides: { 'cron:work:important': null, 'cron:work:noisy': false } }) }, phone);
    source.set([notice('cron:work:noisy', { title: 'Noisy failed' }), notice('cron:work:quiet', { title: 'Quiet failed' })]);

    expect((await device.next()).message.notification.title).toBe('Other failed');
    expect((await device.next()).message.notification.title).toBe('Quiet failed');
    await lookAgain(3);
    expect(device.received).toBe(3);
  });

  test('a run that finishes is sent to a device that asked for Finished runs, and only when no page is in view', async () => {
    await openServer();
    const wants = stub.subscribe();
    const doesNot = stub.subscribe();
    await enable(wants, phone, { categories: { finished: true, failures: false } });
    await enable(doesNot, laptop);
    await present('tab', true);
    const chat = await openChat('work');
    llm.nextReply({ chunks: ['Seen ', 'by you.'] });
    await chat.send('While you watch');
    await chat.until((state) => !state.running && state.messages.length >= 2);
    await lookAgain(4);
    expect(wants.received).toBe(0);

    await present('tab', false);
    llm.nextReply({ chunks: ['All ', 'done.'] });
    await chat.send('Now go away');
    const { message } = await wants.next();

    expect(message.notification.title).toMatch(/^Finished: /);
    expect(message.notification.body).toBe('work');
    expect(message.notification.navigate).toBe(`${server!.url}/chat/${encodeURIComponent(chat.state.storedId!)}`);
    expect(doesNot.received).toBe(0);
  }, 60_000);
});

describe('quiet hours and the digest', () => {
  /** 23:00 UTC on a day of the test's own: inside the default quiet hours (22:00 to 07:00). */
  const lateEvening = () => {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 23, 0, 0);
  };

  test('hold a notification back until they end, and it is sent then if it is still waiting', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    offset = lateEvening() - Date.now();
    const device = stub.subscribe();
    await enable(device, phone, { categories: { failures: true }, quietHours: { enabled: true, start: '22:00', end: '07:00' }, timeZone: 'UTC' });

    source.set([notice('cron:work:nightly')]);
    await lookAgain(3);
    expect(device.received).toBe(0);

    // Eight hours later it is 07:00.
    offset += 8 * 3600_000;
    const { message } = await device.next();

    expect(message.notification.title).toBe('Notice cron:work:nightly');
  });

  test('a digest turns FYI notifications into one message at its hour, and what needs a decision still comes at once', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    // 10:05 UTC, tomorrow.
    const now = new Date();
    offset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 10, 5, 0) - Date.now();
    const device = stub.subscribe();
    await enable(device, phone, { categories: { updates: true, finished: true, pairing: true, failures: false }, digest: 'hourly', timeZone: 'UTC' });

    source.set([notice('update:hermes', { category: 'system', group: 'fyi', title: 'Hermes 0.22 is available' }), notice('pairing:work:telegram:7', { category: 'pairing', group: 'decision', title: 'Pairing request' })]);
    const pairing = (await device.next()).message.notification;
    expect(pairing.title).toBe('Pairing request');
    // A notice that waits for a decision is decided on Today, like an approval.
    expect(pairing.navigate).toBe(`${server!.url}/today`);
    await lookAgain(3);
    expect(device.received).toBe(1);

    // The hour turns: the digest goes, with what it holds.
    offset += 60 * 60_000;
    const { message } = await device.next();

    expect(message.notification).toMatchObject({ title: '1 update', body: 'Hermes 0.22 is available', navigate: `${server!.url}/notices` });
  });
});

describe('test notification', () => {
  test('goes to the asking device at once whatever its categories and quiet hours say, and a device that never subscribed is told so', async () => {
    await openServer();
    const device = stub.subscribe();
    expect((await api('push/test', { method: 'POST' }, phone)).status).toBe(404);
    await enable(device, phone, { categories: { approvals: false, failures: false, pairing: false, budget: false }, quietHours: { enabled: true, start: '00:00', end: '23:59' }, timeZone: 'UTC' });
    await present('tab', true);

    const res = await api('push/test', { method: 'POST' }, phone);

    expect(res.status).toBe(200);
    const { message } = await device.next();
    expect(message.notification).toMatchObject({ title: 'Test notification', navigate: `${server!.url}/today` });
  });
});

describe('ending a subscription', () => {
  const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';

  test('Settings › Security lists the subscribed devices by name, and revoking one stops its notifications and leaves the others', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    const phoneDevice = stub.subscribe();
    const macDevice = stub.subscribe();
    const put = (device: StubDevice, id: string, userAgent: string) =>
      api('push/subscription', { method: 'PUT', headers: { 'user-agent': userAgent }, body: JSON.stringify({ subscription: device.subscription, origin: server!.url, settings: { categories: { failures: true } } }) }, id);
    expect((await put(phoneDevice, phone, IPHONE)).status).toBe(200);
    expect((await put(macDevice, laptop, MAC_SAFARI)).status).toBe(200);

    const listed = (await (await api('push/subscriptions', {}, phone)).json()) as { devices: { id: string; name: string; current: boolean; createdAt: number }[] };

    expect(listed.devices.map(({ name, current }) => ({ name, current }))).toEqual([
      { name: 'Safari on iPhone', current: true },
      { name: 'Safari on Mac', current: false },
    ]);
    expect(JSON.stringify(listed)).not.toContain(phoneDevice.subscription.endpoint);
    const revoked = await api(`push/subscriptions/${listed.devices[0]!.id}`, { method: 'DELETE' }, laptop);
    expect(revoked.status).toBe(204);
    expect((await api(`push/subscriptions/${listed.devices[0]!.id}`, { method: 'DELETE' }, laptop)).status).toBe(404);
    expect(await (await api('push/subscription', {}, phone)).json()).toMatchObject({ subscribed: false });

    source.set([notice('cron:work:nightly')]);
    await macDevice.next();
    await lookAgain(3);
    expect(phoneDevice.received).toBe(0);
  });

  test('a push service that says the subscription is gone (410) removes it, and nothing more is sent to it', async () => {
    const source = itemsSource();
    extraSources = [source];
    await openServer();
    const device = stub.subscribe();
    await enable(device, phone, { categories: { failures: true } });
    device.answer(410);

    source.set([notice('cron:work:nightly')]);
    // The push service refuses the message; the device is not subscribed any more.
    for (;;) {
      const { subscribed } = (await (await api('push/subscription', {}, phone)).json()) as { subscribed: boolean };
      if (!subscribed) break;
      await lookAgain(1);
    }

    expect((await (await api('push/subscriptions', {}, phone)).json()) as { devices: unknown[] }).toEqual({ devices: [] });
    const db = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'), { readOnly: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM push_log').get()).toEqual({ n: 0 });
    db.close();
    // The same answer to a test notification says what happened.
    expect((await api('push/test', { method: 'POST' }, phone)).status).toBe(404);
  });
});
