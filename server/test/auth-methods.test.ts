import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditEntry, AuthMethods, AuthState } from '@caduceus/contracts/caduceus-api';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { launchFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { startStubOidc, type StubOidc } from './fixtures/stub-oidc.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The extra sign-in methods (M5 #15) at the Caduceus HTTP seam, in front of the fake Hermes (nothing here is about Hermes): Tailscale identity sign-in, reached the way
// Tailscale Serve reaches Caduceus, and OIDC against a local stub identity provider.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
let root: string | undefined;
let idp: StubOidc | undefined;
afterEach(async () => {
  await idp?.close();
  idp = undefined;
  await server?.close();
  await backend?.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  server = backend = root = undefined;
});

const HOST = 'mac.tail1234.ts.net';
const SERVE_ORIGIN = `https://${HOST}:9443`;
const OWNER_LOGIN = 'owner@example.com';
const OTHER_LOGIN = 'guest@example.com';
const VIA_SERVE = { 'x-forwarded-host': `${HOST}:9443`, 'x-forwarded-for': '100.101.102.103', 'x-forwarded-proto': 'https' };
/** A request as Serve forwards it for a tailnet user. */
const asTailnetUser = (login: string, headers: Record<string, string> = {}) => ({ ...VIA_SERVE, 'tailscale-user-login': login, origin: SERVE_ORIGIN, ...headers });

async function start(options: Partial<CaduceusServerOptions> = {}) {
  backend = launchFakeHermes();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  server = await startCaduceusServer({ backend, hermesRoot: root, publicOrigin: SERVE_ORIGIN, tailnetOwners: [OWNER_LOGIN, OTHER_LOGIN], ...options });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  await stepUp(url, cookie, authenticator);
  /** A request of the owner's own session (this Mac, or, with `headers`, through Serve). */
  const call = async (method: string, route: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
  };
  /** A request nobody has signed in for. */
  const anonymous = async (method: string, route: string, headers: Record<string, string> = {}, body?: unknown) => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: text.startsWith('{') ? JSON.parse(text) : text };
  };
  const audit = async () => ((await call('GET', '/_caduceus/api/audit')).body.entries as AuditEntry[]);
  return { url, cookie, authenticator, call, anonymous, audit };
}

const TAILSCALE = '/_caduceus/api/auth/methods/tailscale';
const TAILSCALE_SIGN_IN = '/_caduceus/api/auth/tailscale-sign-in';
const cookieOf = (headers: Headers) => headers.get('set-cookie')!.split(';')[0];

