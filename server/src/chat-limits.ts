// How long Hermes waits for the owner while a chat turn runs, for the countdown on a clarify card. Hermes keeps the wait in each
// profile's config (`clarify.timeout`, or `agent.clarify_timeout`), and its REST API serves the whole config, secrets and all: the
// page asks Caduceus, which reads it here and passes on only the number.
import type { Hono } from 'hono';
import type { ChatLimits } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';
import type { HermesBackend } from './hermes-backend.ts';

/** Hermes's own default (`tools/clarify_gateway.py`): an hour. */
const DEFAULT_CLARIFY_TIMEOUT_S = 3600;

/** The clarify wait in seconds from a profile's config: the legacy `clarify.timeout` if set, else `agent.clarify_timeout`, else an hour. 0 or less is for ever. */
export function clarifyTimeoutOf(config: unknown): number {
  const root = isRecord(config) ? config : {};
  const legacy = isRecord(root.clarify) ? root.clarify.timeout : undefined;
  const raw = legacy ?? (isRecord(root.agent) ? root.agent.clarify_timeout : undefined) ?? DEFAULT_CLARIFY_TIMEOUT_S;
  const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(seconds) ? Math.trunc(seconds) : DEFAULT_CLARIFY_TIMEOUT_S;
}

export function mountChatLimits(app: Hono<AuthEnv>, backend: HermesBackend): void {
  app.get('/_caduceus/api/chat/limits', async (c) => {
    const profile = c.req.query('profile');
    const res = await backend.fetch(`/api/config${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`);
    if (!res.ok) return c.json({ error: 'hermes-unavailable', message: `Hermes could not read its config (HTTP ${res.status}).` }, 502);
    return c.json({ clarifyTimeoutS: clarifyTimeoutOf(await res.json()) } satisfies ChatLimits);
  });
}
