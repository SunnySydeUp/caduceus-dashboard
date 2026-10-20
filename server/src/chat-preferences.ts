// The owner's choice of which chips the chat composer shows and in what order (M1 #08), kept in the Caduceus store's `settings` table
// under one key. It is the owner's, not a device's, so every device they sign in on shows the same chips, and Hermes knows nothing of it.
import type { Hono } from 'hono';
import { parseChipPreference } from '@caduceus/contracts/chat-chips';
import type { ChatChipsPreference } from '@caduceus/contracts/caduceus-api';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';

const KEY = 'chat.chips';

export function mountChatPreferences(app: Hono<AuthEnv>, store: CaduceusStore): void {
  const { db } = store;
  const read = (): ChatChipsPreference => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
    return { chips: row ? (parseChipPreference(JSON.parse(row.value)) ?? null) : null };
  };

  app.get('/_caduceus/api/preferences/chat-chips', (c) => c.json(read()));

  app.put('/_caduceus/api/preferences/chat-chips', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const chips = typeof body === 'object' && body !== null && 'chips' in body ? body.chips : undefined;
    if (chips === null) db.prepare('DELETE FROM settings WHERE key = ?').run(KEY);
    else {
      const parsed = parseChipPreference(chips);
      if (!parsed) return c.json({ error: 'bad-request' }, 400);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(parsed));
    }
    return c.json(read());
  });
}
