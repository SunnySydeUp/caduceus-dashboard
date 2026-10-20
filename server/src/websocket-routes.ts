// WebSocket upgrades: the gate every one passes (exact Origin, then a session, then what its route needs), and the routes behind it.
import { classifyWebSocketRoute } from '@caduceus/contracts/policy/rest';
import { parse } from 'hono/utils/cookie';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { SESSION_COOKIE, requestSource } from './auth-routes.ts';
import type { OwnerAuth, OwnerSession } from './owner-auth.ts';
import type { ReadOnlyMode } from './read-only.ts';
import type { TailnetIdentity } from './tailnet-identity.ts';

/** What a route is handed once an upgrade has passed the gate. */
export interface UpgradeContext {
  session: OwnerSession;
  /** Where the request came from, as the audit log names it. */
  source: string;
}

/** Takes over an upgrade request: it completes the handshake, or refuses it with `refuseUpgrade`. */
export type UpgradeHandler = (req: http.IncomingMessage, socket: Duplex, head: Buffer, context: UpgradeContext) => void;

/** Answers a WebSocket handshake with a plain HTTP refusal and closes the connection. */
export function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export interface UpgradeGate {
  auth: OwnerAuth;
  readOnly: Pick<ReadOnlyMode, 'enabled'>;
  /** The exact origins a page of Caduceus is served from. */
  origins: ReadonlySet<string>;
  /** Whose requests through Tailscale Serve are served at all; the same check as for HTTP requests, made before anything else. */
  tailnet: Pick<TailnetIdentity, 'allows'>;
  /** The routes Caduceus serves, by path. Hermes has more WebSocket routes (`classifyWebSocketRoute`); any other path finds nothing (404). */
  routes: Readonly<Record<string, UpgradeHandler>>;
}

/**
 * Gates WebSocket upgrades like unsafe requests: the tailnet identity first (a forwarded request needs one of the owner's
 * Tailscale logins), then the exact Origin, then a session, then the route's policy (`classifyWebSocketRoute`). A denied route
 * is refused (403). A T2 route needs a step-up grant on the session. Read-only mode refuses a route that is not a read, unless
 * it is a T0 route whose frames are judged one by one (the gateway).
 */
export function gateUpgrades(server: http.Server, { auth, readOnly, origins, tailnet, routes }: UpgradeGate): void {
  server.on('upgrade', (req, socket, head) => {
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value.join(', ') : value;
    };
    if (!tailnet.allows(req.socket.remoteAddress ?? '', header)) return refuseUpgrade(socket, 403);
    if (!origins.has(req.headers.origin ?? '')) return refuseUpgrade(socket, 403);
    const session = auth.session(parse(req.headers.cookie ?? '', SESSION_COOKIE)[SESSION_COOKIE]);
    if (!session) return refuseUpgrade(socket, 401);
    const { pathname } = new URL(req.url ?? '/', 'http://caduceus');
    const policy = classifyWebSocketRoute(pathname);
    if (!policy) return refuseUpgrade(socket, 404);
    if (policy.tier === 'denied') return refuseUpgrade(socket, 403);
    if (policy.tier !== 'T0' && !policy.read && readOnly.enabled()) return refuseUpgrade(socket, 403);
    if ((policy.tier === 'T2' || policy.tier === 'T3') && !auth.hasStepUp(session.id)) return refuseUpgrade(socket, 403);
    const handler = Object.hasOwn(routes, pathname) ? routes[pathname] : undefined;
    if (!handler) return refuseUpgrade(socket, 404);
    handler(req, socket, head, { session, source: requestSource(req.socket.remoteAddress ?? '', header) });
  });
}
