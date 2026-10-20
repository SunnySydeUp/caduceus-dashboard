// The owner's password and sign-in sessions, kept in the Caduceus store.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { SessionInfo } from '@caduceus/contracts/caduceus-api';
import { STEP_UP_MS } from '@caduceus/contracts/policy/tiers';
import type { AuditLog } from './audit-log.ts';
import type { CaduceusStore } from './caduceus-store.ts';

const scrypt = promisify<crypto.BinaryLike, crypto.BinaryLike, number, crypto.ScryptOptions, Buffer>(crypto.scrypt);

/** scrypt (memory-hard) at OWASP's recommended cost: 2^17 × 8 × 128 bytes = 128 MiB per hash. */
const KDF = { N: 2 ** 17, r: 8, p: 1, keyLength: 32 } as const;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keyLength } = KDF;
  const key = await scrypt(password, salt, keyLength, { N, r, p, maxmem: 2 * 128 * N * r });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Checks a password against a stored hash, using the cost parameters the hash was made with. */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, N, r, p, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64');
  const options = { N: Number(N), r: Number(r), p: Number(p), maxmem: 2 * 128 * Number(N) * Number(r) };
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, options);
  return crypto.timingSafeEqual(actual, expected);
}

/** A session ends after this long without a request... */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
/** ...and this long after sign-in, however active it is. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sign-in throttling. There is one owner account, so failures are counted for the account, never per client:
 * nothing a client sends (forwarding headers, say) can give it a fresh allowance.
 */
const THROTTLE = { freeFailures: 5, firstLockMs: 60_000, maxLockMs: 15 * 60_000 } as const;

export interface OwnerSession {
  id: string;
  createdAt: number;
  lastSeenAt: number;
}

export type SignInResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'no-owner' | 'no-password' | 'wrong-password' }
  | { ok: false; reason: 'throttled'; retryAfterMs: number };

/** Who is asking: recorded with the session and in the audit log. */
export interface AuthClient {
  userAgent: string;
  /** Where the request came from, as the audit log names it (see `AuditEntry.source`). */
  source: string;
}

/** What removing a sign-in method came to. The owner always keeps at least one: the password or a passkey. */
export type RemoveSignInMethodResult = 'removed' | 'not-found' | 'last-sign-in-method';

export interface OwnerAuth {
  ownerExists(): boolean;
  /** Whether the owner has a password (a passkey-only owner has none). */
  hasPassword(): boolean;
  /** Sets or replaces the owner's password. */
  setPassword(password: string, client: AuthClient): Promise<void>;
  /** Removes the owner's password, unless it is the only sign-in method left. */
  removePassword(client: AuthClient): RemoveSignInMethodResult;
  /** Sets the owner's password and opens the first session; `undefined` when an owner already exists. */
  setUp(password: string, client: AuthClient): Promise<{ token: string } | undefined>;
  signIn(password: string, client: AuthClient): Promise<SignInResult>;
  /** Opens a session for an owner who has just proved a passkey (`Passkeys.verifySignIn`). */
  signInWithPasskey(client: AuthClient): { token: string };
  /** Opens a session for an owner who has just been proved by another method (`action` names it in the audit log: `session.sign-in-oidc`). */
  signInWith(action: string, client: AuthClient): { token: string };
  /** The live session a cookie token belongs to. */
  session(token: string | undefined): OwnerSession | undefined;
  /** Ends the session a cookie token belongs to, if there is one. */
  signOut(token: string | undefined, client: AuthClient): void;
  /** Every live session, newest first; `currentId` is the asking one. */
  sessions(currentId: string): SessionInfo[];
  /** Ends a session by its id (the device list's Revoke); `false` when there is no such session. */
  revoke(id: string, client: AuthClient): boolean;
  /** Grants session `sessionId` a step-up for STEP_UP_MS, after a fresh passkey assertion; returns when it ends. */
  grantStepUp(sessionId: string, client: AuthClient): number;
  /** Whether session `sessionId` holds a live step-up grant. */
  hasStepUp(sessionId: string): boolean;
  /** Calls `listener` with the id of every session that ends, however it ends (signed out, revoked, expired). Returns how to stop listening. */
  onSessionEnded(listener: (sessionId: string) => void): () => void;
}

