// The browser's live connection to Hermes's JSON-RPC gateway: a WebSocket from the browser to Caduceus, and one upstream
// WebSocket per browser socket from Caduceus to the private Hermes backend (architecture §4). Every frame, in both
// directions, goes through the gateway policy (`gateway-policy.ts`).
//
// The grace hold (M1 #03): a browser that goes away (a phone locked, a network dropped, a page reloaded) does not take its
// upstream with it at once. Caduceus keeps it open for a grace period (ten minutes), so that the sessions it hosts stay
// hosted in Hermes and a turn goes on running, and the device's next socket (the same tab of the same sign-in) takes it over.
import { GATEWAY_CLOSE } from '@caduceus/contracts/caduceus-api';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { GatewayFrames, GatewayPolicy } from './gateway-policy.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { desktopContractIn } from './hermes-contract.ts';
import { refuseUpgrade, type UpgradeContext } from './websocket-routes.ts';

/** How the grace period is measured: `start` runs `run` after `ms` and returns how to cancel it. */
export interface GraceTimers {
  start(run: () => void, ms: number): () => void;
}

/** How long Hermes keeps a session that has no browser socket going on its own (its running turn is interrupted after 600 s without activity); ten minutes is the grace architecture §4 names. */
export const DEFAULT_GRACE_MS = 10 * 60_000;

