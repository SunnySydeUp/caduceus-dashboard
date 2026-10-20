// Typed confirmations: the owner's confirmation of a T3 action, made at the moment of the action and good for one request.
//
// A token is bound to the session that confirmed it, to the request line (`DELETE /api/profiles/coder`, `rpc session.delete`),
// optionally to the exact body, and to the target the owner typed, which the audit log shows. It is single-use and short-lived:
// a request that is queued (while the device is offline, say) and replayed later arrives with a token that has expired
// or been used, so a T3 action can never be replayed from a queue. Kept in memory: a restart only means confirming again.
import crypto from 'node:crypto';

/** How long a typed confirmation stays good: long enough to send the request it confirms, too short to be queued. */
export const CONFIRMATION_TTL_MS = 60_000;
/** How many unused confirmations are kept at most; a flood of them cannot grow the map. */
const MAX_PENDING = 64;

export interface ConfirmationBinding {
  sessionId: string;
  /** The request line, as `Policy.requestLine` writes it. */
  operation: string;
  /** What the owner typed to confirm: the name of the thing the action changes. */
  target: string;
  /** SHA-256 (hex) of the exact body the request will carry, when the confirmation is for that body only. */
  bodySha256?: string;
}

export type ConfirmationCheck = { ok: true; target: string } | { ok: false; reason: 'required' | 'invalid' | 'expired' };

export interface Confirmations {
  /** Makes a token for `binding`; `expiresAt` is when it stops being good (milliseconds since the epoch). */
  issue(binding: ConfirmationBinding): { token: string; expiresAt: number };
  /**
   * Checks a token against the request that carries it, and uses it up: whatever the answer, it never works again.
   * `bodySha256` is asked for only if the token is bound to a body.
   */
  consume(token: string | undefined, request: { sessionId: string; operation: string; bodySha256: () => string }): ConfirmationCheck;
}

export function createConfirmations(now: () => number): Confirmations {
  const pending = new Map<string, ConfirmationBinding & { expiresAt: number }>();
  return {
    issue(binding) {
      const at = now();
      for (const [token, entry] of pending) if (entry.expiresAt <= at) pending.delete(token);
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = at + CONFIRMATION_TTL_MS;
      pending.set(token, { ...binding, expiresAt });
      return { token, expiresAt };
    },
    consume(token, request) {
      if (!token) return { ok: false, reason: 'required' };
      const entry = pending.get(token);
      if (!entry) return { ok: false, reason: 'invalid' };
      pending.delete(token);
      if (entry.expiresAt <= now()) return { ok: false, reason: 'expired' };
      const sameRequest = entry.sessionId === request.sessionId && entry.operation === request.operation;
      if (!sameRequest || (entry.bodySha256 !== undefined && entry.bodySha256 !== request.bodySha256())) return { ok: false, reason: 'invalid' };
      return { ok: true, target: entry.target };
    },
  };
}
