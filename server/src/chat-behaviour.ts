// How the chat behaves (M1 #20; `contracts/chat-behaviour.ts`): the device's settings sit in `device_preferences` under the device cookie, the owner's in the
// `settings` table, both in the Caduceus store. Hermes's config is never written for any of them.
import type { Hono } from 'hono';
import { accountBehaviourOf, deviceBehaviourOf, parseAccountChange, parseDeviceChange, type ChatBehaviour } from '@caduceus/contracts/chat-behaviour';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import { deviceOf } from './device-preferences.ts';

const SECTION = 'chat-behaviour';
const ACCOUNT_KEY = 'chat.behaviour';

export function mountChatBehaviour(app: Hono<AuthEnv>, store: CaduceusStore): void {
  const { db } = store;
  const read = (device: string): ChatBehaviour => {
    const deviceRow = db.prepare('SELECT value FROM device_preferences WHERE device_id = ? AND section = ?').get(device, SECTION) as { value: string } | undefined;
    const accountRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(ACCOUNT_KEY) as { value: string } | undefined;
    return { device: deviceBehaviourOf(deviceRow ? JSON.parse(deviceRow.value) : undefined), account: accountBehaviourOf(accountRow ? JSON.parse(accountRow.value) : undefined) };
  };

  app.get('/_caduceus/api/preferences/chat-behaviour', (c) => c.json(read(deviceOf(c))));

  app.put('/_caduceus/api/preferences/chat-behaviour', async (c) => {
    const device = deviceOf(c);
    const body: unknown = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return c.json({ error: 'bad-request' }, 400);
    const asked = body as { device?: unknown; account?: unknown };
    // Everything is checked before anything is stored: a change with one bad setting changes nothing.
    const deviceChange = asked.device === undefined || asked.device === null ? undefined : parseDeviceChange(asked.device);
    const accountChange = asked.account === undefined || asked.account === null ? undefined : parseAccountChange(asked.account);
    if ((asked.device !== undefined && asked.device !== null && !deviceChange) || (asked.account !== undefined && asked.account !== null && !accountChange)) return c.json({ error: 'bad-request' }, 400);
    const before = read(device);
    if (asked.device === null) db.prepare('DELETE FROM device_preferences WHERE device_id = ? AND section = ?').run(device, SECTION);
    else if (deviceChange) {
      db.prepare("INSERT INTO device_preferences (device_id, section, value) VALUES (?, ?, ?) ON CONFLICT (device_id, section) DO UPDATE SET value = excluded.value").run(device, SECTION, JSON.stringify({ ...before.device, ...deviceChange }));
    }
    if (asked.account === null) db.prepare('DELETE FROM settings WHERE key = ?').run(ACCOUNT_KEY);
    else if (accountChange) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(ACCOUNT_KEY, JSON.stringify({ ...before.account, ...accountChange }));
    }
    return c.json(read(device));
  });
}
