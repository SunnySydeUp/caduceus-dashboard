// The extra sign-in methods over HTTP (M5 #15): which are on and how they are set up (Settings › Security), Tailscale identity sign-in and, in oidc-routes.ts, OIDC.
import type { Context, Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { AuthMethods } from '@caduceus/contracts/caduceus-api';
import type { AuditLog } from './audit-log.ts';
import { authClient, requireStepUp, setSessionCookie, type AuthEnv } from './auth-routes.ts';
import type { AuthMethodStore } from './auth-methods.ts';
import type { OwnerAuth } from './owner-auth.ts';
import type { Passkeys } from './passkeys.ts';
import { serveIdentity } from './tailnet-identity.ts';

/** The tailnet login this request carries through Serve, or `undefined`. */
export const tailnetIdentityOf = (c: Context): string | undefined => serveIdentity(getConnInfo(c).remote.address ?? '', (name) => c.req.header(name));

export interface AuthMethodDeps {
  auth: OwnerAuth;
  audit: AuditLog;
  passkeys: Passkeys;
  methods: AuthMethodStore;
  /** What the OIDC part adds to `GET /auth/methods`. */
  oidcState(c: Context): AuthMethods['oidc'];
}

export function mountAuthMethodRoutes(app: Hono<AuthEnv>, deps: AuthMethodDeps): void {
  const { auth, audit, passkeys, methods } = deps;
  const stepUp = requireStepUp(auth);

  app.get('/_caduceus/api/auth/methods', (c) => {
    const tailscale = methods.tailscale();
    return c.json({
      password: { enabled: auth.hasPassword() },
      passkeys: { count: passkeys.list().length },
      oidc: deps.oidcState(c),
      tailscale: { enabled: tailscale.enabled, login: tailscale.config?.login ?? null },
      tailnetIdentity: tailnetIdentityOf(c) ?? null,
    } satisfies AuthMethods);
  });

  // Turning it on is its test: the owner makes this request through Serve, and what Serve says about who made it must be the login being enabled.
  app.put('/_caduceus/api/auth/methods/tailscale', stepUp, async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (typeof record.enabled !== 'boolean') return c.json({ error: 'bad-request', field: 'enabled' }, 400);
    const before = methods.tailscale();
    const login = (typeof record.login === 'string' ? record.login : (before.config?.login ?? '')).trim().toLowerCase();
    if (!/^[^\s,]+$/.test(login)) return c.json({ error: 'bad-request', field: 'login' }, 400);
    if (record.enabled) {
      const seen = tailnetIdentityOf(c);
      if (seen !== login) {
        return c.json(
          { error: 'identity-not-seen', message: seen === undefined ? 'Open Caduceus through its Tailscale address and enable this there: Caduceus can only test the identity of a request that came through Tailscale Serve.' : `This request came through Tailscale as ${seen}, not ${login}. Enable it as the login you want to allow.` },
          409,
        );
      }
    }
    methods.setTailscale(record.enabled, { login });
    audit.record({ actor: 'owner', action: 'auth.method-tailscale-set', target: `tailscale:${login}`, source: authClient(c).source, tier: 'T2' });
    return c.json({ enabled: record.enabled, login });
  });

  // Public (the gate lets it through): sign-in by what Serve says about the sender, for the one login the owner configured.
  app.post('/_caduceus/api/auth/tailscale-sign-in', (c) => {
    const client = authClient(c);
    const { enabled, config } = methods.tailscale();
    if (!enabled || !config) return c.json({ error: 'method-disabled' }, 403);
    const seen = tailnetIdentityOf(c);
    if (seen !== config.login) {
      audit.record({ actor: 'anonymous', action: 'session.sign-in-tailscale-refused', target: 'owner', source: client.source });
      return c.json({ error: 'identity-refused' }, 403);
    }
    setSessionCookie(c, auth.signInWith('session.sign-in-tailscale', client).token);
    return c.body(null, 204);
  });
}
