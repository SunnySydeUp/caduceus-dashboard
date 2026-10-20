// Owner sign-in over HTTP: the gate in front of every page, the Caduceus API and the Hermes proxy, plus the auth routes.
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AuthState, StepUpRequired } from '@caduceus/contracts/caduceus-api';
import type { AuditLog } from './audit-log.ts';
import { SESSION_MAX_AGE_MS, type AuthClient, type OwnerAuth, type OwnerSession } from './owner-auth.ts';
import { MCP_TOOL_ROUTE } from './mcp-tools.ts';
import { isPublicSharePath } from '@caduceus/contracts/share-links';
import { isPublicWebAsset } from './web-app.ts';

export const SESSION_COOKIE = 'caduceus_session';

/** What the gate tells the routes behind it: the session of the request, `undefined` only on public paths. */
export interface AuthEnv {
  Variables: { session: OwnerSession | undefined };
}

/** Headers a forwarding proxy adds. Tailscale Serve sets X-Forwarded-Host/-For/-Proto and, for tailnet users, Tailscale-User-Login. */
const FORWARDING_HEADERS = ['tailscale-user-login', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded'];

/** Reads one request header by lower-case name; both Hono's request and Node's `IncomingMessage` can be adapted to it. */
export type HeaderReader = (name: string) => string | undefined;

/**
 * A request from this Mac itself: its peer is loopback and it did not come through a forwarding proxy.
 * The peer address alone is not enough, because Tailscale Serve also connects from loopback.
 */
export function isDirectLocalPeer(remoteAddress: string, header: HeaderReader): boolean {
  const loopback = remoteAddress === '::1' || /^(::ffff:)?127\./.test(remoteAddress);
  return loopback && FORWARDING_HEADERS.every((name) => header(name) === undefined);
}

export function isDirectLocal(c: Context): boolean {
  return isDirectLocalPeer(getConnInfo(c).remote.address ?? '', (name) => c.req.header(name));
}

/**
 * Paths anyone may load: the sign-in screen and the auth routes it calls, and the liveness probe, which a supervisor calls with
 * no session and which says nothing but "up". The web app's own files (`isPublicWebAsset`) are public too, and so is a share link's page and its snapshot
 * (`isPublicSharePath`, M7 #06): the one thing a visitor with no session may open, and only with a token that is open.
 */
const PUBLIC_PATHS: Record<string, true> = {
  '/sign-in': true,
  '/_caduceus/healthz': true,
  '/_caduceus/api/auth/session': true,
  '/_caduceus/api/auth/setup': true,
  '/_caduceus/api/auth/sign-in': true,
  '/_caduceus/api/auth/sign-out': true,
  '/_caduceus/api/auth/passkey-sign-in/options': true,
  '/_caduceus/api/auth/passkey-sign-in': true,
  '/_caduceus/api/auth/tailscale-sign-in': true,
  '/_caduceus/api/auth/oidc/start': true,
  '/_caduceus/api/auth/oidc/callback': true,
};

/** Hands the browser its session cookie. Only a request from this Mac over plain http gets one without `Secure`. */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    secure: !isDirectLocal(c),
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

/** Where a request came from, as the audit log names it (see `AuditEntry.source`). */
export function requestSource(remoteAddress: string, header: HeaderReader): string {
  const login = header('tailscale-user-login');
  const forwardedFor = header('x-forwarded-for');
  return login ? `tailnet:${login}` : forwardedFor ? `forwarded:${forwardedFor}` : isDirectLocalPeer(remoteAddress, header) ? 'local' : 'forwarded';
}

/** The requester as the session record and the audit log describe it. */
export function authClient(c: Context): AuthClient {
  return { userAgent: c.req.header('user-agent') ?? '', source: requestSource(getConnInfo(c).remote.address ?? '', (name) => c.req.header(name)) };
}

/** Owner password length: at least 12 characters (passkeys, M0 #04, make it a fallback); the cap bounds the KDF's input. */
const PASSWORD_LENGTH = { min: 12, max: 1024 } as const;

/** The `password` of a JSON body, or `undefined` when the body is malformed or the password absurdly long. */
async function readPassword(c: Context): Promise<string | undefined> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const password = typeof body === 'object' && body !== null && 'password' in body ? body.password : undefined;
  return typeof password === 'string' && password.length <= PASSWORD_LENGTH.max ? password : undefined;
}

/**
 * The step-up requirement: a route behind it answers `403 {"error":"step-up-required"}` unless the request's session
 * holds a live step-up grant (a passkey assertion in the last 5 minutes). The policy proxy's T2/T3 tiers (M0 #08)
 * build on it.
 */
