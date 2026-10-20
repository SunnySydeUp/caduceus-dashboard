import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie, TEST_OWNER_PASSWORD } from './fixtures/owner.ts';
import type { AuditEntry, AuthState, Passkey, SessionInfo } from '@caduceus/contracts/caduceus-api';
import {
  createSoftwareAuthenticator,
  type CreationOptions,
  type RequestOptions,
  type SoftwareAuthenticator,
} from './fixtures/software-authenticator.ts';

// Passkeys, the device list and step-up, through the Caduceus server's HTTP API, in front of the real Hermes
// (in a throwaway HERMES_HOME that also holds the Caduceus store). The browser's authenticator is played by a
// software authenticator: the system boundary, not Caduceus code.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  // Every test starts before the owner exists.
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

const START = Date.parse('2026-10-07T09:00:00.000Z');

interface Answer<T> {
  status: number;
  /** The JSON body (or the text of a non-JSON one). */
  body: T;
  setCookie: string | null;
}

interface Started {
  url: string;
  /** The origin a browser on this Mac uses for passkeys: `localhost`, since an RP ID cannot be an IP address. */
  origin: string;
  clock: { now: number };
  /** Calls the Caduceus API the way the web app at `origin` does; `T` is the body the test expects. */
  call<T = unknown>(method: string, route: string, init?: { cookie?: string; body?: unknown; headers?: Record<string, string> }): Promise<Answer<T>>;
}

/** A Caduceus server on a controllable clock. */
async function start(options: Partial<CaduceusServerOptions> = {}): Promise<Started> {
  const clock = { now: START };
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, now: () => clock.now, ...options });
  const { url } = server;
  const origin = `http://localhost:${new URL(url).port}`;
  const call: Started['call'] = async (method, route, { cookie, body, headers } = {}) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = res.headers.get('content-type')?.startsWith('application/json');
    // Unchecked: the assertions that follow are what check the body.
    const answer = (json ? await res.json() : await res.text()) as never;
    return { status: res.status, body: answer, setCookie: res.headers.get('set-cookie') };
  };
  return { url, origin, clock, call };
}

/** Confirms with one of the owner's passkeys, giving the session of `cookie` a step-up grant. */
async function stepUpWith({ origin, call }: Started, cookie: string, authenticator: SoftwareAuthenticator) {
  const options = await call<RequestOptions>('POST', '/_caduceus/api/auth/step-up/options', { cookie });
  return call('POST', '/_caduceus/api/auth/step-up', { cookie, body: { response: authenticator.assert(options.body, origin) } });
}

/**
 * Registers a passkey on `authenticator` the way Settings › Security does. Once the owner has a passkey, adding another
 * needs a step-up, which `confirmingWith` (a passkey they already have) gives first.
 */
async function registerPasskey(started: Started, cookie: string, authenticator: SoftwareAuthenticator, name: string, confirmingWith?: SoftwareAuthenticator) {
  const { origin, call } = started;
  if (confirmingWith) await stepUpWith(started, cookie, confirmingWith);
  const options = await call<CreationOptions>('POST', '/_caduceus/api/auth/passkeys/registration-options', { cookie });
  expect(options.status).toBe(200);
  return call<Passkey>('POST', '/_caduceus/api/auth/passkeys', { cookie, body: { name, response: authenticator.register(options.body, origin) } });
}

