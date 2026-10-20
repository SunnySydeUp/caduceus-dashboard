// Connect › Gateway (M5 #01): the few facts about the gateway that Hermes does not give and Caduceus must. The gateway's state,
// its profiles and its processes are read by the web app from Hermes's own endpoints through the policy proxy, and the actions
// (start, stop, restart, drain, migrate) go through it too, each with its tier. Nothing here copies what Hermes says.
import type { Hono } from 'hono';
import type { GatewayFacts, PendingGatewayRestart } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { HermesBackend } from './hermes-backend.ts';

/** The longest reason a module may give for a restart: a line of the banner. */
const MAX_REASON = 120;
const MAX_PROFILE = 64;

/** Hermes's answer to a GET, or `undefined` when it did not answer. */
async function ask(backend: HermesBackend, path: string): Promise<unknown> {
  try {
    const res = await backend.fetch(path, { signal: AbortSignal.timeout(5_000) });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

interface Gateways {
  /** The profiles Hermes lists; `undefined` when it did not answer. */
  profiles: string[] | undefined;
  /** The pid of the gateway process serving each profile that has one, in the order Hermes lists the profiles. */
  pids: Map<string, number>;
}

/** Hermes's profile list and, for each profile, the pid its status endpoint gives the gateway. */
async function readGateways(backend: HermesBackend): Promise<Gateways> {
  const list = await ask(backend, '/api/profiles');
  const profiles = isRecord(list) && Array.isArray(list.profiles) ? list.profiles.flatMap((profile) => (isRecord(profile) && typeof profile.name === 'string' ? [profile.name] : [])) : undefined;
  const statuses = await Promise.all((profiles ?? []).map((name) => ask(backend, `/api/status?profile=${encodeURIComponent(name)}`)));
  const pids = new Map<string, number>();
  (profiles ?? []).forEach((name, index) => {
    const status = statuses[index];
    if (isRecord(status) && status.gateway_running === true && typeof status.gateway_pid === 'number') pids.set(name, status.gateway_pid);
  });
  return { profiles, pids };
}

export function mountGatewayRoutes(
  app: Hono<AuthEnv>,
  { backend, store, now, processStartTimes }: { backend: HermesBackend; store: CaduceusStore; now: () => number; processStartTimes: (pids: readonly number[]) => Promise<Map<number, number>> },
): void {
  const { db } = store;

  const pending = (): PendingGatewayRestart[] => {
    const rows = db.prepare('SELECT profile, reason, raised_at FROM gateway_restart_pending ORDER BY profile, raised_at, reason').all() as { profile: string; reason: string; raised_at: number }[];
    const byProfile = new Map<string, PendingGatewayRestart>();
    for (const { profile, reason, raised_at } of rows) {
      const entry = byProfile.get(profile) ?? { profile, reasons: [], raisedAt: '' };
      entry.reasons.push(reason);
      // Rows come oldest first, so the last one is the latest change.
      entry.raisedAt = new Date(raised_at).toISOString();
      byProfile.set(profile, entry);
    }
    return [...byProfile.values()];
  };

  app.get('/_caduceus/api/gateway', async (c) => {
    const { profiles, pids } = await readGateways(backend);
    const started = await processStartTimes([...pids.values()]);
    const startedAt: GatewayFacts['startedAt'] = {};
    for (const [profile, pid] of pids) {
      const at = started.get(pid);
      if (at !== undefined) startedAt[profile] = new Date(at).toISOString();
    }
    // A change is applied by a start that came after it. Hermes not answering says nothing about the profiles, so nothing goes then.
    for (const { profile, reason, raised_at } of db.prepare('SELECT profile, reason, raised_at FROM gateway_restart_pending').all() as { profile: string; reason: string; raised_at: number }[]) {
      const gone = profiles !== undefined && !profiles.includes(profile);
      const at = startedAt[profile];
      if (gone || (at !== undefined && Date.parse(at) > raised_at)) db.prepare('DELETE FROM gateway_restart_pending WHERE profile = ? AND reason = ?').run(profile, reason);
    }
    return c.json({ startedAt, pending: pending() } satisfies GatewayFacts);
  });

  // Any module raises the banner here, after it has saved something that a gateway restart applies. It changes nothing in Hermes.
  app.post('/_caduceus/api/gateway/pending', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const profile = isRecord(body) && typeof body.profile === 'string' ? body.profile.trim() : '';
    const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason.trim() : '';
    if (profile === '' || profile.length > MAX_PROFILE || reason === '' || reason.length > MAX_REASON) return c.json({ error: 'bad-request' }, 400);
    db.prepare('INSERT INTO gateway_restart_pending (profile, reason, raised_at) VALUES (?, ?, ?) ON CONFLICT (profile, reason) DO UPDATE SET raised_at = excluded.raised_at').run(profile, reason, now());
    return c.json({ pending: pending() });
  });
}