export function requireStepUp(auth: OwnerAuth): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const session = c.get('session');
    if (!session || !auth.hasStepUp(session.id)) return c.json({ error: 'step-up-required' } satisfies StepUpRequired, 403);
    await next();
  };
}

/**
 * Installs the gate and the auth routes. `origins` are the exact origins the browser may send unsafe requests
 * (and, from M0 #09, WebSocket upgrades) from: Caduceus's own loopback URLs and the Tailscale Serve URL.
 */
export function mountOwnerAuth(app: Hono<AuthEnv>, auth: OwnerAuth, audit: AuditLog, origins: ReadonlySet<string>, extras?: (c: Context) => Partial<AuthState>): void {
  app.use('*', async (c, next) => {
    // The MCP tool route is called by a program, not a browser: it has no cookie and no Origin, and the route itself checks the scoped token.
    if (c.req.method === 'POST' && new URL(c.req.url).pathname.startsWith(`${MCP_TOOL_ROUTE}/`)) return next();
    // Cross-site request forgery: browsers always send Origin on these, and a page elsewhere cannot fake it.
    const safe = c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS';
    if (!safe && !origins.has(c.req.header('origin') ?? '')) return c.json({ error: 'origin-mismatch' }, 403);
    const url = new URL(c.req.url);
    const session = auth.session(getCookie(c, SESSION_COOKIE));
    c.set('session', session);
    if (session || PUBLIC_PATHS[url.pathname] === true || isPublicWebAsset(url.pathname) || isPublicSharePath(url.pathname)) return next();
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_caduceus/')) {
      return c.json({ error: 'signed-out' }, 401);
    }
    return c.redirect(`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  });

  app.get('/_caduceus/api/auth/session', (c) => {
    const ownerExists = auth.ownerExists();
    return c.json({
      ownerExists,
      setupAllowed: !ownerExists && isDirectLocal(c),
      signedIn: c.get('session') !== undefined,
      passwordSignIn: auth.hasPassword(),
      ...extras?.(c),
    } satisfies AuthState);
  });

  app.post('/_caduceus/api/auth/setup', async (c) => {
    if (!isDirectLocal(c)) {
      audit.record({ actor: 'anonymous', action: 'owner.set-up-refused', target: 'owner', source: authClient(c).source });
      return c.json({ error: 'setup-not-local' }, 403);
    }
    const password = await readPassword(c);
    if (password === undefined) return c.json({ error: 'bad-request' }, 400);
    if (password.length < PASSWORD_LENGTH.min) return c.json({ error: 'password-too-short', minLength: PASSWORD_LENGTH.min }, 400);
    const opened = await auth.setUp(password, authClient(c));
    if (!opened) return c.json({ error: 'owner-exists' }, 409);
    setSessionCookie(c, opened.token);
    return c.body(null, 201);
  });

  app.post('/_caduceus/api/auth/sign-in', async (c) => {
    const password = await readPassword(c);
    if (password === undefined) return c.json({ error: 'bad-request' }, 400);
    const result = await auth.signIn(password, authClient(c));
    if (!result.ok && result.reason === 'throttled') {
      const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
      c.header('retry-after', String(retryAfterSeconds));
      return c.json({ error: 'throttled', retryAfterSeconds }, 429);
    }
    if (!result.ok) return c.json({ error: result.reason }, 401);
    setSessionCookie(c, result.token);
    return c.body(null, 204);
  });

  app.post('/_caduceus/api/auth/sign-out', (c) => {
    auth.signOut(getCookie(c, SESSION_COOKIE), authClient(c));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.body(null, 204);
  });

  app.put('/_caduceus/api/auth/password', requireStepUp(auth), async (c) => {
    const password = await readPassword(c);
    if (password === undefined) return c.json({ error: 'bad-request' }, 400);
    if (password.length < PASSWORD_LENGTH.min) return c.json({ error: 'password-too-short', minLength: PASSWORD_LENGTH.min }, 400);
    await auth.setPassword(password, authClient(c));
    return c.body(null, 204);
  });

  app.delete('/_caduceus/api/auth/password', requireStepUp(auth), (c) => {
    const result = auth.removePassword(authClient(c));
    if (result === 'not-found') return c.json({ error: result }, 404);
    if (result === 'last-sign-in-method') return c.json({ error: result }, 409);
    return c.body(null, 204);
  });

  app.get('/_caduceus/api/auth/sessions', (c) => c.json({ sessions: auth.sessions(c.get('session')!.id) }));

  app.delete('/_caduceus/api/auth/sessions/:id', (c) => {
    if (!auth.revoke(c.req.param('id'), authClient(c))) return c.json({ error: 'not-found' }, 404);
    return c.body(null, 204);
  });

  app.get('/_caduceus/api/audit', (c) => c.json({ entries: audit.list(500) }));
}