describe('passkeys', () => {
  test('a signed-in owner registers a discoverable, user-verified passkey and sees it listed', async () => {
    const started = await start();
    const { call } = started;
    const cookie = await ownerCookie(started.url);
    const authenticator = createSoftwareAuthenticator();

    const options = await call<CreationOptions>('POST', '/_caduceus/api/auth/passkeys/registration-options', { cookie });
    const registered = await call('POST', '/_caduceus/api/auth/passkeys', {
      cookie,
      body: { name: 'MacBook', response: authenticator.register(options.body, started.origin) },
    });
    const list = await call('GET', '/_caduceus/api/auth/passkeys', { cookie });
    await stepUpWith(started, cookie, authenticator);
    const again = await call<CreationOptions>('POST', '/_caduceus/api/auth/passkeys/registration-options', { cookie });
    const signedOut = await call('POST', '/_caduceus/api/auth/passkeys/registration-options');

    expect(options.status).toBe(200);
    expect(options.body).toMatchObject({
      rp: { id: 'localhost', name: 'Caduceus' },
      user: { name: 'owner' },
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: [],
    });
    const passkey = { id: authenticator.credentialIds[0], name: 'MacBook', createdAt: '2026-10-07T09:00:00.000Z', lastUsedAt: null };
    expect(registered).toMatchObject({ status: 201, body: passkey });
    expect(list).toMatchObject({ status: 200, body: { passkeys: [passkey] } });
    // The browser will not make a second passkey for this owner on the same authenticator.
    expect(again.body.excludeCredentials).toEqual([{ id: authenticator.credentialIds[0], type: 'public-key', transports: ['internal', 'hybrid'] }]);
    expect(again.body.user.id).toBe(options.body.user.id);
    expect(signedOut.status).toBe(401);
  });

  test('the owner renames a passkey (names are 1 to 64 characters) without a step-up, and deletes it behind one', async () => {
    const started = await start();
    const { call } = started;
    const cookie = await ownerCookie(started.url);
    const authenticator = createSoftwareAuthenticator();
    const { id } = (await registerPasskey(started, cookie, authenticator, 'Passkey')).body;
    const rename = (passkeyId: string, name: unknown) => call('PATCH', `/_caduceus/api/auth/passkeys/${passkeyId}`, { cookie, body: { name } });

    const renamed = await rename(id, '  iPhone 17  ');
    const refused = [await rename(id, ''), await rename(id, '   '), await rename(id, 'x'.repeat(65)), await rename(id, 42)];
    const longest = await rename(id, 'y'.repeat(64));
    const unknown = await rename('bm8tc3VjaC1wYXNza2V5', 'Other');
    const list = await call<{ passkeys: Passkey[] }>('GET', '/_caduceus/api/auth/passkeys', { cookie });
    const deletedWithoutStepUp = await call('DELETE', `/_caduceus/api/auth/passkeys/${id}`, { cookie });
    await stepUpWith(started, cookie, authenticator);
    const deleted = await call('DELETE', `/_caduceus/api/auth/passkeys/${id}`, { cookie });
    const deletedAgain = await call('DELETE', `/_caduceus/api/auth/passkeys/${id}`, { cookie });
    const afterDelete = await call<{ passkeys: Passkey[] }>('GET', '/_caduceus/api/auth/passkeys', { cookie });

    expect(renamed).toMatchObject({ status: 200, body: { id, name: 'iPhone 17' } });
    expect(refused.map((r) => `${r.status} ${JSON.stringify(r.body)}`)).toEqual(Array(4).fill('400 {"error":"bad-request"}'));
    expect(longest.status).toBe(200);
    expect(unknown).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect(list.body.passkeys.map((p) => p.name)).toEqual(['y'.repeat(64)]);
    expect(deletedWithoutStepUp).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
    expect(deleted.status).toBe(204);
    expect(deletedAgain).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect(afterDelete.body.passkeys).toEqual([]);
  });

  test('the owner may go passkey-only and back, but the last remaining sign-in method cannot be deleted', async () => {
    const started = await start();
    const { call, origin } = started;
    const cookie = await ownerCookie(started.url);
    const authenticator = createSoftwareAuthenticator();
    const { id } = (await registerPasskey(started, cookie, authenticator, 'Phone')).body;
    const NEW_PASSWORD = 'a different passphrase';
    const passwordSignIn = async (password: string) => (await call('POST', '/_caduceus/api/auth/sign-in', { body: { password } })).body;
    const state = async () => (await call<AuthState>('GET', '/_caduceus/api/auth/session')).body.passwordSignIn;

    const removeUnconfirmed = await call('DELETE', '/_caduceus/api/auth/password', { cookie });
    const setUnconfirmed = await call('PUT', '/_caduceus/api/auth/password', { cookie, body: { password: NEW_PASSWORD } });
    const options = await call<RequestOptions>('POST', '/_caduceus/api/auth/step-up/options', { cookie });
    await call('POST', '/_caduceus/api/auth/step-up', { cookie, body: { response: authenticator.assert(options.body, origin) } });
    const withPassword = await state();
    const removePassword = await call('DELETE', '/_caduceus/api/auth/password', { cookie });
    const passkeyOnly = { state: await state(), signIn: await passwordSignIn(TEST_OWNER_PASSWORD) };
    const removeAgain = await call('DELETE', '/_caduceus/api/auth/password', { cookie });
    const deleteLastPasskey = await call('DELETE', `/_caduceus/api/auth/passkeys/${id}`, { cookie });
    const tooShort = await call('PUT', '/_caduceus/api/auth/password', { cookie, body: { password: 'short' } });
    const setPassword = await call('PUT', '/_caduceus/api/auth/password', { cookie, body: { password: NEW_PASSWORD } });
    const passwordBack = { state: await state(), oldPassword: await passwordSignIn(TEST_OWNER_PASSWORD), newPassword: await passwordSignIn(NEW_PASSWORD) };
    const deletePasskey = await call('DELETE', `/_caduceus/api/auth/passkeys/${id}`, { cookie });
    const removeLastPassword = await call('DELETE', '/_caduceus/api/auth/password', { cookie });

    expect(removeUnconfirmed).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
    expect(setUnconfirmed).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
    expect(withPassword).toBe(true);
    expect(removePassword.status).toBe(204);
    expect(passkeyOnly).toEqual({ state: false, signIn: { error: 'no-password' } });
    expect(removeAgain).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect(deleteLastPasskey).toMatchObject({ status: 409, body: { error: 'last-sign-in-method' } });
    expect(tooShort).toMatchObject({ status: 400, body: { error: 'password-too-short', minLength: 12 } });
    expect(setPassword.status).toBe(204);
    expect(passwordBack).toEqual({ state: true, oldPassword: { error: 'wrong-password' }, newPassword: '' });
    expect(deletePasskey.status).toBe(204);
    expect(removeLastPassword).toMatchObject({ status: 409, body: { error: 'last-sign-in-method' } });
  });
});

