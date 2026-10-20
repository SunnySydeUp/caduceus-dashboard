// Per-device preferences, kept in the Caduceus store. A "device" is a browser profile: the `caduceus_device` cookie, a
// random id the server hands out the first time that browser asks for its preferences. It is deliberately not the
// session: signing out and in again (or revoking the session) must not reset a device's choices, and two browsers
// signed in as the owner must not share them. Clearing a browser's cookies makes it a new device (the web app then
// offers its local copy of the choices to the new record, see web/src/appearance.ts).
import crypto from 'node:crypto';
import type { Context, Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { parseAppearance } from '@caduceus/contracts/appearance';
import type { DeviceAppearance } from '@caduceus/contracts/caduceus-api';
import { isDirectLocal, type AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';

export const DEVICE_COOKIE = 'caduceus_device';

/** The longest a browser keeps a cookie (Chrome's cap); every request from the device renews it. */
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/** What a device id the server made looks like; anything else in the cookie is not trusted as an id. */
const DEVICE_ID = /^[0-9a-f]{32}$/;

/** The id of the device making this request, issuing (and renewing) its cookie. Same attributes as the session cookie. */
export function deviceOf(c: Context): string {
  const sent = getCookie(c, DEVICE_COOKIE);
  const id = sent !== undefined && DEVICE_ID.test(sent) ? sent : crypto.randomBytes(16).toString('hex');
  setCookie(c, DEVICE_COOKIE, id, { httpOnly: true, sameSite: 'Strict', path: '/', secure: !isDirectLocal(c), maxAge: DEVICE_COOKIE_MAX_AGE_S });
  return id;
}

export function mountDevicePreferences(app: Hono<AuthEnv>, store: CaduceusStore): void {
  const { db } = store;

  app.get('/_caduceus/api/preferences/appearance', (c) => {
    const row = db.prepare("SELECT value FROM device_preferences WHERE device_id = ? AND section = 'appearance'").get(deviceOf(c)) as { value: string } | undefined;
    return c.json({ appearance: row ? (parseAppearance(JSON.parse(row.value)) ?? null) : null } satisfies DeviceAppearance);
  });

  app.put('/_caduceus/api/preferences/appearance', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const appearance = parseAppearance(typeof body === 'object' && body !== null && 'appearance' in body ? body.appearance : undefined);
    if (!appearance) return c.json({ error: 'bad-request' }, 400);
    db.prepare(
      "INSERT INTO device_preferences (device_id, section, value) VALUES (?, 'appearance', ?) ON CONFLICT (device_id, section) DO UPDATE SET value = excluded.value",
    ).run(deviceOf(c), JSON.stringify(appearance));
    return c.json({ appearance } satisfies DeviceAppearance);
  });
}
