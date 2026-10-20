// OpenID Connect sign-in (M5 #15): the authorization code flow with PKCE against the one provider the owner configured. Discovery says where the provider's endpoints
// are and must name the issuer the owner typed; the ID token that comes back is accepted only when it is signed with a key the provider publishes and its issuer,
// audience, nonce and expiry are the ones this sign-in expects. Whether the person is the owner is a separate check (`allows`): one configured email or subject.
import crypto from 'node:crypto';
import type { OidcConfig } from './auth-methods.ts';

const TIMEOUT_MS = 5000;
/** How far a provider's clock may differ from this one. */
const SKEW_S = 60;
const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 64;

export interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export type OidcRefusal = 'oidc-disabled' | 'oidc-state-invalid' | 'oidc-token-invalid' | 'oidc-user-not-allowed' | 'oidc-provider-error';

const isLoopback = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '[::1]';

/** An address the provider is reached at: https, or plain http only to this Mac (a provider on the network speaks https, and the code and token cross it). */
export function isSecureUrl(text: unknown): text is string {
  if (typeof text !== 'string' || !URL.canParse(text)) return false;
  const url = new URL(text);
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname));
}

const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

async function getJson(url: string): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    return res.ok ? record(await res.json()) : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the provider's discovery document; a reason in words for the owner when it cannot be used as `issuer`. */
export async function discover(issuer: string): Promise<{ ok: true; discovery: Discovery } | { ok: false; reason: string }> {
  const doc = await getJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (!doc) return { ok: false, reason: 'The provider did not answer with its discovery document (/.well-known/openid-configuration).' };
  if (doc.issuer !== issuer) return { ok: false, reason: `The provider says it is ${String(doc.issuer)}, not ${issuer}. Use the issuer exactly as the provider names it.` };
  const { authorization_endpoint: authorization, token_endpoint: token, jwks_uri: jwks } = doc;
  if (!isSecureUrl(authorization) || !isSecureUrl(token) || !isSecureUrl(jwks)) return { ok: false, reason: 'The provider’s endpoints are missing or not https.' };
  return { ok: true, discovery: { authorization_endpoint: authorization, token_endpoint: token, jwks_uri: jwks } };
}

const decode = (part: string) => Buffer.from(part, 'base64url');

/** The claims of an ID token whose signature, issuer, audience, nonce and expiry all check out; `undefined` otherwise. */
export async function verifyIdToken(token: string, expected: { issuer: string; clientId: string; nonce: string; jwksUri: string; nowMs: number }): Promise<Record<string, unknown> | undefined> {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  let header: Record<string, unknown> | undefined;
  let claims: Record<string, unknown> | undefined;
  try {
    header = record(JSON.parse(decode(parts[0]).toString('utf8')));
    claims = record(JSON.parse(decode(parts[1]).toString('utf8')));
  } catch {
    return undefined;
  }
  // Only the algorithms providers sign with: never `none`, and never a shared-secret one that a public key could be passed off as.
  if (!header || !claims || (header.alg !== 'RS256' && header.alg !== 'ES256')) return undefined;
  const keys = (await getJson(expected.jwksUri))?.keys;
  const candidates = Array.isArray(keys) ? keys.map(record).filter((key) => key !== undefined && (header.kid === undefined || key.kid === header.kid)) : [];
  const input = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signed = candidates.some((jwk) => {
    try {
      // A published key set is JSON of the shape RFC 7517 names; Node refuses what is not a usable key, which is caught below.
      const material = jwk as crypto.webcrypto.JsonWebKey;
      const key = crypto.createPublicKey({ key: material, format: 'jwk' });
      return crypto.verify('sha256', input, header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, decode(parts[2]));
    } catch {
      return false;
    }
  });
  if (!signed) return undefined;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const nowS = expected.nowMs / 1000;
  const valid =
    claims.iss === expected.issuer &&
    audience.includes(expected.clientId) &&
    (audience.length === 1 || claims.azp === expected.clientId) &&
    claims.nonce === expected.nonce &&
    typeof claims.exp === 'number' &&
    claims.exp + SKEW_S > nowS &&
    (claims.nbf === undefined || (typeof claims.nbf === 'number' && claims.nbf - SKEW_S <= nowS));
  return valid ? claims : undefined;
}

/** Whether the person the token names is the one identity the owner configured: an email the provider says is verified, or the provider's subject. */
export function allows(claims: Record<string, unknown>, allowedUser: string): boolean {
  const wanted = allowedUser.trim();
  if (wanted.includes('@')) return claims.email_verified === true && typeof claims.email === 'string' && claims.email.toLowerCase() === wanted.toLowerCase();
  return wanted !== '' && claims.sub === wanted;
}

interface Pending {
  nonce: string;
  verifier: string;
  redirectUri: string;
  next: string;
  expires: number;
}

export interface OidcSignIn {
  /** Starts a sign-in for `redirectUri`: the provider's address to send the browser to, and the state that binds the way back. */
  begin(config: OidcConfig, redirectUri: string, next: string): Promise<{ url: string; state: string } | undefined>;
  /** Finishes it with what the provider sent the browser back with; the state is used up whatever the answer. */
  finish(config: OidcConfig, code: string | undefined, state: string | undefined, cookieState: string | undefined): Promise<{ ok: true; next: string } | { ok: false; reason: OidcRefusal }>;
}

export function createOidcSignIn(now: () => number): OidcSignIn {
  const pending = new Map<string, Pending>();
  return {
    async begin(config, redirectUri, next) {
      const found = await discover(config.issuer);
      if (!found.ok) return undefined;
      const at = now();
      for (const [state, entry] of pending) if (entry.expires <= at) pending.delete(state);
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
      const state = crypto.randomBytes(24).toString('base64url');
      const nonce = crypto.randomBytes(24).toString('base64url');
      const verifier = crypto.randomBytes(48).toString('base64url');
      pending.set(state, { nonce, verifier, redirectUri, next, expires: at + STATE_TTL_MS });
      const url = new URL(found.discovery.authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      return { url: url.toString(), state };
    },

    async finish(config, code, state, cookieState) {
      const entry = state ? pending.get(state) : undefined;
      if (state) pending.delete(state);
      if (!entry || !code || state !== cookieState || entry.expires <= now()) return { ok: false, reason: 'oidc-state-invalid' };
      const found = await discover(config.issuer);
      if (!found.ok) return { ok: false, reason: 'oidc-provider-error' };
      const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: entry.redirectUri, client_id: config.clientId, code_verifier: entry.verifier });
      if (config.clientSecret) form.set('client_secret', config.clientSecret);
      let answer: Record<string, unknown> | undefined;
      try {
        const res = await fetch(found.discovery.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
        answer = res.ok ? record(await res.json()) : undefined;
      } catch {
        answer = undefined;
      }
      if (!answer || typeof answer.id_token !== 'string') return { ok: false, reason: 'oidc-provider-error' };
      const claims = await verifyIdToken(answer.id_token, { issuer: config.issuer, clientId: config.clientId, nonce: entry.nonce, jwksUri: found.discovery.jwks_uri, nowMs: now() });
      if (!claims) return { ok: false, reason: 'oidc-token-invalid' };
      return allows(claims, config.allowedUser) ? { ok: true, next: entry.next } : { ok: false, reason: 'oidc-user-not-allowed' };
    },
  };
}
