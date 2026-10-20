// OIDC over HTTP (M5 #15): configuring and testing the provider (T2) and the two public routes of a sign-in: the way out to the provider and the way back.
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AuthMethods } from '@caduceus/contracts/caduceus-api';
import { safeNext as safeNextPath } from '@caduceus/contracts/safe-next';
import type { AuditLog } from './audit-log.ts';
import { authClient, isDirectLocal, requireStepUp, setSessionCookie, type AuthEnv } from './auth-routes.ts';
import type { AuthMethodStore, OidcConfig } from './auth-methods.ts';
import { discover, isSecureUrl, type OidcSignIn } from './oidc.ts';
import type { OwnerAuth } from './owner-auth.ts';

const CALLBACK_PATH = '/_caduceus/api/auth/oidc/callback';
const BIND_COOKIE = 'caduceus_oidc';
const BIND_PATH = '/_caduceus/api/auth/oidc';
const BIND_MAX_AGE_S = 600;
const FIELD_MAX = 2048;

export interface OidcRouteDeps {
  auth: OwnerAuth;
  audit: AuditLog;
  methods: AuthMethodStore;
  signIn: OidcSignIn;
  /** The origins Caduceus answers at; a redirect address is only ever built on one of them. */
  origins: ReadonlySet<string>;
}

/** The origin the browser used to reach Caduceus: through Serve the forwarded host and protocol, else the request's own. */
function requestOrigin(c: Context): string {
  const own = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') ?? own.protocol.replace(':', '');
  return `${proto}://${c.req.header('x-forwarded-host') ?? own.host}`;
}

/** A path on this site; anything else (another site, a scheme-relative address) becomes the home page, so a sign-in cannot be made to land elsewhere. */
const safeNext = (next: string | undefined) => safeNextPath(next, 'https://caduceus.invalid');

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function mountOidcRoutes(app: Hono<AuthEnv>, deps: OidcRouteDeps): { state(c: Context): AuthMethods['oidc'] } {
  const { auth, audit, methods, signIn, origins } = deps;
  const stepUp = requireStepUp(auth);
  const redirectUriOf = (c: Context) => `${requestOrigin(c)}${CALLBACK_PATH}`;

  const refused = (c: Context, reason: string) => {
    audit.record({ actor: 'anonymous', action: 'session.sign-in-oidc-refused', target: 'owner', source: authClient(c).source });
    deleteCookie(c, BIND_COOKIE, { path: BIND_PATH });
    return c.redirect(`/sign-in?error=${reason}`, 302);
  };

  /** The settings a request names, over what is kept: a secret that is not sent stays as it was. `undefined` field names what is wrong. */
  const readConfig = async (c: Context): Promise<{ ok: true; enabled?: boolean; config: OidcConfig } | { ok: false; field: string }> => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const sent = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const kept = methods.oidc().config;
    const text = (name: keyof OidcConfig): string | undefined => (typeof sent[name] === 'string' && sent[name].length <= FIELD_MAX ? (sent[name] as string).trim() : undefined);
    const config: OidcConfig = {
      issuer: text('issuer') ?? kept?.issuer ?? '',
      clientId: text('clientId') ?? kept?.clientId ?? '',
      clientSecret: typeof sent.clientSecret === 'string' && sent.clientSecret.length <= FIELD_MAX ? sent.clientSecret : (kept?.clientSecret ?? ''),
      allowedUser: text('allowedUser') ?? kept?.allowedUser ?? '',
    };
    if (sent.enabled !== undefined && typeof sent.enabled !== 'boolean') return { ok: false, field: 'enabled' };
    if (!isSecureUrl(config.issuer)) return { ok: false, field: 'issuer' };
    if (config.clientId === '') return { ok: false, field: 'clientId' };
    if (config.allowedUser === '') return { ok: false, field: 'allowedUser' };
    return { ok: true, enabled: sent.enabled as boolean | undefined, config };
  };

  const stateOf = (c: Context): AuthMethods['oidc'] => {
    const { enabled, config } = methods.oidc();
    return {
      enabled,
      issuer: config?.issuer ?? null,
      clientId: config?.clientId ?? null,
      hasSecret: (config?.clientSecret ?? '') !== '',
      allowedUser: config?.allowedUser ?? null,
      redirectUri: redirectUriOf(c),
    };
  };

  app.put('/_caduceus/api/auth/methods/oidc', stepUp, async (c) => {
    const read = await readConfig(c);
    if (!read.ok) return c.json({ error: 'bad-request', field: read.field }, 400);
    const { config } = read;
    const enabled = read.enabled ?? methods.oidc().enabled;
    // Whatever is on has been tested as it stands: turning it on, or changing what is on, asks the provider first.
    if (enabled) {
      const found = await discover(config.issuer);
      if (!found.ok) return c.json({ error: 'oidc-test-failed', message: found.reason }, 409);
    }
    methods.setOidc(enabled, config);
    audit.record({ actor: 'owner', action: 'auth.method-oidc-set', target: `oidc:${config.issuer}`, source: authClient(c).source, tier: 'T2' });
    return c.json(stateOf(c));
  });

  app.post('/_caduceus/api/auth/methods/oidc/test', stepUp, async (c) => {
    const read = await readConfig(c);
    if (!read.ok) return c.json({ error: 'bad-request', field: read.field }, 400);
    const found = await discover(read.config.issuer);
    if (!found.ok) return c.json({ error: 'oidc-test-failed', message: found.reason }, 409);
    return c.json({ ok: true, issuer: read.config.issuer });
  });

  app.get('/_caduceus/api/auth/oidc/start', async (c) => {
    const { enabled, config } = methods.oidc();
    if (!enabled || !config) return c.redirect('/sign-in?error=oidc-disabled', 302);
    const redirectUri = redirectUriOf(c);
    if (!origins.has(requestOrigin(c))) return c.redirect('/sign-in?error=oidc-origin', 302);
    const begun = await signIn.begin(config, redirectUri, safeNext(c.req.query('next')));
    if (!begun) return c.redirect('/sign-in?error=oidc-provider-error', 302);
    // Lax: the way back is a navigation from the provider's site, which a Strict cookie would not travel on.
    setCookie(c, BIND_COOKIE, begun.state, { httpOnly: true, sameSite: 'Lax', path: BIND_PATH, secure: !isDirectLocal(c), maxAge: BIND_MAX_AGE_S });
    return c.redirect(begun.url, 302);
  });

  app.get(CALLBACK_PATH, async (c) => {
    const { enabled, config } = methods.oidc();
    if (!enabled || !config) return c.redirect('/sign-in?error=oidc-disabled', 302);
    const result = await signIn.finish(config, c.req.query('code'), c.req.query('state'), getCookie(c, BIND_COOKIE));
    if (!result.ok) return refused(c, result.reason);
    deleteCookie(c, BIND_COOKIE, { path: BIND_PATH });
    setSessionCookie(c, auth.signInWith('session.sign-in-oidc', authClient(c)).token);
    // Not a redirect: the session cookie is SameSite=Strict, and a redirect that began at the provider would reach the page without it. A page that moves on itself does not.
    return c.html(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapeHtml(result.next)}"><title>Signing in</title><p>Signed in. <a href="${escapeHtml(result.next)}">Continue</a></p>`);
  });

  return { state: stateOf };
}
