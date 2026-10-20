// The notification switch of a scheduled job (M3 #09): whether its failures are an Inbox item and a push. It is the owner's preference in Caduceus, kept
// against the job's profile and id (the table holds the jobs that are silenced); Hermes's job is never changed. It follows the owner on every device.
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { RestPolicy } from './policy.ts';

export interface JobMutes {
  muted(profile: string, jobId: string): boolean;
  /** Hears every change to a switch. Returns how to stop. */
  subscribe(listener: () => void): () => void;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function mountJobNotifications(app: Hono<AuthEnv>, { store, policy }: { store: CaduceusStore; policy: RestPolicy }): JobMutes {
  const { db } = store;
  const listeners = new Set<() => void>();
  const muted = (profile: string, jobId: string): boolean => db.prepare('SELECT 1 FROM job_notifications_off WHERE profile = ? AND job_id = ?').get(profile, jobId) !== undefined;

  app.get('/_caduceus/api/work/jobs/:profile/:jobId/notifications', (c) => {
    const { profile, jobId } = c.req.param();
    if (!NAME.test(profile) || !NAME.test(jobId)) return c.json({ error: 'bad-request' }, 400);
    return c.json({ enabled: !muted(profile, jobId) });
  });

  app.put('/_caduceus/api/work/jobs/:profile/:jobId/notifications', async (c) => {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare('PUT', url.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    const { profile, jobId } = c.req.param();
    const body: unknown = await c.req.json().catch(() => undefined);
    if (!NAME.test(profile) || !NAME.test(jobId) || !isRecord(body) || typeof body.enabled !== 'boolean') return c.json({ error: 'bad-request' }, 400);
    const decision = await policy.decide(prepared, { method: 'PUT', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: new TextEncoder().encode(JSON.stringify(body)) }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    if (body.enabled) db.prepare('DELETE FROM job_notifications_off WHERE profile = ? AND job_id = ?').run(profile, jobId);
    else db.prepare('INSERT OR IGNORE INTO job_notifications_off (profile, job_id) VALUES (?, ?)').run(profile, jobId);
    for (const listener of [...listeners]) listener();
    return c.json({ enabled: body.enabled });
  });

  return {
    muted,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
