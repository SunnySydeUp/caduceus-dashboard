// Health: the liveness probe a supervisor calls, and the report and fixes the Health screen uses.
import type { Hono } from 'hono';
import type { AuditLog } from './audit-log.ts';
import { authClient, requireStepUp, type AuthEnv } from './auth-routes.ts';
import type { Health } from './health.ts';
import type { HermesBackend } from './hermes-backend.ts';
import type { OwnerAuth } from './owner-auth.ts';

export function mountHealthRoutes(app: Hono<AuthEnv>, { health, auth, audit, backend }: { health: Health; auth: OwnerAuth; audit: AuditLog; backend: HermesBackend }): void {
  // Public (see PUBLIC_PATHS), so it answers only whether this process is up: no version, path, pid, count or Hermes state.
  // Hermes being down is not Caduceus being down, and a supervisor that restarted Caduceus for it would only make things worse.
  app.get('/_caduceus/healthz', (c) => c.json({ ok: true }));

  app.get('/_caduceus/api/health', async (c) => c.json(await health.report()));

  // The fix of a Repair (`RepairFix`). T2: the owner has confirmed with a passkey, because it interrupts every turn in progress.
  // Read-only mode does not stop it: it is no change to Hermes's data, and read-only mode is just when the owner may need it.
  app.post('/_caduceus/api/health/fixes/restart-backend', requireStepUp(auth), (c) => {
    audit.record({ actor: 'owner', action: 'backend.restart', target: 'hermes-backend', source: authClient(c).source, tier: 'T2' });
    // Not awaited: Hermes takes seconds to come back, and the page watches its connection do that. It rejects only once
    // Caduceus itself is stopping, when there is nothing left to restart.
    void backend.restart().catch(() => undefined);
    return c.json({ restarting: true }, 202);
  });
}
