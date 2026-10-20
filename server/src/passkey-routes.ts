// Passkeys over HTTP: signing in with one (public), and registering and managing them (Settings › Security).
import type { Context, Hono } from 'hono';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { StepUpGrant } from '@caduceus/contracts/caduceus-api';
import { authClient, requireStepUp, setSessionCookie, type AuthEnv } from './auth-routes.ts';
import type { OwnerAuth } from './owner-auth.ts';
import type { Passkeys } from './passkeys.ts';

/** A passkey's name: what the owner calls the device or password manager holding it. */
const NAME_LENGTH = { min: 1, max: 64 } as const;

/**
 * A JSON body's `name` (trimmed, if it is a valid passkey name) and `response` (what `@simplewebauthn/browser` made
 * of the authenticator's answer; verification checks the rest). A field that is missing or invalid is `undefined`.
 */
async function readBody(c: Context): Promise<{ name?: string; response?: object }> {
  const body: unknown = await c.req.json().catch(() => undefined);
  if (typeof body !== 'object' || body === null) return {};
  const name = 'name' in body && typeof body.name === 'string' ? body.name.trim() : '';
  const response = 'response' in body && typeof body.response === 'object' && body.response !== null ? body.response : undefined;
  return { name: name.length >= NAME_LENGTH.min && name.length <= NAME_LENGTH.max ? name : undefined, response };
}

export function mountPasskeyRoutes(app: Hono<AuthEnv>, auth: OwnerAuth, passkeys: Passkeys): void {
  // A passkey is the owner's proof of presence, so adding or removing one needs it (T2). The first has nothing to step up
  // with, so it is T1: a password-only owner adds it, which is also what makes every other T2 and T3 action possible.
  const stepUp = requireStepUp(auth);
  const stepUpOnceThereArePasskeys: typeof stepUp = (c, next) => (passkeys.list().length > 0 ? stepUp(c, next) : next());

  // Public (see the gate's list): the sign-in screen asks for options on load, for the browser's conditional UI.
  app.post('/_caduceus/api/auth/passkey-sign-in/options', async (c) => c.json(await passkeys.signInOptions()));

  app.post('/_caduceus/api/auth/passkey-sign-in', async (c) => {
    const { response } = await readBody(c);
    if (!response) return c.json({ error: 'bad-request' }, 400);
    if (!(await passkeys.verifySignIn(response as AuthenticationResponseJSON))) return c.json({ error: 'passkey-not-verified' }, 401);
    setSessionCookie(c, auth.signInWithPasskey(authClient(c)).token);
    return c.body(null, 204);
  });

  app.get('/_caduceus/api/auth/passkeys', (c) => c.json({ passkeys: passkeys.list() }));

  app.post('/_caduceus/api/auth/passkeys/registration-options', stepUpOnceThereArePasskeys, async (c) => c.json(await passkeys.registrationOptions(c.get('session')!.id)));

  app.post('/_caduceus/api/auth/passkeys', stepUpOnceThereArePasskeys, async (c) => {
    const { name, response } = await readBody(c);
    if (!name || !response) return c.json({ error: 'bad-request' }, 400);
    const passkey = await passkeys.register(c.get('session')!.id, response as RegistrationResponseJSON, name, authClient(c));
    if (!passkey) return c.json({ error: 'passkey-not-verified' }, 400);
    return c.json(passkey, 201);
  });

  app.patch('/_caduceus/api/auth/passkeys/:id', async (c) => {
    const { name } = await readBody(c);
    if (!name) return c.json({ error: 'bad-request' }, 400);
    const passkey = passkeys.rename(c.req.param('id'), name, authClient(c));
    return passkey ? c.json(passkey) : c.json({ error: 'not-found' }, 404);
  });

  app.delete('/_caduceus/api/auth/passkeys/:id', stepUp, (c) => {
    const result = passkeys.remove(c.req.param('id'), authClient(c));
    if (result === 'not-found') return c.json({ error: result }, 404);
    if (result === 'last-sign-in-method') return c.json({ error: result }, 409);
    return c.body(null, 204);
  });

  app.post('/_caduceus/api/auth/step-up/options', async (c) => {
    const options = await passkeys.stepUpOptions(c.get('session')!.id);
    return options ? c.json(options) : c.json({ error: 'no-passkey' }, 409);
  });

  app.post('/_caduceus/api/auth/step-up', async (c) => {
    const { response } = await readBody(c);
    if (!response) return c.json({ error: 'bad-request' }, 400);
    const sessionId = c.get('session')!.id;
    if (!(await passkeys.verifyStepUp(sessionId, response as AuthenticationResponseJSON))) return c.json({ error: 'passkey-not-verified' }, 401);
    const until = auth.grantStepUp(sessionId, authClient(c));
    return c.json({ expiresAt: new Date(until).toISOString() } satisfies StepUpGrant);
  });
}