describe('Tailscale identity sign-in', () => {
  test('is off until the owner enables it: signing in is refused, and the sign-in page is not offered it', async () => {
    const { anonymous, call } = await start();

    const signIn = await anonymous('POST', TAILSCALE_SIGN_IN, asTailnetUser(OWNER_LOGIN));
    const state = (await anonymous('GET', '/_caduceus/api/auth/session', asTailnetUser(OWNER_LOGIN))).body as AuthState;
    const methods = (await call('GET', '/_caduceus/api/auth/methods')).body as AuthMethods;

    expect(signIn.status).toBe(403);
    expect(signIn.body).toEqual({ error: 'method-disabled' });
    expect(state.tailscaleSignIn).toBeUndefined();
    expect(methods.tailscale).toEqual({ enabled: false, login: null });
  });

  test('is enabled (T2: a passkey, and audited) only from a request that itself carries that identity through Serve: the way it is tested', async () => {
    const { call, audit } = await start();

    const fromThisMac = await call('PUT', TAILSCALE, { enabled: true, login: OWNER_LOGIN });
    const asSomeoneElse = await call('PUT', TAILSCALE, { enabled: true, login: OWNER_LOGIN }, asTailnetUser(OTHER_LOGIN));
    const wrongLogin = await call('PUT', TAILSCALE, { enabled: true, login: 'nobody@example.com' }, asTailnetUser(OWNER_LOGIN));
    const enabled = await call('PUT', TAILSCALE, { enabled: true, login: 'Owner@Example.COM' }, asTailnetUser(OWNER_LOGIN));
    const methods = (await call('GET', '/_caduceus/api/auth/methods')).body as AuthMethods;

    expect(fromThisMac.status).toBe(409);
    expect(fromThisMac.body).toMatchObject({ error: 'identity-not-seen' });
    expect(asSomeoneElse.status).toBe(409);
    expect(wrongLogin.status).toBe(409);
    expect(enabled.status).toBe(200);
    expect(methods.tailscale).toEqual({ enabled: true, login: OWNER_LOGIN });
    expect(await audit()).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'auth.method-tailscale-set', tier: 'T2', source: `tailnet:${OWNER_LOGIN}`, target: `tailscale:${OWNER_LOGIN}` }));
  });

  test('signs the configured login in through Serve (audited, Secure cookie), and the sign-in page is offered it only to that login', async () => {
    const { call, anonymous, audit } = await start();
    await call('PUT', TAILSCALE, { enabled: true, login: OWNER_LOGIN }, asTailnetUser(OWNER_LOGIN));

    const offered = (await anonymous('GET', '/_caduceus/api/auth/session', asTailnetUser(OWNER_LOGIN))).body as AuthState;
    const notOffered = (await anonymous('GET', '/_caduceus/api/auth/session', asTailnetUser(OTHER_LOGIN))).body as AuthState;
    const signIn = await anonymous('POST', TAILSCALE_SIGN_IN, asTailnetUser(OWNER_LOGIN));
    const session = await anonymous('GET', '/_caduceus/api/auth/session', asTailnetUser(OWNER_LOGIN, { cookie: cookieOf(signIn.headers) }));

    expect(offered.tailscaleSignIn).toBe(true);
    expect(notOffered.tailscaleSignIn).toBeUndefined();
    expect(signIn.status).toBe(204);
    expect(signIn.headers.get('set-cookie')).toContain('Secure');
    expect((session.body as AuthState).signedIn).toBe(true);
    expect(await audit()).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'session.sign-in-tailscale', source: `tailnet:${OWNER_LOGIN}` }));
  });

  test('trusts the identity header only from the Serve hop and only for the configured login: another tailnet user, and a header sent without what Serve adds, get no session', async () => {
    const { call, anonymous, audit } = await start();
    await call('PUT', TAILSCALE, { enabled: true, login: OWNER_LOGIN }, asTailnetUser(OWNER_LOGIN));

    const otherUser = await anonymous('POST', TAILSCALE_SIGN_IN, asTailnetUser(OTHER_LOGIN));
    // From this Mac, naming the owner's login without the forwarding headers Serve always sets: anyone on the Mac could write that.
    const spoofedHeaderOnly = await anonymous('POST', TAILSCALE_SIGN_IN, { 'tailscale-user-login': OWNER_LOGIN });
    const missingForwardedFor = await anonymous('POST', TAILSCALE_SIGN_IN, { 'tailscale-user-login': OWNER_LOGIN, 'x-forwarded-host': `${HOST}:9443`, 'x-forwarded-proto': 'https', origin: SERVE_ORIGIN });
    const noIdentity = await anonymous('POST', TAILSCALE_SIGN_IN, VIA_SERVE);

    for (const answer of [otherUser, spoofedHeaderOnly, missingForwardedFor, noIdentity]) {
      expect(answer.status).toBe(403);
      expect(answer.headers.get('set-cookie')).toBeNull();
    }
    expect((await audit()).filter((entry) => entry.action === 'session.sign-in-tailscale-refused').length).toBeGreaterThanOrEqual(3);
  });

  test('is turned off by the owner (T2, audited) and then refuses again', async () => {
    const { call, anonymous } = await start();
    await call('PUT', TAILSCALE, { enabled: true, login: OWNER_LOGIN }, asTailnetUser(OWNER_LOGIN));

    const off = await call('PUT', TAILSCALE, { enabled: false }, asTailnetUser(OWNER_LOGIN));
    const signIn = await anonymous('POST', TAILSCALE_SIGN_IN, asTailnetUser(OWNER_LOGIN));

    expect(off.status).toBe(200);
    expect(signIn.status).toBe(403);
  });
});

const OIDC = '/_caduceus/api/auth/methods/oidc';
const CALLBACK = '/_caduceus/api/auth/oidc/callback';

