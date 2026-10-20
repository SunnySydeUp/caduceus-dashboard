// The tailnet identity gate (M0 #13; architecture §5, layer 1). A request that reaches Caduceus through Tailscale Serve carries
// `Tailscale-User-Login`, the login of the tailnet user it came from; Caduceus serves it only when that login is one of the
// owner's. The header can be trusted only because Caduceus listens on loopback alone, so nothing but Serve (or a process on
// this Mac, which could do far worse) can send it, and Serve overwrites whatever a client sends.
import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { isDirectLocalPeer, requestSource, type HeaderReader } from './auth-routes.ts';

export interface TailnetIdentity {
  /**
   * Whether a request from this peer may be served at all. A request from this Mac itself always may (the owner sets up and
   * recovers from the Mac; see `isDirectLocalPeer`). A forwarded one may only when Tailscale named one of the owners (logins
   * compare without regard to case). Without a list nothing is enforced: that is development, not production.
   */
  allows(remoteAddress: string, header: HeaderReader): boolean;
  /** Refuses (403 `{"error":"tailnet-identity"}`) every HTTP request that `allows` does not. */
  middleware: MiddlewareHandler;
}

/**
 * `owners` are the Tailscale logins allowed through Serve; an empty list refuses every forwarded request. `onRefused` is told
 * where each refused request came from, as the audit log names sources (`tailnet:<login>` or `forwarded:<address>`).
 */
export function createTailnetIdentity(owners: readonly string[] | undefined, onRefused: (source: string) => void = () => {}): TailnetIdentity {
  const allowed = owners && new Set(owners.map((login) => login.toLowerCase()));
  const allows = (remoteAddress: string, header: HeaderReader): boolean => {
    if (!allowed || isDirectLocalPeer(remoteAddress, header)) return true;
    const login = header('tailscale-user-login');
    if (login !== undefined && allowed.has(login.toLowerCase())) return true;
    onRefused(requestSource(remoteAddress, header));
    return false;
  };
  return {
    allows,
    middleware: async (c, next) => {
      if (allows(getConnInfo(c).remote.address ?? '', (name) => c.req.header(name))) return next();
      return c.json({ error: 'tailnet-identity' }, 403, { 'Cache-Control': 'no-store' });
    },
  };
}

/**
 * The tailnet login of a request that came through Tailscale Serve on this Mac, or `undefined` for any other request. Serve connects from loopback and always
 * adds the forwarding headers beside `Tailscale-User-Login`; a request from another address, or one that names a login without the headers Serve sets,
 * did not come through Serve, and what it says about who it is is only what the sender wrote. Sign-in by tailnet identity trusts nothing else.
 */
export function serveIdentity(remoteAddress: string, header: HeaderReader): string | undefined {
  const loopback = remoteAddress === '::1' || /^(::ffff:)?127\./.test(remoteAddress);
  const login = header('tailscale-user-login');
  if (!loopback || !login) return undefined;
  const sentByServe = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].every((name) => header(name) !== undefined && header(name) !== '');
  return sentByServe ? login.toLowerCase() : undefined;
}
