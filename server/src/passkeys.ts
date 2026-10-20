// The owner's passkeys (WebAuthn credentials), kept in the Caduceus store, and the WebAuthn ceremonies that make and use them.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Passkey } from '@caduceus/contracts/caduceus-api';
import type { AuditLog } from './audit-log.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { AuthClient, RemoveSignInMethodResult } from './owner-auth.ts';

/**
 * The WebAuthn relying party. Its ID is a hostname that must stay stable, because every passkey is bound to it:
 * `localhost` in development, the tailnet hostname in production (ticket 13). WebAuthn accepts a ceremony from any
 * of Caduceus's origins on that hostname or below it.
 */
export interface RelyingParty {
  id: string;
  /** Caduceus's origins: its loopback URLs and the Serve origin (filled in once the port is known). */
  origins: ReadonlySet<string>;
}

/** How long the browser (and Caduceus) waits for the owner to answer a passkey prompt. */
const CEREMONY_MS = 5 * 60_000;
/** Unanswered challenges kept per book; beyond it the oldest is dropped, so a flood of option requests cannot grow memory. */
const MAX_PENDING_CHALLENGES = 64;

/**
 * Challenges handed out and not yet answered. Each is single-use, expires with its ceremony and is bound to what it
 * was issued for (`sign-in`, or a ceremony of one session), so an answer cannot be replayed or used elsewhere.
 */
function challengeBook(now: () => number) {
  const issued = new Map<string, { binding: string; expiresAt: number }>();
  return {
    add(challenge: string, binding: string) {
      for (const [key, entry] of issued) if (entry.expiresAt <= now()) issued.delete(key);
      if (issued.size >= MAX_PENDING_CHALLENGES) issued.delete(issued.keys().next().value!);
      issued.set(challenge, { binding, expiresAt: now() + CEREMONY_MS });
    },
    /** Takes a challenge back, once: whether it was issued for `binding` and is still fresh. */
    take(challenge: string, binding: string): boolean {
      const entry = issued.get(challenge);
      issued.delete(challenge);
      return entry !== undefined && entry.binding === binding && now() < entry.expiresAt;
    },
  };
}

