// Web Push (M2 #03): what a device asks to be told. This file is the API and the store of subscriptions; `push-watcher.ts` decides what is sent and when.
import crypto from 'node:crypto';
import type { Hono } from 'hono';
import { DEFAULT_PUSH_SETTINGS, type PushDevice, type PushDeviceState, type PushSettings, type PushSubscriptionJson } from '@caduceus/contracts/push';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import { gateRequest } from './policy-gate.ts';
import type { RestPolicy } from './policy.ts';
import { deviceOf } from './device-preferences.ts';
import { applySettings, storedSettings } from './push-settings.ts';
import { loadVapidKeys } from './vapid.ts';
import { endpointAllowed, type PushOutcome, type VapidKeys } from './web-push.ts';

/** One device's subscription as the watcher needs it. */
export interface Subscription {
  id: string;
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Where this device's pages are served from; a notification's tap goes to a path under it. */
  origin: string;
  settings: PushSettings;
}

export interface PushSubscriptions {
  readonly keys: VapidKeys;
  all(): Subscription[];
  get(deviceId: string): Subscription | undefined;
  /** Forgets a device (revoked, unsubscribed, or its push service said it is gone). */
  remove(id: string): void;
  /** Forgets what a session subscribed: it has ended (signed out, revoked, expired). */
  removeForSession(sessionId: string): void;
  /** Notes that a notification went to a device. */
  sent(deviceId: string, at: number): void;
  subscribe(listener: () => void): () => void;
}

const BASE64URL = /^[\w-]+$/;

/** "Safari on iPhone": the browser and the system a user agent names, as far as it says. */
export function deviceName(userAgent: string): string {
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\/|CriOS\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'A browser';
  const system = /iPhone/.test(userAgent) ? 'iPhone' : /iPad/.test(userAgent) ? 'iPad' : /Android/.test(userAgent) ? 'Android' : /Macintosh/.test(userAgent) ? 'Mac' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : undefined;
  return system ? `${browser} on ${system}` : browser;
}

