// Hermes's restricted console (`hermes>`, M5 #13): a WebSocket from the browser to Caduceus, and one upstream WebSocket per browser socket to Hermes's
// `/api/console`. The console is Hermes's own engine with its own allow-list of commands (it runs no shell, and asks before a command that changes something);
// Caduceus adds that opening it is a Tier 2 (a passkey, judged at the upgrade), that only the frames the console defines go through, and that the session
// and every command are audited.
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { GATEWAY_CLOSE } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { WebSocket, WebSocketServer } from 'ws';
import type { AuditLog } from './audit-log.ts';
import type { CloseReason } from './gateway-proxy.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { refuseUpgrade, type UpgradeContext } from './websocket-routes.ts';

export interface ConsoleProxyOptions {
  backend: HermesBackend;
  audit: AuditLog;
  openTimeoutMs?: number;
  keepaliveMs?: number;
}

export interface ConsoleProxy {
  accept(req: http.IncomingMessage, socket: Duplex, head: Buffer, context: UpgradeContext): void;
  closeSession(sessionId: string, why: CloseReason): void;
  closeAll(why: CloseReason): void;
}

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const DEFAULT_KEEPALIVE_MS = 30_000;
const UNSUPPORTED_DATA = 1003;
/** The most one frame from the browser may be: a console line is a short command. */
const MAX_FRAME_BYTES = 8 * 1024;
/** The longest command the audit log keeps. */
const MAX_AUDITED = 120;
/** The frames Hermes's console understands; any other is answered here and never reaches it. */
const FRAME_TYPES: Record<string, true> = { ping: true, cancel: true, confirm: true, input: true, command: true };
/** A profile name as Hermes writes them. */
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function createConsoleProxy({ backend, audit, openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS, keepaliveMs = DEFAULT_KEEPALIVE_MS }: ConsoleProxyOptions): ConsoleProxy {
  const browsers = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const live = new Map<string, Set<{ browser: WebSocket; upstream: WebSocket }>>();
  /** Set once Caduceus itself is stopping: the audit log is closed with it, so the sessions that end now are not written to it. */
  let stopping = false;

  const track = (sessionId: string, pair: { browser: WebSocket; upstream: WebSocket }) => {
    const pairs = live.get(sessionId) ?? new Set();
    live.set(sessionId, pairs.add(pair));
    return () => {
      pairs.delete(pair);
      if (pairs.size === 0) live.delete(sessionId);
    };
  };

  return {
    accept(req, socket, head, { session, source }) {
      if (backend.status.state !== 'ready') return refuseUpgrade(socket, 503);
      const profile = new URL(req.url ?? '/', 'http://caduceus').searchParams.get('profile') ?? undefined;
      if (profile !== undefined && profile !== '' && !PROFILE.test(profile)) return refuseUpgrade(socket, 400);

      void (async () => {
        const upstream = await backend.openConsole({ profile: profile || undefined, handshakeTimeoutMs: openTimeoutMs });
        const { promise: opened, resolve, reject } = Promise.withResolvers<void>();
        upstream.addEventListener('open', () => resolve(), { once: true });
        upstream.addEventListener('close', () => reject(new Error('Hermes closed the console before it opened')), { once: true });
        socket.once('close', () => upstream.close());
        await opened;
        browsers.handleUpgrade(req, socket, head, (browser) => {
          const pair = { browser, upstream };
          const untrack = track(session.id, pair);
          audit.record({ actor: 'owner', action: 'console.open', target: profile || 'current', source, tier: 'T2' });
          // A frame over the limit is an `error` event of `ws` before it is a close (1009): the close is what is handled.
          browser.on('error', () => undefined);
          let answered = true;
          browser.on('pong', () => {
            answered = true;
          });
          const keepalive = setInterval(() => {
            if (!answered) {
              browser.terminate();
              return;
            }
            answered = false;
            browser.ping();
          }, keepaliveMs);
          const refuse = (message: string) => browser.send(JSON.stringify({ type: 'error', message }));
          browser.on('message', (data, isBinary) => {
            if (isBinary) {
              browser.close(UNSUPPORTED_DATA, 'A console frame is text');
              return;
            }
            let frame: unknown;
            try {
              frame = JSON.parse(data.toString());
            } catch {
              return refuse('Console frames must be JSON objects.');
            }
            const type = isRecord(frame) && typeof frame.type === 'string' ? frame.type.toLowerCase() : '';
            if (!isRecord(frame) || !FRAME_TYPES[type]) return refuse(`Unsupported console frame: ${type || '?'}`);
            if (type === 'input' || type === 'command') {
              const line = String(frame.line ?? frame.command ?? '').trim();
              // The launch secret never appears in what a person types, but a line is still cut and scrubbed before it is kept.
              if (line) audit.record({ actor: 'owner', action: 'console.command', target: backend.redact(line).slice(0, MAX_AUDITED), source, tier: 'T2' });
            }
            if (upstream.readyState === WebSocket.OPEN) upstream.send(data.toString());
          });
          upstream.addEventListener('message', (event) => {
            if (typeof event.data !== 'string') {
              browser.close(UNSUPPORTED_DATA, 'Hermes sent a frame that is not text');
              return;
            }
            if (browser.readyState === WebSocket.OPEN) browser.send(backend.redact(event.data));
          });
          upstream.addEventListener('close', () => browser.close(GATEWAY_CLOSE.hermesClosed.code, GATEWAY_CLOSE.hermesClosed.reason), { once: true });
          browser.once('close', () => {
            clearInterval(keepalive);
            untrack();
            upstream.close();
            if (!stopping) audit.record({ actor: 'owner', action: 'console.close', target: profile || 'current', source, tier: 'T2' });
          });
        });
      })().catch(() => refuseUpgrade(socket, 502));
    },

    closeSession(sessionId, why) {
      for (const pair of live.get(sessionId) ?? []) pair.browser.close(why.code, why.reason);
    },

    closeAll(why) {
      stopping = true;
      for (const pairs of live.values()) for (const pair of pairs) pair.browser.close(why.code, why.reason);
    },
  };
}
