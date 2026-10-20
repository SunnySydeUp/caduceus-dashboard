// Presence (M2 #03; architecture §4): whether any Caduceus page of the owner is in view. A page says so when it becomes visible or hidden and renews that now
// and then while it is visible; a page that went away without saying (a closed tab, a dropped network) stops counting when its lease runs out. No push
// is sent while anyone is looking: the owner would see the decision on the screen already.
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';

/** How long a visible page counts without saying so again. The page renews it well inside this. */
export const PRESENCE_LEASE_MS = 90_000;

export interface Presence {
  report(tab: string, visible: boolean): void;
  /** Whether any page is in view now. */
  visible(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createPresence(now: () => number): Presence {
  const until = new Map<string, number>();
  const listeners = new Set<() => void>();
  const anyVisible = () => [...until.values()].some((end) => end > now());
  return {
    report(tab, visible) {
      const before = anyVisible();
      if (visible) until.set(tab, now() + PRESENCE_LEASE_MS);
      else until.delete(tab);
      for (const [name, end] of until) if (end <= now()) until.delete(name);
      if (before !== anyVisible()) for (const listener of [...listeners]) listener();
    },
    visible: anyVisible,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function mountPresence(app: Hono<AuthEnv>, presence: Presence): void {
  app.post('/_caduceus/api/presence', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (!isRecord(body) || typeof body.tab !== 'string' || body.tab === '' || body.tab.length > 64 || typeof body.visible !== 'boolean') return c.json({ error: 'bad-request' }, 400);
    presence.report(body.tab, body.visible);
    return c.body(null, 204);
  });
}