const realTimers: GraceTimers = {
  start(run, ms) {
    const timer = setTimeout(run, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

export interface GatewayProxyOptions {
  backend: HermesBackend;
  policy: GatewayPolicy;
  /** How long Hermes has to accept the upstream connection before the browser's handshake is refused. */
  openTimeoutMs?: number;
  /** Told the desktop contract number of every frame Hermes sends that carries one (`session.info`, the result of a create / resume / activate). */
  onDesktopContract?: (number: number) => void;
  /** How long an upstream is kept open after its browser socket went away, and the timers that measure it (the tests pass a clock they wind by hand). */
  grace?: { ms?: number; timers?: GraceTimers };
  /** How often a browser socket is pinged; one that has not answered the last ping by the next is dropped. */
  keepaliveMs?: number;
}

/** How a connection is closed from Caduceus's side: a WebSocket close code, and the reason the page can show. */
export interface CloseReason {
  code: number;
  reason: string;
}

export interface GatewayProxy {
  /** Serves a gateway upgrade that passed the gate. */
  accept(req: http.IncomingMessage, socket: Duplex, head: Buffer, context: UpgradeContext): void;
  /** Closes every live connection of one session of the owner. */
  closeSession(sessionId: string, why: CloseReason): void;
  /** Closes every live connection. */
  closeAll(why: CloseReason): void;
  /** Sends a frame of Caduceus's own (not Hermes's) to every browser that is connected now; a connection that is being held has no browser and misses it. */
  broadcast(frame: string): void;
}

/** WebSocket close codes: the standard ones for what a gateway frame must not be, and for a failure of Caduceus's own. */
const CLOSE = { unsupportedData: 1003, serverError: 1011, goingAway: 1001 } as const;

/** What a connection tells the proxy about its own life. */
interface ConnectionHooks {
  /** The browser socket the connection was serving is gone (it closed, or was dropped for missing a ping). */
  onBrowserGone(): void;
  /** The upstream is closed: the connection is over, whoever closed it. */
  onUpstreamClosed(): void;
  /** Hermes sent a frame that carries a desktop contract number. */
  onDesktopContract(number: number): void;
}

/**
 * The upstream socket to Hermes and, while there is one, the browser socket it is joined to. The upstream outlives its
 * browser socket for the grace period (it is "held"), and the device's next browser socket is joined to it again.
 */
class GatewayConnection {
  readonly #frames: GatewayFrames;
  readonly #redact: (text: string) => string;
  readonly #keepaliveMs: number;
  readonly #hooks: ConnectionHooks;
  #upstream: WebSocket | undefined;
  #browser: WebSocket | undefined;
  /** What Hermes sent before the browser's side of the handshake was done. */
  #early: string[] = [];
  /** Set once a browser socket has been joined: from then on a frame Hermes sends while there is none is dropped (the session's replay buffer in Hermes is what brings a returning page up to date). */
  #joined = false;
  /** Hermes's `gateway.ready`, the first frame of every connection: a browser that takes over a held upstream is owed it, and Hermes sends it once. */
  #ready: string | undefined;
  /** Set once Caduceus has decided to close this connection, which may be before either socket is open. */
  #ending: CloseReason | undefined;
  /** The frame being judged: frames from the browser are judged in the order they came, so a slow policy answer (the quick-command lookup) is never overtaken. */
  #judging = Promise.resolve();

  constructor(frames: GatewayFrames, redact: (text: string) => string, keepaliveMs: number, hooks: ConnectionHooks) {
    this.#frames = frames;
    this.#redact = redact;
    this.#keepaliveMs = keepaliveMs;
    this.#hooks = hooks;
  }

  /** Whether a browser socket has ever been joined to it: a connection that has not is not a session anyone could be holding. */
  get joined(): boolean {
    return this.#joined;
  }

  /** The upstream is open and the connection is not being closed: it can be held, and taken over. */
  get alive(): boolean {
    return !this.#ending && this.#upstream?.readyState === WebSocket.OPEN;
  }

  /** Takes the upstream socket, once it is open. */
  connect(upstream: WebSocket): void {
    if (this.#ending) {
      upstream.close();
      return;
    }
    this.#upstream = upstream;
    upstream.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') this.#browser?.close(CLOSE.unsupportedData, 'Hermes sent a frame that is not text');
      else if (this.#browser) this.#fromHermes(event.data);
      else if (!this.#joined) this.#early.push(event.data);
    });
    // A socket that fails (Hermes died while the connection was held, with nobody reading) is followed by a close, which is what is handled; an `error` nobody listens to would take the process down.
    upstream.addEventListener('error', () => {});
    upstream.addEventListener('close', () => {
      this.#browser?.close(GATEWAY_CLOSE.hermesClosed.code, GATEWAY_CLOSE.hermesClosed.reason);
      this.#hooks.onUpstreamClosed();
    });
  }

  /** Joins a browser's accepted socket to the upstream: the first one, or (`takeover`) the next one of a device whose upstream was held. */
  attach(browser: WebSocket, takeover = false): void {
    this.#browser = browser;
    this.#joined = true;
    this.#keepAlive(browser);
    browser.once('close', () => {
      if (this.#browser === browser) this.#browser = undefined;
      this.#hooks.onBrowserGone();
    });
    browser.on('message', (data, isBinary) => {
      if (isBinary) {
        browser.close(CLOSE.unsupportedData, 'A gateway frame is text');
        return;
      }
      const text = data.toString();
      this.#judging = this.#judging
        .then(() => this.#frames.fromBrowser(text))
        .then((verdict) => {
          if (verdict.reply !== undefined) this.#toBrowser(verdict.reply);
          if (verdict.forward !== undefined) this.#toHermes(verdict.forward);
        })
        .catch(() => browser.close(CLOSE.serverError, 'Caduceus could not judge a frame'));
    });
    if (this.#ending) browser.close(this.#ending.code, this.#ending.reason);
    else if (this.#upstream?.readyState !== WebSocket.OPEN) browser.close(GATEWAY_CLOSE.hermesClosed.code, GATEWAY_CLOSE.hermesClosed.reason);
    // A browser that takes over starts as one that connected: Hermes's `gateway.ready` first (its replay epoch, its heartbeat).
    if (takeover && this.#ready !== undefined) this.#fromHermes(this.#ready);
    for (const text of this.#early.splice(0)) this.#fromHermes(text);
  }

  /**
   * A phone that loses its connection says no goodbye, and TCP takes minutes or hours to notice: the socket would stay
   * open, and so would its upstream, a session Hermes keeps hosting. So the browser is pinged, and one that does not
   * answer by the next ping is dropped, which hands its upstream to the grace hold.
   */
  #keepAlive(browser: WebSocket): void {
    let answered = true;
    browser.on('pong', () => {
      answered = true;
    });
    const timer = setInterval(() => {
      if (!answered) {
        browser.terminate();
        return;
      }
      answered = false;
      browser.ping();
    }, this.#keepaliveMs);
    browser.once('close', () => clearInterval(timer));
  }

  /** Caduceus ends the connection, on both sides. */
  end(why: CloseReason): void {
    this.#ending = why;
    this.#browser?.close(why.code, why.reason);
    this.#upstream?.close();
  }

  /** Nobody wants this connection any more (its browser left and the grace is over, or it never arrived), so Hermes's goes too, even if it is still being opened. */
  release(): void {
    this.#ending ??= { code: CLOSE.goingAway, reason: 'The browser closed the connection' };
    this.#upstream?.close();
  }

  #fromHermes(text: string): void {
    const scrubbed = this.#redact(text);
    if (this.#ready === undefined && scrubbed.includes('"gateway.ready"') && isGatewayReady(scrubbed)) this.#ready = scrubbed;
    if (scrubbed.includes('desktop_contract')) {
      const number = desktopContractIn(parseFrame(scrubbed));
      if (number !== undefined) this.#hooks.onDesktopContract(number);
    }
    const verdict = this.#frames.fromHermes(scrubbed);
    if (verdict.forward !== undefined) this.#toBrowser(verdict.forward);
    if (verdict.reply !== undefined) this.#toHermes(verdict.reply);
  }

  /** A frame of Caduceus's own for the browser, if there is one. */
  notify(text: string): void {
    this.#toBrowser(text);
  }

  #toBrowser(text: string): void {
    if (this.#browser?.readyState === WebSocket.OPEN) this.#browser.send(text);
  }

  #toHermes(text: string): void {
    if (this.#upstream?.readyState === WebSocket.OPEN) this.#upstream.send(text);
  }
}

function parseFrame(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isGatewayReady = (text: string) => (parseFrame(text) as { params?: { type?: unknown } } | undefined)?.params?.type === 'gateway.ready';

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const DEFAULT_KEEPALIVE_MS = 30_000;

/** Which upstream a browser socket may take over: the same sign-in, and the same tab (the page names its tab; one that does not is a tab of its own). */
const TAB = /^[A-Za-z0-9_-]{1,64}$/;

export function createGatewayProxy({ backend, policy, openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS, keepaliveMs = DEFAULT_KEEPALIVE_MS, grace, onDesktopContract }: GatewayProxyOptions): GatewayProxy {
  const graceMs = grace?.ms ?? DEFAULT_GRACE_MS;
  const timers = grace?.timers ?? realTimers;
  const browsers = new WebSocketServer({ noServer: true });
  /** Every connection that has been accepted and is not over, by the owner's session: serving a browser, or held. */
  const live = new Map<string, Set<GatewayConnection>>();
  /** The upstreams being held, by sign-in and tab, each with how to cancel the end of its grace. */
  const held = new Map<string, { connection: GatewayConnection; cancel: () => void }>();

  const track = (sessionId: string, connection: GatewayConnection) => {
    const connections = live.get(sessionId) ?? new Set();
    live.set(sessionId, connections.add(connection));
    return () => {
      connections.delete(connection);
      if (connections.size === 0) live.delete(sessionId);
    };
  };

  const stopHolding = (key: string, connection?: GatewayConnection) => {
    const holding = held.get(key);
    if (!holding || (connection && holding.connection !== connection)) return undefined;
    held.delete(key);
    holding.cancel();
    return holding.connection;
  };

  return {
    accept(req, socket, head, { session, source }) {
      // While Hermes is down, answer at once rather than holding the handshake open (the REST proxy does the same).
      if (backend.status.state !== 'ready') return refuseUpgrade(socket, 503);
      const tab = new URL(req.url ?? '/', 'http://caduceus').searchParams.get('tab') ?? '';
      // A page that does not name its tab cannot come back to anything: its upstream goes with its socket.
      const holdable = TAB.test(tab);
      const key = `${session.id}\0${tab}`;

      // The same tab, back within the grace: it takes over the upstream that was held for it.
      const takenOver = holdable ? stopHolding(key) : undefined;
      if (takenOver?.alive) {
        browsers.handleUpgrade(req, socket, head, (browser) => takenOver.attach(browser, true));
        return;
      }
      takenOver?.release();

      let untrack = () => {};
      const connection: GatewayConnection = new GatewayConnection(
        policy.connect({ sessionId: session.id, source }),
        (text) => backend.redact(text),
        keepaliveMs,
        {
          onBrowserGone() {
            if (!holdable || graceMs <= 0 || !connection.alive) return connection.release();
            // Its browser is gone, and the next one of this tab has a grace period to take it over. A tab that goes away twice holds only its latest.
            stopHolding(key)?.release();
            const cancel = timers.start(() => {
              stopHolding(key, connection);
              connection.release();
            }, graceMs);
            held.set(key, { connection, cancel });
          },
          onUpstreamClosed() {
            stopHolding(key, connection);
            untrack();
          },
          onDesktopContract: (number) => onDesktopContract?.(number),
        },
      );
      // However the browser's connection ends, even before the handshake is done, its upstream goes with it, unless it was served and is held.
      untrack = track(session.id, connection);
      socket.once('close', () => {
        if (!connection.joined) {
          untrack();
          connection.release();
        }
      });
      void (async () => {
        const upstream = await backend.openGateway({ handshakeTimeoutMs: openTimeoutMs });
        const { promise: opened, resolve, reject } = Promise.withResolvers<void>();
        upstream.addEventListener('open', () => resolve(), { once: true });
        // A refused connection, or a handshake that Hermes does not answer in time, is followed by a close.
        upstream.addEventListener('close', () => reject(new Error('Hermes closed the gateway before it opened')), { once: true });
        connection.connect(upstream);
        await opened;
        browsers.handleUpgrade(req, socket, head, (browser) => connection.attach(browser));
      })().catch(() => refuseUpgrade(socket, 502));
    },

    closeSession(sessionId, why) {
      for (const connection of live.get(sessionId) ?? []) connection.end(why);
    },

    closeAll(why) {
      for (const connections of live.values()) for (const connection of connections) connection.end(why);
    },

    broadcast(frame) {
      for (const connections of live.values()) for (const connection of connections) connection.notify(frame);
    },
  };
}
