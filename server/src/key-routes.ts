// Test connection for a key Hermes holds (M5 #10). Hermes validates a key it is given (`POST /api/providers/validate`), and the page never
// holds a stored key, so Caduceus reads the key from Hermes, asks Hermes to validate it, and answers with the verdict alone.
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import type { RestPolicy } from './policy.ts';

/** The body of a request names a variable and, at most, a profile. */
const MAX_BODY = 1024;
/** How many models an answer lists. */
const MAX_MODELS = 200;

export interface KeyRoutesDeps {
  backend: HermesBackend;
  policy: RestPolicy;
}

const jsonOf = (res: Response): Promise<unknown> => res.json().catch(() => undefined);

export function mountKeyRoutes(app: Hono<AuthEnv>, { backend, policy }: KeyRoutesDeps): void {
  app.post('/_caduceus/api/keys/test', async (c) => {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare('POST', url.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    const raw = await readBody(c.req.raw, MAX_BODY);
    if (raw === 'too-large') return c.json({ error: 'bad-request' }, 400);
    const request: unknown = (() => {
      try {
        return raw.length === 0 ? undefined : JSON.parse(Buffer.from(raw).toString('utf8'));
      } catch {
        return undefined;
      }
    })();
    if (!isRecord(request) || typeof request.key !== 'string' || request.key === '') return c.json({ error: 'bad-request' }, 400);
    const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);

    // Hermes's reveal is audited and rate limited on its side; the value goes no further than the validation request below.
    const profile = url.searchParams.get('profile');
    const reveal = await backend.fetch(`/api/env/reveal${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: request.key }),
    });
    if (reveal.status === 404) return c.json({ error: 'not-set', message: `${request.key} is not set${profile ? ` for ${profile}` : ''}, so there is nothing to check.` }, 404);
    if (reveal.status === 429) return c.json({ error: 'rate-limited', message: 'Hermes limits how often a key can be read. Try again in a few seconds.' }, 429);
    const revealed = await jsonOf(reveal);
    if (!reveal.ok || !isRecord(revealed) || typeof revealed.value !== 'string') return c.json({ error: 'bad-upstream', message: 'Hermes did not give the key to check.' }, 502);
    const value = revealed.value;

    const checked = await backend.fetch('/api/providers/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: request.key, value }),
    });
    const verdict = await jsonOf(checked);
    if (!checked.ok || !isRecord(verdict)) return c.json({ error: 'bad-upstream', message: 'Hermes could not check the key.' }, 502);
    // Only the verdict is passed on, and a message that quotes the key is made not to.
    const message = typeof verdict.message === 'string' ? verdict.message.split(value).join('***') : '';
    const models = Array.isArray(verdict.models) ? verdict.models.filter((model): model is string => typeof model === 'string').slice(0, MAX_MODELS) : [];
    return c.json({ ok: verdict.ok === true, reachable: verdict.reachable === true, message, models });
  });
}