interface PasskeyRow {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export interface Passkeys {
  list(): Passkey[];
  /** Starts registering a passkey for the owner signed in with session `sessionId`. */
  registrationOptions(sessionId: string): Promise<PublicKeyCredentialCreationOptionsJSON>;
  /** Finishes it; `undefined` when the response does not answer a challenge this session was given, or fails to verify. */
  register(sessionId: string, response: RegistrationResponseJSON, name: string, client: AuthClient): Promise<Passkey | undefined>;
  /** Starts a passkey sign-in: any of the owner's passkeys, which the browser discovers (no username). */
  signInOptions(): Promise<PublicKeyCredentialRequestOptionsJSON>;
  /** Finishes it: whether the response is a fresh, user-verified assertion by one of the owner's passkeys. */
  verifySignIn(response: AuthenticationResponseJSON): Promise<boolean>;
  /**
   * Starts a step-up for session `sessionId`: a fresh assertion by any of the owner's passkeys, named so the browser
   * asks at once. `undefined` when the owner has no passkey.
   */
  stepUpOptions(sessionId: string): Promise<PublicKeyCredentialRequestOptionsJSON | undefined>;
  /** Finishes it: whether the response answers a challenge this session was given. */
  verifyStepUp(sessionId: string, response: AuthenticationResponseJSON): Promise<boolean>;
  /** Renames a passkey; `undefined` when there is no such passkey. */
  rename(id: string, name: string, client: AuthClient): Passkey | undefined;
  /** Deletes a passkey, unless it is the owner's only sign-in method left. */
  remove(id: string, client: AuthClient): RemoveSignInMethodResult;
}

export function createPasskeys(store: CaduceusStore, audit: AuditLog, now: () => number, rp: RelyingParty): Passkeys {
  const { db } = store;
  // Sign-in challenges go to anyone, so they are kept apart: a flood of them cannot evict a signed-in owner's.
  const anonymousChallenges = challengeBook(now);
  const sessionChallenges = challengeBook(now);

  const toPasskey = (row: PasskeyRow): Passkey => ({
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at === null ? null : new Date(row.last_used_at).toISOString(),
  });
  // WebAuthn checks the page's origin against these: Caduceus's own origins on the RP ID's hostname.
  const expectedOrigins = () =>
    [...rp.origins].filter((origin) => {
      const { hostname } = new URL(origin);
      return hostname === rp.id || hostname.endsWith(`.${rp.id}`);
    });

  /** Verifies an assertion by one of the owner's passkeys against a challenge `takeChallenge` accepts, and records the use. */
  async function verifyAssertion(response: AuthenticationResponseJSON, takeChallenge: (challenge: string) => boolean): Promise<boolean> {
    const row = db.prepare('SELECT id, public_key, counter, transports FROM passkeys WHERE id = ?').get(String(response?.id)) as
      | { id: string; public_key: Uint8Array<ArrayBuffer>; counter: number; transports: string }
      | undefined;
    if (!row) return false;
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: takeChallenge,
      expectedOrigin: expectedOrigins(),
      expectedRPID: rp.id,
      credential: { id: row.id, publicKey: row.public_key, counter: row.counter, transports: JSON.parse(row.transports) },
      requireUserVerification: true,
    }).catch(() => undefined);
    if (!verification?.verified) return false;
    db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(verification.authenticationInfo.newCounter, now(), row.id);
    return true;
  }

  return {
    list() {
      const rows = db.prepare('SELECT id, name, created_at, last_used_at FROM passkeys ORDER BY created_at, rowid').all() as unknown as PasskeyRow[];
      return rows.map(toPasskey);
    },

    async registrationOptions(sessionId) {
      const { webauthn_user_id } = db.prepare('SELECT webauthn_user_id FROM owner').get() as { webauthn_user_id: string };
      const existing = db.prepare('SELECT id, transports FROM passkeys').all() as { id: string; transports: string }[];
      const options = await generateRegistrationOptions({
        rpName: 'Caduceus',
        rpID: rp.id,
        userName: 'owner',
        userDisplayName: 'Caduceus owner',
        userID: Buffer.from(webauthn_user_id, 'hex'),
        timeout: CEREMONY_MS,
        attestationType: 'none',
        excludeCredentials: existing.map((row) => ({ id: row.id, transports: JSON.parse(row.transports) })),
        // Discoverable, so the browser can offer it at sign-in with no username; verified, so it alone signs in.
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      sessionChallenges.add(options.challenge, `register:${sessionId}`);
      return options;
    },

    async register(sessionId, response, name, client) {
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: (challenge) => sessionChallenges.take(challenge, `register:${sessionId}`),
        expectedOrigin: expectedOrigins(),
        expectedRPID: rp.id,
        requireUserVerification: true,
      }).catch(() => undefined);
      if (!verification?.verified) return undefined;
      const { credential } = verification.registrationInfo;
      const at = now();
      const { n: existing } = db.prepare('SELECT count(*) AS n FROM passkeys').get() as { n: number };
      const tier = existing > 0 ? 'T2' : 'T1';
      db.prepare('INSERT INTO passkeys (id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        credential.id,
        credential.publicKey,
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        name,
        at,
      );
      audit.record({ actor: 'owner', action: 'passkey.register', target: `passkey:${credential.id}`, source: client.source, tier });
      return toPasskey({ id: credential.id, name, created_at: at, last_used_at: null });
    },

    async signInOptions() {
      const options = await generateAuthenticationOptions({ rpID: rp.id, timeout: CEREMONY_MS, userVerification: 'required' });
      anonymousChallenges.add(options.challenge, 'sign-in');
      return options;
    },

    verifySignIn: (response) => verifyAssertion(response, (challenge) => anonymousChallenges.take(challenge, 'sign-in')),

    async stepUpOptions(sessionId) {
      const existing = db.prepare('SELECT id, transports FROM passkeys').all() as { id: string; transports: string }[];
      if (existing.length === 0) return undefined;
      const options = await generateAuthenticationOptions({
        rpID: rp.id,
        timeout: CEREMONY_MS,
        userVerification: 'required',
        allowCredentials: existing.map((row) => ({ id: row.id, transports: JSON.parse(row.transports) })),
      });
      sessionChallenges.add(options.challenge, `step-up:${sessionId}`);
      return options;
    },

    verifyStepUp: (sessionId, response) => verifyAssertion(response, (challenge) => sessionChallenges.take(challenge, `step-up:${sessionId}`)),

    rename(id, name, client) {
      const row = db.prepare('UPDATE passkeys SET name = ? WHERE id = ? RETURNING id, name, created_at, last_used_at').get(name, id) as PasskeyRow | undefined;
      if (!row) return undefined;
      audit.record({ actor: 'owner', action: 'passkey.rename', target: `passkey:${id}`, source: client.source });
      return toPasskey(row);
    },

    remove(id, client) {
      // One statement, so the password removed at the same moment cannot leave the owner with no way in.
      const { changes } = db
        .prepare('DELETE FROM passkeys WHERE id = ? AND ((SELECT password_hash FROM owner) IS NOT NULL OR (SELECT count(*) FROM passkeys) > 1)')
        .run(id);
      if (changes === 0) return db.prepare('SELECT 1 FROM passkeys WHERE id = ?').get(id) ? 'last-sign-in-method' : 'not-found';
      audit.record({ actor: 'owner', action: 'passkey.delete', target: `passkey:${id}`, source: client.source, tier: 'T2' });
      return 'removed';
    },
  };
}