/** The owner configures and enables OIDC against the stub provider, as the form does. */
async function withOidc(overrides: Record<string, unknown> = {}) {
  idp = await startStubOidc();
  const owner = await start();
  const config = { enabled: true, issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, allowedUser: 'owner@example.com', ...overrides };
  const configured = await owner.call('PUT', OIDC, config);
  /** What the browser does: start at Caduceus, follow to the provider, come back to Caduceus with the code. */
  const signIn = async (next?: string) => {
    const start = await owner.anonymous('GET', `/_caduceus/api/auth/oidc/start${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    const bound = start.headers.get('set-cookie')?.split(';')[0];
    if (start.status !== 302 || !bound) return { start, callback: undefined };
    const authorize = await fetch(start.headers.get('location')!, { redirect: 'manual' });
    const callback = await owner.anonymous('GET', new URL(authorize.headers.get('location')!).pathname + new URL(authorize.headers.get('location')!).search, { cookie: bound });
    return { start, callback, bound, callbackPath: new URL(authorize.headers.get('location')!).pathname + new URL(authorize.headers.get('location')!).search };
  };
  return { ...owner, configured, signIn, config };
}

describe('OIDC sign-in', () => {
  test('is enabled (T2, audited) only once the provider answers as the issuer it was configured for, and its secret is never read back', async () => {
    idp = await startStubOidc();
    const { call, audit } = await start();
    const config = { enabled: true, issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, allowedUser: 'owner@example.com' };

    idp.discoveryIssuer = 'https://impostor.example.com';
    const wrongIssuer = await call('PUT', OIDC, config);
    idp.discoveryIssuer = undefined;
    const unreachable = await call('PUT', OIDC, { ...config, issuer: 'http://127.0.0.1:1' });
    const insecure = await call('PUT', OIDC, { ...config, issuer: 'http://idp.example.com' });
    const enabled = await call('PUT', OIDC, config);
    const methods = (await call('GET', '/_caduceus/api/auth/methods')).body as AuthMethods;

    expect(wrongIssuer.status).toBe(409);
    expect(wrongIssuer.body).toMatchObject({ error: 'oidc-test-failed' });
    expect(unreachable.status).toBe(409);
    expect(insecure.status).toBe(400);
    expect(enabled.status).toBe(200);
    expect(methods.oidc).toMatchObject({ enabled: true, issuer: idp.issuer, clientId: idp.clientId, hasSecret: true, allowedUser: 'owner@example.com' });
    expect(JSON.stringify(methods)).not.toContain(idp.clientSecret);
    expect(JSON.stringify(enabled.body)).not.toContain(idp.clientSecret);
    expect(await audit()).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'auth.method-oidc-set', tier: 'T2', target: `oidc:${idp.issuer}` }));
  });

  test('needs a passkey confirmation (T2) to be configured or tested', async () => {
    idp = await startStubOidc();
    const { url } = await start();
    const withoutStepUp = await ownerCookie(url);

    const send = (route: string) => fetch(`${url}${route}`, { method: route.endsWith('test') ? 'POST' : 'PUT', headers: { origin: url, cookie: withoutStepUp, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, issuer: idp!.issuer, clientId: 'x', allowedUser: 'a@b.c' }) });

    for (const route of [OIDC, `${OIDC}/test`]) {
      const answer = await send(route);
      expect([answer.status, (await answer.json()).error]).toEqual([403, 'step-up-required']);
    }
  });

  test('works end to end: Caduceus sends the browser to the provider with PKCE, takes the code back, and opens a session for the allowed user (audited)', async () => {
    const { signIn, anonymous, audit } = await withOidc();

    const { start, callback } = await signIn('/system/maintenance');
    const cookie = callback!.headers.getSetCookie().find((line) => line.startsWith('caduceus_session='))!.split(';')[0];
    const session = await anonymous('GET', '/_caduceus/api/auth/session', { cookie });

    const authorizeUrl = new URL(start.headers.get('location')!);
    expect(authorizeUrl.origin).toBe(idp!.issuer);
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('scope')).toContain('openid');
    expect(idp!.tokenRequests[0]).toMatchObject({ grant_type: 'authorization_code', code_verifier: expect.stringMatching(/^[\w-]{43,}$/) });
    expect(callback!.status).toBe(200);
    // A page that moves on by itself: a redirect from the provider's site would not carry the session cookie (SameSite=Strict).
    expect(callback!.text).toContain('url=/system/maintenance');
    expect((session.body as AuthState).signedIn).toBe(true);
    expect(await audit()).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'session.sign-in-oidc' }));
  });

  test('also lets in the provider’s subject when that is the identity configured', async () => {
    const subject = await withOidc({ allowedUser: 'user-1' });

    expect((await subject.signIn()).callback!.status).toBe(200);
  });

  test('lets an email in only when the provider says it is verified', async () => {
    const unverified = await withOidc();
    idp!.identity.email_verified = false;

    const answer = await unverified.signIn();

    expect(answer.callback!.status).toBe(302);
    expect(answer.callback!.headers.get('location')).toBe('/sign-in?error=oidc-user-not-allowed');
  });

  test.each([
    ['a different issuer in the token', { iss: 'https://impostor.example.com' }, undefined, 'oidc-token-invalid'],
    ['a different audience', { aud: 'someone-elses-client' }, undefined, 'oidc-token-invalid'],
    ['an expired token', { exp: 1 }, undefined, 'oidc-token-invalid'],
    ['a different nonce', { nonce: 'not-the-one-sent' }, undefined, 'oidc-token-invalid'],
    ['a different user', undefined, { sub: 'user-2', email: 'someone.else@example.com', email_verified: true }, 'oidc-user-not-allowed'],
  ] as const)('refuses %s, with no session and an audit entry', async (_name, claims, identity, error) => {
    const { signIn, audit } = await withOidc();
    if (claims) idp!.claims = { ...claims };
    if (identity) idp!.identity = { ...identity };

    const { callback } = await signIn();

    expect(callback!.status).toBe(302);
    expect(callback!.headers.get('location')).toBe(`/sign-in?error=${error}`);
    expect(callback!.headers.get('set-cookie') ?? '').not.toContain('caduceus_session');
    expect(await audit()).toContainEqual(expect.objectContaining({ actor: 'anonymous', action: 'session.sign-in-oidc-refused' }));
  });

  test('refuses a token signed with a key the provider does not publish, a callback that was not started here, and a callback used twice', async () => {
    const { signIn, anonymous } = await withOidc();
    idp!.signWithUnpublishedKey = true;
    const forged = await signIn();
    idp!.signWithUnpublishedKey = false;
    const good = await signIn();
    const replay = await anonymous('GET', good.callbackPath!, { cookie: good.bound! });
    const noCookie = await anonymous('GET', `${CALLBACK}?code=abc&state=nothing`);

    expect(forged.callback!.headers.get('location')).toBe('/sign-in?error=oidc-token-invalid');
    expect(good.callback!.status).toBe(200);
    expect(replay.headers.get('location')).toBe('/sign-in?error=oidc-state-invalid');
    expect(noCookie.headers.get('location')).toBe('/sign-in?error=oidc-state-invalid');
  });

  test('is refused while it is off', async () => {
    const { signIn, call } = await withOidc();
    await call('PUT', OIDC, { enabled: false });

    const { start } = await signIn();

    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toBe('/sign-in?error=oidc-disabled');
  });

  test('cannot take away the last way in: the password stays removable only while a passkey remains, whatever else is on', async () => {
    const { call, authenticator } = await withOidc();
    expect(authenticator).toBeDefined();

    const removePassword = await call('DELETE', '/_caduceus/api/auth/password');
    const passkeys = (await call('GET', '/_caduceus/api/auth/passkeys')).body.passkeys as { id: string }[];
    const removeLastPasskey = await call('DELETE', `/_caduceus/api/auth/passkeys/${passkeys[0].id}`);

    // The owner has a password and one passkey: removing the password is allowed, and then the passkey is the last and stays, with OIDC on.
    expect(removePassword.status).toBe(204);
    expect(removeLastPasskey.status).toBe(409);
  });
});
