// The policy proxy's own API: read-only mode (Settings › Security) and the typed confirmations of T3 actions.
import type { Hono } from 'hono';
import type { ReadOnlyState } from '@caduceus/contracts/caduceus-api';
import { classifyGatewayMethod } from '@caduceus/contracts/policy/gateway';
import { authClient, requireStepUp, type AuthEnv } from './auth-routes.ts';
import type { Confirmations } from './confirmations.ts';
import type { OwnerAuth } from './owner-auth.ts';
import { READ_ONLY_MESSAGE, type RestPolicy } from './policy.ts';
import type { ReadOnlyMode } from './read-only.ts';

/** What the owner typed to confirm: the name of an object, never a paragraph. */
const TARGET_LENGTH = { min: 1, max: 256 } as const;

export function mountPolicyRoutes(app: Hono<AuthEnv>, auth: OwnerAuth, readOnly: ReadOnlyMode, confirmations: Confirmations, policy: RestPolicy): void {
  app.get('/_caduceus/api/policy/read-only', (c) => c.json({ readOnly: readOnly.enabled(), ...(readOnly.automatic() ? { automatic: readOnly.automatic() } : {}) } satisfies ReadOnlyState));

  // Turning it on or off is T2: a stolen cookie must not be able to lift the safety, or to lock the owner out of writing.
  app.put('/_caduceus/api/policy/read-only', requireStepUp(auth), async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const value = typeof body === 'object' && body !== null && 'readOnly' in body ? body.readOnly : undefined;
    if (typeof value !== 'boolean') return c.json({ error: 'bad-request' }, 400);
    readOnly.set(value, authClient(c));
    return c.json({ readOnly: value });
  });

  /**
   * The typed confirmation of a T3 action: the owner has typed `typed` for `target` and the action is `operation` (the
   * request line: `DELETE /api/profiles/coder`); the answer is a token the request must carry as `X-Caduceus-Confirmation`.
   * It needs the step-up the action needs, and is refused while read-only mode is on, as the action itself would be.
   */
  app.post('/_caduceus/api/policy/confirmations', requireStepUp(auth), async (c) => {
    if (readOnly.enabled()) return c.json({ error: 'read-only', tier: 'T3', message: READ_ONLY_MESSAGE }, 403);
    const body: unknown = await c.req.json().catch(() => undefined);
    const field = (name: string): unknown => (typeof body === 'object' && body !== null && name in body ? (body as Record<string, unknown>)[name] : undefined);
    const [operation, target, typed, bodySha256] = [field('operation'), field('target'), field('typed'), field('bodySha256')];
    if (typeof operation !== 'string' || typeof target !== 'string' || typeof typed !== 'string') return c.json({ error: 'bad-request' }, 400);
    if (bodySha256 !== undefined && (typeof bodySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(bodySha256))) return c.json({ error: 'bad-request' }, 400);
    if (target.length < TARGET_LENGTH.min || target.length > TARGET_LENGTH.max || typed !== target) return c.json({ error: 'confirmation-mismatch' }, 400);
    const [method, ...rest] = operation.split(' ');
    // A gateway method (`rpc rollback.restore`) is confirmed the same way; the gateway policy reads the token from the frame (`gateway-policy.ts`).
    const requestLine = method === 'rpc' ? (rest.length === 1 && classifyGatewayMethod(rest[0], {}).ok ? operation : undefined) : policy.requestLine(method, rest.join(' '));
    if (!requestLine) return c.json({ error: 'unknown-operation' }, 400);
    const { token, expiresAt } = confirmations.issue({ sessionId: c.get('session')!.id, operation: requestLine, target, bodySha256 });
    return c.json({ token, expiresAt: new Date(expiresAt).toISOString() });
  });
}
