// A Caduceus route that judges its own request through the policy before it does anything (the owned operations of `contracts/policy/owned.ts`):
// the tier, read-only mode and the audit entry, then the request's JSON body. The playbook library's saves and deletes and the playbook runs use it.
import type { Context } from 'hono';
import { authClient, type AuthEnv } from './auth-routes.ts';
import { readBody } from './hermes-proxy.ts';
import type { RestPolicy } from './policy.ts';

/**
 * Runs the request through the policy and reads its JSON body. Returns the refusal to answer with, or the body (`undefined` when the request has
 * none or it is not JSON, which the route then refuses as a bad request).
 */
export async function gateRequest(policy: RestPolicy, c: Context<AuthEnv, string>, method: string, maxBodyBytes: number): Promise<{ refusal: Response } | { body: unknown }> {
  const url = new URL(c.req.url);
  const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
  const prepared = policy.prepare(method, url.pathname, requester);
  if (!prepared.allow) return { refusal: c.json(prepared.body, prepared.status) };
  const raw = await readBody(c.req.raw, maxBodyBytes);
  if (raw === 'too-large') return { refusal: c.json({ error: 'payload-too-large' }, 413) };
  const decision = await policy.decide(prepared, { method, search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
  if (!decision.allow) return { refusal: c.json(decision.body, decision.status) };
  try {
    return { body: raw.length === 0 ? undefined : (JSON.parse(Buffer.from(raw).toString('utf8')) as unknown) };
  } catch {
    return { body: undefined };
  }
}
