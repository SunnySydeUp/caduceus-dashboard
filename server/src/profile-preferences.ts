// Per-profile preferences that belong to Caduceus, kept in its store: today the assistant display name (M4 #01), which appears
// in chat headers. It is the owner's, not the device's, and it is never a copy of anything in Hermes: Hermes does not know it,
// and nothing here writes a Hermes file. Rows are keyed by the profile's name; the web app moves or removes a row when it
// renames or deletes the profile.
import type { Hono } from 'hono';
import type { ProfilePreferences } from '@caduceus/contracts/caduceus-api';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';

/** The longest assistant name: a header's worth. */
const MAX_ASSISTANT_NAME = 60;

export function mountProfilePreferences(app: Hono<AuthEnv>, store: CaduceusStore): void {
  const { db } = store;
  const read = (profile: string): ProfilePreferences => {
    const row = db.prepare('SELECT assistant_name FROM profile_preferences WHERE profile = ?').get(profile) as { assistant_name: string } | undefined;
    return { assistantName: row?.assistant_name ?? null };
  };

  app.get('/_caduceus/api/preferences/profiles/:profile', (c) => c.json(read(c.req.param('profile'))));

  app.put('/_caduceus/api/preferences/profiles/:profile', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const name = typeof body === 'object' && body !== null && 'assistantName' in body ? body.assistantName : undefined;
    if (typeof name !== 'string' || name.trim().length > MAX_ASSISTANT_NAME) return c.json({ error: 'bad-request' }, 400);
    const profile = c.req.param('profile');
    if (name.trim() === '') db.prepare('DELETE FROM profile_preferences WHERE profile = ?').run(profile);
    else {
      db.prepare('INSERT INTO profile_preferences (profile, assistant_name) VALUES (?, ?) ON CONFLICT (profile) DO UPDATE SET assistant_name = excluded.assistant_name').run(profile, name.trim());
    }
    return c.json(read(profile));
  });

  app.delete('/_caduceus/api/preferences/profiles/:profile', (c) => {
    db.prepare('DELETE FROM profile_preferences WHERE profile = ?').run(c.req.param('profile'));
    return c.body(null, 204);
  });
}