export function createOwnerAuth(store: CaduceusStore, audit: AuditLog, now: () => number): OwnerAuth {
  const { db } = store;
  // Only a hash of each token is stored, so a copy of the store (a backup, say) cannot be replayed as a session.
  const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
  // Kept in memory: a restart clears it, but only the owner can restart Caduceus.
  let failures = 0;
  let lockedUntil = 0;
  // Step-up grants by session id. In memory: a restart only means confirming with the passkey again.
  const stepUps = new Map<string, number>();
  const endListeners = new Set<(sessionId: string) => void>();
  /** A session is over (its row is gone): its grant goes with it, and whoever holds something open for it is told. */
  const ended = (sessionId: string) => {
    stepUps.delete(sessionId);
    for (const listener of endListeners) listener(sessionId);
  };

  const openSession = ({ userAgent, source }: AuthClient, action = 'session.sign-in') => {
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomBytes(8).toString('hex');
    const at = now();
    db.prepare('INSERT INTO sessions (id, token_hash, created_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?)').run(
      id,
      tokenHash(token),
      at,
      at,
      userAgent,
    );
    audit.record({ actor: 'owner', action, target: `session:${id}`, source });
    return { ok: true as const, token };
  };

  return {
    ownerExists: () => db.prepare('SELECT 1 FROM owner').get() !== undefined,

    hasPassword: () => db.prepare('SELECT 1 FROM owner WHERE password_hash IS NOT NULL').get() !== undefined,

    async setPassword(password, client) {
      db.prepare('UPDATE owner SET password_hash = ?').run(await hashPassword(password));
      audit.record({ actor: 'owner', action: 'owner.password-set', target: 'owner', source: client.source, tier: 'T2' });
    },

    removePassword(client) {
      // One statement, so a passkey deleted at the same moment cannot leave the owner with no way in.
      const { changes } = db
        .prepare('UPDATE owner SET password_hash = NULL WHERE password_hash IS NOT NULL AND EXISTS (SELECT 1 FROM passkeys)')
        .run();
      if (changes === 0) return this.hasPassword() ? 'last-sign-in-method' : 'not-found';
      audit.record({ actor: 'owner', action: 'owner.password-remove', target: 'owner', source: client.source, tier: 'T2' });
      return 'removed';
    },

    async setUp(password, client) {
      if (this.ownerExists()) return undefined;
      const hash = await hashPassword(password);
      // Two first-run requests may race; only one of them becomes the owner.
      const { changes } = db
        .prepare('INSERT INTO owner (id, password_hash, created_at) VALUES (1, ?, ?) ON CONFLICT DO NOTHING')
        .run(hash, now());
      if (changes !== 1) return undefined;
      audit.record({ actor: 'owner', action: 'owner.set-up', target: 'owner', source: client.source });
      return openSession(client);
    },

    async signIn(password, client) {
      const owner = db.prepare('SELECT password_hash FROM owner').get() as { password_hash: string | null } | undefined;
      if (!owner) return { ok: false, reason: 'no-owner' };
      if (owner.password_hash === null) return { ok: false, reason: 'no-password' };
      const at = now();
      // Refusals while locked are not audited: they cost nothing, and a flood of them would only bloat the log.
      if (at < lockedUntil) return { ok: false, reason: 'throttled', retryAfterMs: lockedUntil - at };
      // Counted before the slow hash check, so a burst of parallel guesses cannot all start before the lock does.
      failures += 1;
      if (failures >= THROTTLE.freeFailures) {
        lockedUntil = at + Math.min(THROTTLE.firstLockMs * 2 ** (failures - THROTTLE.freeFailures), THROTTLE.maxLockMs);
      }
      if (!(await verifyPassword(password, owner.password_hash))) {
        audit.record({ actor: 'anonymous', action: 'session.sign-in-failed', target: 'owner', source: client.source });
        return { ok: false, reason: 'wrong-password' };
      }
      failures = 0;
      lockedUntil = 0;
      return openSession(client);
    },

    signInWithPasskey: (client) => openSession(client, 'session.sign-in-passkey'),

    signInWith: (action, client) => openSession(client, action),

    session(token) {
      if (!token) return undefined;
      const row = db
        .prepare('SELECT id, created_at, last_seen_at FROM sessions WHERE token_hash = ?')
        .get(tokenHash(token)) as { id: string; created_at: number; last_seen_at: number } | undefined;
      if (!row) return undefined;
      const at = now();
      if (at - row.last_seen_at >= SESSION_IDLE_MS || at - row.created_at >= SESSION_MAX_AGE_MS) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
        ended(row.id);
        return undefined;
      }
      // Every request counts as use, but recording it once a minute is precise enough for a 7-day idle limit.
      let lastSeenAt = row.last_seen_at;
      if (at - lastSeenAt >= 60_000) {
        lastSeenAt = at;
        db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(at, row.id);
      }
      return { id: row.id, createdAt: row.created_at, lastSeenAt };
    },

    signOut(token, client) {
      const session = this.session(token);
      if (!session) return;
      db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
      ended(session.id);
      audit.record({ actor: 'owner', action: 'session.sign-out', target: `session:${session.id}`, source: client.source });
    },

    sessions(currentId) {
      const at = now();
      // Expired sessions are only deleted when next presented, so leave them out here.
      const rows = db
        .prepare('SELECT id, user_agent, created_at, last_seen_at FROM sessions WHERE last_seen_at > ? AND created_at > ? ORDER BY created_at DESC, rowid DESC')
        .all(at - SESSION_IDLE_MS, at - SESSION_MAX_AGE_MS) as { id: string; user_agent: string; created_at: number; last_seen_at: number }[];
      return rows.map((row) => ({
        id: row.id,
        userAgent: row.user_agent,
        createdAt: new Date(row.created_at).toISOString(),
        lastSeenAt: new Date(row.last_seen_at).toISOString(),
        current: row.id === currentId,
      }));
    },

    revoke(id, client) {
      const { changes } = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      if (changes === 0) return false;
      ended(id);
      audit.record({ actor: 'owner', action: 'session.revoke', target: `session:${id}`, source: client.source, tier: 'T1' });
      return true;
    },

    grantStepUp(sessionId, client) {
      const until = now() + STEP_UP_MS;
      stepUps.set(sessionId, until);
      audit.record({ actor: 'owner', action: 'session.step-up', target: `session:${sessionId}`, source: client.source });
      return until;
    },

    hasStepUp(sessionId) {
      const until = stepUps.get(sessionId);
      if (until === undefined) return false;
      if (now() < until) return true;
      stepUps.delete(sessionId);
      return false;
    },

    onSessionEnded(listener) {
      endListeners.add(listener);
      return () => endListeners.delete(listener);
    },
  };
}