describe('the tier of managing passkeys and sessions', () => {
  test('adding the first passkey is T1, adding another or deleting one is T2 (a passkey step-up), and revoking a session is T1', async () => {
    const started = await start();
    const { call, origin, clock } = started;
    const cookie = await ownerCookie(started.url);
    const phone = createSoftwareAuthenticator();
    const laptop = createSoftwareAuthenticator();
    const stepUp = async () => {
      const options = await call<RequestOptions>('POST', '/_caduceus/api/auth/step-up/options', { cookie });
      await call('POST', '/_caduceus/api/auth/step-up', { cookie, body: { response: phone.assert(options.body, origin) } });
    };

    // With no passkey yet there is nothing to step up with: the first is added on the password alone.
    const first = await registerPasskey(started, cookie, phone, 'Phone');
    const optionsWithout = await call('POST', '/_caduceus/api/auth/passkeys/registration-options', { cookie });
    const registerWithout = await call('POST', '/_caduceus/api/auth/passkeys', { cookie, body: { name: 'Laptop', response: {} } });
    const deleteWithout = await call('DELETE', `/_caduceus/api/auth/passkeys/${first.body.id}`, { cookie });
    const renameWithout = await call('PATCH', `/_caduceus/api/auth/passkeys/${first.body.id}`, { cookie, body: { name: 'iPhone' } });
    await stepUp();
    clock.now += 60_000;
    const second = await registerPasskey(started, cookie, laptop, 'Laptop');
    clock.now += 60_000;
    const deleteSecond = await call('DELETE', `/_caduceus/api/auth/passkeys/${second.body.id}`, { cookie });
    // A session is revoked on the password's authority: a lost phone must be cut off even if its passkey is gone too.
    const other = await ownerCookie(started.url);
    const otherId = (await call<{ sessions: SessionInfo[] }>('GET', '/_caduceus/api/auth/sessions', { cookie })).body.sessions.find((s) => !s.current && s.id)!.id;
    clock.now += 5 * 60_000;
    const revoke = await call('DELETE', `/_caduceus/api/auth/sessions/${otherId}`, { cookie });
    const { entries } = (await call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit', { cookie })).body;

    expect(first.status).toBe(201);
    expect([optionsWithout.status, registerWithout.status, deleteWithout.status]).toEqual([403, 403, 403]);
    expect([optionsWithout.body, deleteWithout.body]).toEqual([{ error: 'step-up-required' }, { error: 'step-up-required' }]);
    expect(renameWithout.status).toBe(200);
    expect([second.status, deleteSecond.status, revoke.status]).toEqual([201, 204, 204]);
    expect(other).toMatch(/^caduceus_session=/);
    expect(entries.filter((e) => /^(passkey\.(register|delete)|session\.revoke)$/.test(e.action)).map((e) => [e.action, e.tier])).toEqual([
      ['session.revoke', 'T1'],
      ['passkey.delete', 'T2'],
      ['passkey.register', 'T2'],
      ['passkey.register', 'T1'],
    ]);
  });
});

describe('passkey sign-in', () => {
  test('the owner signs in with a discoverable passkey; replayed, stale or unknown assertions are refused', async () => {
    const started = await start();
    const { call, origin, clock } = started;
    const authenticator = createSoftwareAuthenticator();
    await registerPasskey(started, await ownerCookie(started.url), authenticator, 'Phone');
    const stranger = createSoftwareAuthenticator();
    const strangersSession = await ownerCookie(started.url);
    await stepUpWith(started, strangersSession, authenticator);
    stranger.register((await call<CreationOptions>('POST', '/_caduceus/api/auth/passkeys/registration-options', { cookie: strangersSession })).body, origin);

    // The sign-in screen asks for options before anyone is signed in (conditional UI starts on page load).
    const options = await call<RequestOptions>('POST', '/_caduceus/api/auth/passkey-sign-in/options');
    const assertion = authenticator.assert(options.body, origin);
    clock.now += 60_000;
    const signIn = await call('POST', '/_caduceus/api/auth/passkey-sign-in', { body: { response: assertion } });
    const cookie = signIn.setCookie?.split(';')[0];
    const whileSignedIn = await call('GET', '/_caduceus/api/auth/session', { cookie });
    const replayed = await call('POST', '/_caduceus/api/auth/passkey-sign-in', { body: { response: assertion } });
    const unknown = await call('POST', '/_caduceus/api/auth/passkey-sign-in', {
      body: { response: stranger.assert((await call<RequestOptions>('POST', '/_caduceus/api/auth/passkey-sign-in/options')).body, origin) },
    });
    const late = authenticator.assert((await call<RequestOptions>('POST', '/_caduceus/api/auth/passkey-sign-in/options')).body, origin);
    clock.now += 5 * 60_000;
    const stale = await call('POST', '/_caduceus/api/auth/passkey-sign-in', { body: { response: late } });
    const list = await call<{ passkeys: Passkey[] }>('GET', '/_caduceus/api/auth/passkeys', { cookie });

    expect(options).toMatchObject({ status: 200, body: { rpId: 'localhost', userVerification: 'required' } });
    // No allowCredentials: the browser offers whichever of the owner's passkeys it holds.
    expect(options.body).not.toHaveProperty('allowCredentials');
    expect(signIn.status).toBe(204);
    expect(signIn.setCookie).toMatch(/^caduceus_session=[^;]+;.*HttpOnly/);
    expect(whileSignedIn.body).toEqual({ ownerExists: true, setupAllowed: false, signedIn: true, passwordSignIn: true });
    for (const refused of [replayed, unknown, stale]) {
      expect(refused).toMatchObject({ status: 401, body: { error: 'passkey-not-verified' }, setCookie: null });
    }
    expect(list.body.passkeys[0].lastUsedAt).toBe('2026-10-07T09:01:00.000Z');
  });

  test('a flood of anonymous sign-in options keeps only the newest 64 challenges and never evicts a signed-in owner\'s', async () => {
    const started = await start();
    const { call, origin } = started;
    const cookie = await ownerCookie(started.url);
    const authenticator = createSoftwareAuthenticator();
    await registerPasskey(started, cookie, authenticator, 'Phone');
    await stepUpWith(started, cookie, authenticator);
    const registration = await call<CreationOptions>('POST', '/_caduceus/api/auth/passkeys/registration-options', { cookie });
    const signInOptions = async () => (await call<RequestOptions>('POST', '/_caduceus/api/auth/passkey-sign-in/options')).body;

    const oldest = await signInOptions();
    const flood = [];
    for (let i = 0; i < 64; i++) flood.push(await signInOptions());
    const evicted = await call('POST', '/_caduceus/api/auth/passkey-sign-in', { body: { response: authenticator.assert(oldest, origin) } });
    const oldestKept = await call('POST', '/_caduceus/api/auth/passkey-sign-in', { body: { response: authenticator.assert(flood[0], origin) } });
    const owners = await call('POST', '/_caduceus/api/auth/passkeys', {
      cookie,
      body: { name: 'Laptop', response: createSoftwareAuthenticator().register(registration.body, origin) },
    });

    expect(evicted.status).toBe(401);
    expect(oldestKept.status).toBe(204);
    expect(owners.status).toBe(201);
  });
});

describe('relying party', () => {
  test('the RP ID is configurable: with the tailnet hostname, passkeys work through Serve and not from another origin', async () => {
    const SERVE_ORIGIN = 'https://mac.tail1234.ts.net:9443';
    const viaServe = { origin: SERVE_ORIGIN, 'x-forwarded-host': 'mac.tail1234.ts.net:9443', 'x-forwarded-for': '100.101.102.103', 'x-forwarded-proto': 'https' };
    const started = await start({ rpId: 'mac.tail1234.ts.net', publicOrigin: SERVE_ORIGIN });
    const { call } = started;
    await ownerCookie(started.url);
    const signIn = await call('POST', '/_caduceus/api/auth/sign-in', { body: { password: TEST_OWNER_PASSWORD }, headers: viaServe });
    const cookie = signIn.setCookie!.split(';')[0];
    const authenticator = createSoftwareAuthenticator();
    const signInOptions = () => call<RequestOptions>('POST', '/_caduceus/api/auth/passkey-sign-in/options', { headers: viaServe });

    const options = await call<CreationOptions>('POST', '/_caduceus/api/auth/passkeys/registration-options', { cookie, headers: viaServe });
    const fromLocalhost = await call('POST', '/_caduceus/api/auth/passkeys', {
      cookie,
      headers: viaServe,
      body: { name: 'Elsewhere', response: createSoftwareAuthenticator().register(options.body, started.origin) },
    });
    const registered = await call('POST', '/_caduceus/api/auth/passkeys', {
      cookie,
      headers: viaServe,
      body: { name: 'Phone', response: authenticator.register((await call<CreationOptions>('POST', '/_caduceus/api/auth/passkeys/registration-options', { cookie, headers: viaServe })).body, SERVE_ORIGIN) },
    });
    const signInViaServe = await call('POST', '/_caduceus/api/auth/passkey-sign-in', {
      headers: viaServe,
      body: { response: authenticator.assert((await signInOptions()).body, SERVE_ORIGIN) },
    });
    // The same passkey, but the page claims to be Caduceus's loopback origin, which is not on the RP ID's hostname.
    const signInFromLocalhost = await call('POST', '/_caduceus/api/auth/passkey-sign-in', {
      body: { response: authenticator.assert((await signInOptions()).body, started.origin) },
    });

    expect(options.body.rp).toEqual({ id: 'mac.tail1234.ts.net', name: 'Caduceus' });
    expect(fromLocalhost).toMatchObject({ status: 400, body: { error: 'passkey-not-verified' } });
    expect(registered.status).toBe(201);
    expect(signInViaServe.status).toBe(204);
    expect(signInViaServe.setCookie).toMatch(/;\s*Secure/);
    expect(signInFromLocalhost).toMatchObject({ status: 401, body: { error: 'passkey-not-verified' } });
  });
});

describe('signed-in devices', () => {
  test('the owner sees every signed-in session with its device, start and last use, and a revoked one is rejected on its next request', async () => {
    const started = await start();
    const { call, clock } = started;
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
    const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const signInFrom = async (userAgent: string) =>
      (await call('POST', '/_caduceus/api/auth/sign-in', { body: { password: TEST_OWNER_PASSWORD }, headers: { 'user-agent': userAgent } })).setCookie!.split(';')[0];
    await ownerCookie(started.url);
    const mac = await signInFrom(MAC);
    clock.now += 60_000;
    const phone = await signInFrom(IPHONE);
    clock.now += 2 * 60_000;
    await call('GET', '/_caduceus/api/backend', { cookie: phone });

    const before = await call<{ sessions: SessionInfo[] }>('GET', '/_caduceus/api/auth/sessions', { cookie: mac });
    const phoneId = before.body.sessions.find((s) => s.userAgent === IPHONE)!.id;
    const revoke = await call('DELETE', `/_caduceus/api/auth/sessions/${phoneId}`, { cookie: mac });
    const phoneNext = await call('GET', '/_caduceus/api/backend', { cookie: phone });
    const after = await call<{ sessions: SessionInfo[] }>('GET', '/_caduceus/api/auth/sessions', { cookie: mac });
    const again = await call('DELETE', `/_caduceus/api/auth/sessions/${phoneId}`, { cookie: mac });

    expect(before).toMatchObject({ status: 200 });
    // Newest first; the set-up session (from the test helper's plain fetch) is the oldest.
    expect(before.body.sessions.map(({ id, ...rest }) => rest)).toEqual([
      { userAgent: IPHONE, createdAt: '2026-10-07T09:01:00.000Z', lastSeenAt: '2026-10-07T09:03:00.000Z', current: false },
      // Asking is itself a use.
      { userAgent: MAC, createdAt: '2026-10-07T09:00:00.000Z', lastSeenAt: '2026-10-07T09:03:00.000Z', current: true },
      { userAgent: 'node', createdAt: '2026-10-07T09:00:00.000Z', lastSeenAt: '2026-10-07T09:00:00.000Z', current: false },
    ]);
    expect(revoke.status).toBe(204);
    expect(phoneNext).toMatchObject({ status: 401, body: { error: 'signed-out' } });
    expect(after.body.sessions.map((s) => s.userAgent)).toEqual([MAC, 'node']);
    expect(again).toMatchObject({ status: 404, body: { error: 'not-found' } });
  });
});

describe('step-up', () => {
  test('a passkey assertion grants the session, and only it, about 5 minutes; actions behind the requirement answer 403 step-up-required without one', async () => {
    const started = await start();
    const { call, origin, clock } = started;
    const cookie = await ownerCookie(started.url);
    const other = await ownerCookie(started.url);
    const authenticator = createSoftwareAuthenticator();
    const first = (await registerPasskey(started, cookie, authenticator, 'Laptop')).body;
    const second = (await registerPasskey(started, cookie, createSoftwareAuthenticator(), 'Key', authenticator)).body;
    // The step-up that added the second passkey has lapsed by the time the grant is tested.
    clock.now += 6 * 60_000;
    const stepUpOptions = (session: string) => call<RequestOptions>('POST', '/_caduceus/api/auth/step-up/options', { cookie: session });
    // Changing the password is behind the step-up requirement.
    const changePassword = (session: string) => call('PUT', '/_caduceus/api/auth/password', { cookie: session, body: { password: 'a brand new passphrase' } });

    const withoutGrant = await changePassword(cookie);
    const options = await stepUpOptions(cookie);
    const stepUp = await call('POST', '/_caduceus/api/auth/step-up', { cookie, body: { response: authenticator.assert(options.body, origin) } });
    // An assertion made for one session's challenge is no good to another session.
    const borrowed = await call('POST', '/_caduceus/api/auth/step-up', {
      cookie: other,
      body: { response: authenticator.assert((await stepUpOptions(cookie)).body, origin) },
    });
    const otherSession = await changePassword(other);
    clock.now += 5 * 60_000 - 1;
    const withGrant = await changePassword(cookie);
    clock.now += 1;
    const expired = await changePassword(cookie);
    const signedOut = await call('PUT', '/_caduceus/api/auth/password', { body: { password: 'a brand new passphrase' } });

    expect(withoutGrant).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
    expect(options).toMatchObject({
      status: 200,
      body: { rpId: 'localhost', userVerification: 'required', allowCredentials: [{ id: first.id }, { id: second.id }] },
    });
    expect(stepUp).toMatchObject({ status: 200, body: { expiresAt: '2026-10-07T09:11:00.000Z' } });
    expect(borrowed).toMatchObject({ status: 401, body: { error: 'passkey-not-verified' } });
    expect(otherSession).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
    expect(withGrant.status).toBe(204);
    expect(expired).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
    expect(signedOut).toMatchObject({ status: 401, body: { error: 'signed-out' } });
  });

  test('step-up needs a passkey: without one the owner is told to add one first', async () => {
    const started = await start();
    const cookie = await ownerCookie(started.url);

    const options = await started.call('POST', '/_caduceus/api/auth/step-up/options', { cookie });

    expect(options).toMatchObject({ status: 409, body: { error: 'no-passkey' } });
  });
});

describe('audit', () => {
  test('passkey changes, passkey sign-ins, step-ups, password changes and revokes are audited', async () => {
    const started = await start();
    const { call, origin, clock } = started;
    const minuteLater = () => (clock.now += 60_000);
    const cookie = await ownerCookie(started.url);
    const authenticator = createSoftwareAuthenticator();
    const tablet = createSoftwareAuthenticator();

    minuteLater();
    const { id } = (await registerPasskey(started, cookie, authenticator, 'Phone')).body;
    const tabletKey = (await registerPasskey(started, cookie, tablet, 'Tablet', authenticator)).body.id;
    minuteLater();
    await call('PATCH', `/_caduceus/api/auth/passkeys/${id}`, { cookie, body: { name: 'iPhone' } });
    minuteLater();
    const signIn = await call('POST', '/_caduceus/api/auth/passkey-sign-in', {
      body: { response: authenticator.assert((await call<RequestOptions>('POST', '/_caduceus/api/auth/passkey-sign-in/options')).body, origin) },
    });
    const phone = signIn.setCookie!.split(';')[0];
    minuteLater();
    const options = await call<RequestOptions>('POST', '/_caduceus/api/auth/step-up/options', { cookie: phone });
    await call('POST', '/_caduceus/api/auth/step-up', { cookie: phone, body: { response: authenticator.assert(options.body, origin) } });
    minuteLater();
    await call('PUT', '/_caduceus/api/auth/password', { cookie: phone, body: { password: 'a brand new passphrase' } });
    await call('DELETE', '/_caduceus/api/auth/password', { cookie: phone });
    minuteLater();
    await call('DELETE', `/_caduceus/api/auth/passkeys/${tabletKey}`, { cookie: phone });
    const sessions = (await call<{ sessions: SessionInfo[] }>('GET', '/_caduceus/api/auth/sessions', { cookie: phone })).body.sessions;
    const first = sessions.find((s) => !s.current)!.id;
    minuteLater();
    await call('DELETE', `/_caduceus/api/auth/sessions/${first}`, { cookie: phone });
    const { entries } = (await call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit', { cookie: phone })).body;

    const phoneSession = `session:${sessions.find((s) => s.current)!.id}`;
    expect(entries.slice(0, 10)).toEqual([
      { at: '2026-10-07T09:07:00.000Z', actor: 'owner', action: 'session.revoke', target: `session:${first}`, source: 'local', tier: 'T1' },
      { at: '2026-10-07T09:06:00.000Z', actor: 'owner', action: 'passkey.delete', target: `passkey:${tabletKey}`, source: 'local', tier: 'T2' },
      { at: '2026-10-07T09:05:00.000Z', actor: 'owner', action: 'owner.password-remove', target: 'owner', source: 'local', tier: 'T2' },
      { at: '2026-10-07T09:05:00.000Z', actor: 'owner', action: 'owner.password-set', target: 'owner', source: 'local', tier: 'T2' },
      { at: '2026-10-07T09:04:00.000Z', actor: 'owner', action: 'session.step-up', target: phoneSession, source: 'local' },
      { at: '2026-10-07T09:03:00.000Z', actor: 'owner', action: 'session.sign-in-passkey', target: phoneSession, source: 'local' },
      { at: '2026-10-07T09:02:00.000Z', actor: 'owner', action: 'passkey.rename', target: `passkey:${id}`, source: 'local' },
      { at: '2026-10-07T09:01:00.000Z', actor: 'owner', action: 'passkey.register', target: `passkey:${tabletKey}`, source: 'local', tier: 'T2' },
      // Adding the second passkey needed a step-up of the first session.
      { at: '2026-10-07T09:01:00.000Z', actor: 'owner', action: 'session.step-up', target: `session:${first}`, source: 'local' },
      { at: '2026-10-07T09:01:00.000Z', actor: 'owner', action: 'passkey.register', target: `passkey:${id}`, source: 'local', tier: 'T1' },
    ]);
  });
});

describe('Caduceus store', () => {
  test('a store from before passkeys (M0 #03) keeps its owner and sessions, and gains passkeys that survive a restart', async () => {
    // The M0 #03 schema with an owner and a session, as its server left them. The password hash uses a small scrypt
    // cost (each hash carries its own parameters) so the test stays fast.
    const dir = path.join(hermes.home, 'caduceus');
    fs.mkdirSync(dir, { mode: 0o700 });
    const old = new DatabaseSync(path.join(dir, 'caduceus.db'));
    old.exec(`
      CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK (id = 1), password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, user_agent TEXT NOT NULL);
      CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, source TEXT NOT NULL);
    `);
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(TEST_OWNER_PASSWORD, salt, 32, { N: 1024, r: 8, p: 1 });
    old.prepare('INSERT INTO owner VALUES (1, ?, ?)').run(`scrypt$1024$8$1$${salt.toString('base64')}$${key.toString('base64')}`, START);
    const token = crypto.randomBytes(32).toString('base64url');
    old.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('0123456789abcdef', crypto.createHash('sha256').update(token).digest('hex'), START, START, 'old browser');
    old.close();

    const started = await start();
    const { call } = started;
    const kept = await call<{ sessions: SessionInfo[] }>('GET', '/_caduceus/api/auth/sessions', { cookie: `caduceus_session=${token}` });
    const signIn = await call('POST', '/_caduceus/api/auth/sign-in', { body: { password: TEST_OWNER_PASSWORD } });
    const registered = await registerPasskey(started, signIn.setCookie!.split(';')[0], createSoftwareAuthenticator(), 'Phone');
    await server!.close();
    const restarted = await start();
    const afterRestart = await restarted.call<{ passkeys: Passkey[] }>('GET', '/_caduceus/api/auth/passkeys', { cookie: `caduceus_session=${token}` });

    expect(kept.body.sessions.map((s) => s.userAgent)).toEqual(['old browser']);
    expect(signIn.status).toBe(204);
    expect(registered.status).toBe(201);
    expect(afterRestart.body.passkeys.map((p) => p.name)).toEqual(['Phone']);
  });
});