export function mountPush(app: Hono<AuthEnv>, { store, now, test, policy, allowLoopback }: { store: CaduceusStore; now: () => number; test(deviceId: string): Promise<PushOutcome | 'not-subscribed'>; policy: RestPolicy; allowLoopback: boolean }): PushSubscriptions {
  const { db } = store;
  const keys = loadVapidKeys(store.dir);
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());

  interface Row {
    id: string;
    device_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    origin: string;
    user_agent: string;
    settings: string;
    created_at: number;
    last_sent_at: number | null;
  }
  const rowOf = (deviceId: string) => db.prepare('SELECT * FROM push_subscriptions WHERE device_id = ?').get(deviceId) as Row | undefined;
  const subscriptionOf = (row: Row): Subscription => ({ id: row.id, deviceId: row.device_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth, origin: row.origin, settings: storedSettings(row.settings) });

  const subscriptions: PushSubscriptions = {
    keys,
    all: () => (db.prepare('SELECT * FROM push_subscriptions ORDER BY created_at').all() as unknown as Row[]).map(subscriptionOf),
    get: (deviceId) => {
      const row = rowOf(deviceId);
      return row && subscriptionOf(row);
    },
    remove(id) {
      const row = db.prepare('SELECT device_id FROM push_subscriptions WHERE id = ?').get(id) as { device_id: string } | undefined;
      if (!row) return;
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
      db.prepare('DELETE FROM push_log WHERE device_id = ?').run(row.device_id);
      db.prepare('DELETE FROM push_digest WHERE device_id = ?').run(row.device_id);
      changed();
    },
    removeForSession(sessionId) {
      const rows = db.prepare('SELECT id FROM push_subscriptions WHERE session_id = ?').all(sessionId) as { id: string }[];
      for (const row of rows) subscriptions.remove(row.id);
    },
    sent: (deviceId, at) => void db.prepare('UPDATE push_subscriptions SET last_sent_at = ? WHERE device_id = ?').run(at, deviceId),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  app.get('/_caduceus/api/push/key', (c) => c.json({ publicKey: keys.publicKey }));

  app.get('/_caduceus/api/push/subscription', (c) => {
    const row = rowOf(deviceOf(c));
    return c.json({ subscribed: row !== undefined, settings: row ? storedSettings(row.settings) : DEFAULT_PUSH_SETTINGS } satisfies PushDeviceState);
  });

  app.put('/_caduceus/api/push/subscription', async (c) => {
    // The policy first: a passkey (T2) and an audit entry, before anything of the body is read.
    const gated = await gateRequest(policy, c, 'PUT', MAX_SUBSCRIPTION_BODY);
    if ('refusal' in gated) return gated.refusal;
    const body = gated.body;
    const subscription = isRecord(body) ? readSubscription(body.subscription, allowLoopback) : undefined;
    const origin = isRecord(body) && typeof body.origin === 'string' ? originOf(body.origin) : undefined;
    const device = deviceOf(c);
    const settings = applySettings(rowOf(device) ? storedSettings(rowOf(device)!.settings) : DEFAULT_PUSH_SETTINGS, isRecord(body) ? (body.settings ?? {}) : undefined);
    if (!subscription || !origin || !settings) return c.json({ error: 'bad-request' }, 400);
    // A device has one subscription: a new one replaces it, and an endpoint is one device's.
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND device_id != ?').run(subscription.endpoint, device);
    db.prepare(
      `INSERT INTO push_subscriptions (id, device_id, endpoint, p256dh, auth, origin, user_agent, settings, created_at, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (device_id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, origin = excluded.origin, user_agent = excluded.user_agent, settings = excluded.settings, session_id = excluded.session_id`,
    ).run(crypto.randomUUID(), device, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, origin, (c.req.header('user-agent') ?? '').slice(0, 300), JSON.stringify(settings), now(), c.get('session')?.id ?? null);
    changed();
    return c.json({ subscribed: true, settings } satisfies PushDeviceState);
  });

  app.patch('/_caduceus/api/push/settings', async (c) => {
    const row = rowOf(deviceOf(c));
    if (!row) return c.json({ error: 'not-subscribed' }, 404);
    const settings = applySettings(storedSettings(row.settings), await c.req.json().catch(() => undefined));
    if (!settings) return c.json({ error: 'bad-request' }, 400);
    db.prepare('UPDATE push_subscriptions SET settings = ? WHERE id = ?').run(JSON.stringify(settings), row.id);
    changed();
    return c.json({ subscribed: true, settings } satisfies PushDeviceState);
  });

  app.delete('/_caduceus/api/push/subscription', (c) => {
    const row = rowOf(deviceOf(c));
    if (row) subscriptions.remove(row.id);
    return c.json({ subscribed: false, settings: DEFAULT_PUSH_SETTINGS } satisfies PushDeviceState);
  });

  app.post('/_caduceus/api/push/test', async (c) => {
    const outcome = await test(deviceOf(c));
    if (outcome === 'not-subscribed') return c.json({ error: 'not-subscribed' }, 404);
    // `gone`: the push service says this device's subscription is over, and it has been removed.
    return outcome === 'sent' ? c.json({ status: 'sent' }) : c.json({ status: outcome }, 502);
  });

  app.get('/_caduceus/api/push/subscriptions', (c) => {
    const device = deviceOf(c);
    const rows = db.prepare('SELECT * FROM push_subscriptions ORDER BY created_at').all() as unknown as Row[];
    return c.json({ devices: rows.map((row): PushDevice => ({ id: row.id, name: deviceName(row.user_agent), createdAt: row.created_at, lastSentAt: row.last_sent_at ?? undefined, current: row.device_id === device })) });
  });

  app.delete('/_caduceus/api/push/subscriptions/:id', (c) => {
    const id = c.req.param('id');
    if (!db.prepare('SELECT 1 FROM push_subscriptions WHERE id = ?').get(id)) return c.json({ error: 'not-found' }, 404);
    subscriptions.remove(id);
    return c.body(null, 204);
  });

  return subscriptions;
}

/** A subscription is an endpoint, two keys and some settings. */
const MAX_SUBSCRIPTION_BODY = 16 * 1024;

function readSubscription(value: unknown, allowLoopback: boolean): PushSubscriptionJson | undefined {
  if (!isRecord(value) || typeof value.endpoint !== 'string' || !endpointAllowed(value.endpoint, allowLoopback) || value.endpoint.length > 2000 || !isRecord(value.keys)) return undefined;
  const { p256dh, auth } = value.keys;
  // The user agent's key is an uncompressed P-256 point (65 octets) and its secret 16.
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !BASE64URL.test(p256dh) || !BASE64URL.test(auth) || Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(auth, 'base64url').length !== 16) return undefined;
  return { endpoint: value.endpoint, keys: { p256dh, auth } };
}

function originOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localhost') ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
