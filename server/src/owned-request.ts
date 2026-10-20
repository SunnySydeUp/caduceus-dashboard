// What every Caduceus-owned route does first: the request line goes through the policy like a Hermes route (read-only mode, step-up, the typed
// confirmation of a T3, the audit entry of a T1 or above) and its JSON body is read within a limit. A refusal is the policy's own body.
import type { Context } from 'hono';
import { authClient, type AuthEnv } from './auth-routes.ts';
import { readBody } from './hermes-proxy.ts';
import type { Requester, RestPolicy } from './policy.ts';

export type Judged = { ok: true; requester: Requester; url: URL; body: unknown } | { ok: false; response: Response };

/** `body` is `undefined` for a request with none, and `null` for one that is not JSON. */
export async function judgeOwned(c: Context<AuthEnv>, policy: RestPolicy, maxBodyBytes = 64 * 1024): Promise<Judged> {
  const url = new URL(c.req.url);
  const requester: Requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
  const prepared = policy.prepare(c.req.method, url.pathname, requester);
  if (!prepared.allow) return { ok: false, response: c.json(prepared.body, prepared.status) };
  const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD';
  const raw = hasBody ? await readBody(c.req.raw, maxBodyBytes) : new Uint8Array(0);
  if (raw === 'too-large') return { ok: false, response: c.json({ error: 'payload-too-large', message: 'The request is too large.', maxBytes: maxBodyBytes }, 413) };
  const decision = await policy.decide(prepared, { method: c.req.method, search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
  if (!decision.allow) return { ok: false, response: c.json(decision.body, decision.status) };
  let body: unknown;
  if (raw.length > 0) {
    try {
      body = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      body = null;
    }
  }
  return { ok: true, requester, url, body };
}
