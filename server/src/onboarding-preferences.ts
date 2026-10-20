// The owner's onboarding progress (M5 #16), kept in the Caduceus store's `settings` table under one key. It is the owner's, not a device's, so the wizard
// resumes at the same step on whichever device the owner opens it, and Hermes knows nothing of it (finishing is written to Hermes separately).
import type { Hono } from 'hono';
import { NEW_ONBOARDING, parseOnboardingProgress, readOnboardingProgress } from '@caduceus/contracts/onboarding';
import type { OnboardingPreference } from '@caduceus/contracts/caduceus-api';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';

const KEY = 'onboarding.progress';

export function mountOnboardingPreferences(app: Hono<AuthEnv>, store: CaduceusStore): void {
  const { db } = store;
  const read = (): OnboardingPreference => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
    return { onboarding: row ? readOnboardingProgress(JSON.parse(row.value)) : NEW_ONBOARDING };
  };

  app.get('/_caduceus/api/preferences/onboarding', (c) => c.json(read()));

  app.put('/_caduceus/api/preferences/onboarding', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const progress = parseOnboardingProgress(typeof body === 'object' && body !== null && 'onboarding' in body ? body.onboarding : undefined);
    if (!progress) return c.json({ error: 'bad-request' }, 400);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(progress));
    return c.json(read());
  });
}
