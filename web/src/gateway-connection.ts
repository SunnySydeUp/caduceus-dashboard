// The page's live connection to Hermes's gateway, through the Caduceus server (M0 #09). It owns Hermes's shared client
// (`@hermes/shared`: heartbeat, replay by sequence number, the `client.capabilities` handshake on every connect) and the
// part the shared client leaves to its owner: when to dial again. It tracks what the app bar's dot shows, and tells
// whoever shows live data when to load it afresh. No DOM and no React: the page's own pieces (WebSocket, fetch) are passed in.
import { GATEWAY_CLOSE, type BackendStatus } from '@caduceus/contracts/caduceus-api';
import { JsonRpcGatewayClient, type GatewayEvent, type WebSocketLike } from '@caduceus/contracts/hermes/shared/gateway';
import { isStableOpen, reconnectBackoffDelayMs, type ReconnectBackoffOptions } from '@caduceus/contracts/hermes/shared/reconnect-backoff';

/** The app bar's realtime dot. */
export type ConnectionState = 'connected' | 'reconnecting' | 'offline';

export interface GatewayStatus {
  state: ConnectionState;
  /** Which reconnect this is, counted from 1 since the connection was lost; 0 while connected, and for the first connect. */
  attempt: number;
  /** In plain words, why the page is not connected; absent while it is. */
  reason?: string;
}

/** Said at every `gateway.ready`, the first frame of every connection: what the page should load afresh. */
export interface GatewayReady {
  /** Hermes's replay epoch: it changes whenever Hermes starts. */
  epoch: string | undefined;
  /** The page has been connected before, so things may have changed while it was away (global change events are not replayed). */
  reconnected: boolean;
  /** Hermes has restarted since the page was last connected: what the page holds about sessions is stale, and its sequence numbers meaningless. */
  restarted: boolean;
}

/** What Caduceus's own answer says about why the gateway cannot be reached. */
export type Diagnosis = { kind: 'signed-out' } | { kind: 'unreachable' } | { kind: 'backend'; status: BackendStatus };

/** What the page knows about the private Hermes backend. */
export interface BackendView {
  /** Its lifecycle; `undefined` until Caduceus has said. */
  status: BackendStatus | undefined;
  /** Caduceus itself did not answer. */
  unreachable: boolean;
}

export interface GatewayConnectionOptions {
  /** The `ws://` or `wss://` address of Caduceus's gateway route. */
  url: string;
  /** Opens a socket; the page's own WebSocket unless a test needs one that carries its cookie. */
  socketFactory?: (url: string) => WebSocketLike;
  /** Asks Caduceus why the gateway cannot be reached, after a dial failed or a connection dropped. */
  diagnose(): Promise<Diagnosis>;
  /** The owner's session ended: sign in again. Called once, and the connection stops trying. */
  onSignedOut?(): void;
  /** The delay before each reconnect attempt: Hermes's own ladder (full jitter, 300 ms to 15 s) unless a test says otherwise. */
  backoff?: ReconnectBackoffOptions;
  /** How long a liveness check on a connection that looks open waits for Hermes's answer. */
  probeTimeoutMs?: number;
}

export interface GatewayConnection {
  readonly status: GatewayStatus;
  readonly backend: BackendView;
  /** Hermes's shared client, for the requests, events and server requests of whoever shows live data. */
  readonly client: JsonRpcGatewayClient;
  /** Calls `listener` whenever the status or the backend view changes. Returns how to stop listening. */
  subscribe(listener: () => void): () => void;
  /** Calls `handler` at every `gateway.ready`, the first and every one after a reconnect. Returns how to stop. */
  onReady(handler: (ready: GatewayReady) => void): () => void;
  /** Dials now if the connection is down; checks that it still answers if it looks up. */
  reconnect(): void;
  /**
   * Calls a method that needs a typed confirmation (a Tier 3 such as `rollback.restore`). The token (`POST /_caduceus/api/policy/confirmations`, operation
   * `rpc <method>`) goes in the frame's `caduceus` field, where the policy proxy reads it and takes it out before Hermes sees the frame.
   */
  requestConfirmed<T>(method: string, params: Record<string, unknown>, token: string, timeoutMs?: number): Promise<T>;
  close(): void;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * Asks Caduceus about the Hermes backend, to say why a dial failed. `get` is `fetch` of the Caduceus API, as the page
 * would call it. A 401 means the session ended; no answer, or one that is not Caduceus's, means Caduceus is not reachable.
 */
export async function diagnoseBackend(get: (route: string) => Promise<Response>): Promise<Diagnosis> {
  let res: Response;
  try {
    res = await get('/_caduceus/api/backend');
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 401) return { kind: 'signed-out' };
  if (!res.ok) return { kind: 'unreachable' };
  try {
    return { kind: 'backend', status: await res.json() };
  } catch {
    return { kind: 'unreachable' };
  }
}

const sameStatus = (a: GatewayStatus, b: GatewayStatus) => a.state === b.state && a.attempt === b.attempt && a.reason === b.reason;

export function createGatewayConnection(options: GatewayConnectionOptions): GatewayConnection {
  return new Connection(options);
}

class Connection implements GatewayConnection {
  readonly client: JsonRpcGatewayClient;
  readonly #options: GatewayConnectionOptions;
  #status: GatewayStatus = { state: 'reconnecting', attempt: 0, reason: 'Connecting to Hermes.' };
  #backend: BackendView = { status: undefined, unreachable: false };
  readonly #listeners = new Set<() => void>();
  readonly #readyHandlers = new Set<(ready: GatewayReady) => void>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  /** Which dial the client's current socket belongs to: a late event of an earlier socket is not about this one. */
  #generation = 0;
  /** The dial whose loss has been handled, so that a close and a failed connect are one loss. */
  #lostGeneration = 0;
  /** Failed or short-lived connections in a row: the rung of the backoff ladder. */
  #failures = 0;
  #attempt = 0;
  #openedAt: number | null = null;
  #epoch: string | undefined;
  #connectedBefore = false;
  /** How the last socket closed, as its close frame said. */
  #lastClose: { code: number; reason: string } | undefined;

  constructor(options: GatewayConnectionOptions) {
    this.#options = options;
    this.client = new JsonRpcGatewayClient({
      socketFactory: (url) => {
        const socket = options.socketFactory?.(url) ?? new WebSocket(url);
        const send = socket.send.bind(socket);
        socket.send = (data) => send(typeof data === 'string' ? this.#stamped(data) : data);
        socket.addEventListener('close', (event) => {
          this.#lastClose = { code: event.code, reason: event.reason };
        });
        return socket;
      },
    });
    this.client.onState((state) => {
      if (state === 'closed') this.#lost();
    });
    this.client.on('gateway.ready', (event) => this.#ready(event));
    void this.#dial();
  }

  /** The one frame the next send of `method` carries a confirmation in (`requestConfirmed`). */
  #confirming: { method: string; token: string } | undefined;

  requestConfirmed<T>(method: string, params: Record<string, unknown>, token: string, timeoutMs?: number): Promise<T> {
    this.#confirming = { method, token };
    try {
      // The frame is written, and so stamped, before `request` returns.
      return this.client.request<T>(method, params, timeoutMs);
    } finally {
      this.#confirming = undefined;
    }
  }

  #stamped(text: string): string {
    const confirming = this.#confirming;
    if (!confirming || !text.includes(`"method":"${confirming.method}"`)) return text;
    this.#confirming = undefined;
    return JSON.stringify({ ...JSON.parse(text), caduceus: { confirmation: confirming.token } });
  }

  get status(): GatewayStatus {
    return this.#status;
  }

  get backend(): BackendView {
    return this.#backend;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onReady(handler: (ready: GatewayReady) => void): () => void {
    this.#readyHandlers.add(handler);
    return () => this.#readyHandlers.delete(handler);
  }

  reconnect(): void {
    if (this.#stopped) return;
    const state = this.client.connectionState;
    if (state === 'connecting') return;
    if (state === 'open') {
      // The socket may have died while the page slept without anyone saying so: ask, rather than wait for the heartbeat.
      this.client.request('gateway.ping', {}, this.#options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS).catch(() => this.client.invalidate('Hermes did not answer.'));
      return;
    }
    clearTimeout(this.#timer);
    void this.#dial();
  }

  close(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.client.close();
  }

  async #dial(): Promise<void> {
    if (this.#stopped) return;
    const generation = ++this.#generation;
    try {
      await this.client.connect(this.#options.url);
    } catch {
      if (generation === this.#generation) this.#lost('Could not connect.');
      return;
    }
    if (generation === this.#generation) this.#openedAt = Date.now();
  }

  /** The connection is down, or a dial failed: say so, work out why, and dial again after a backoff. */
  #lost(reason = 'The connection dropped.'): void {
    if (this.#stopped || this.#lostGeneration === this.#generation) return;
    this.#lostGeneration = this.#generation;
    const closed = this.#lastClose;
    this.#lastClose = undefined;
    if (closed?.code === GATEWAY_CLOSE.sessionEnded.code) {
      this.#signedOut();
      return;
    }
    if (isStableOpen(this.#openedAt)) this.#failures = 0;
    this.#openedAt = null;
    this.#attempt += 1;
    // A page already known to be offline stays offline while it fails again, and only counts the attempt: flipping back to
    // "reconnecting" until the next diagnosis would make the dot and the banner flicker at every dial.
    this.#setStatus(this.#status.state === 'offline' ? { ...this.#status, attempt: this.#attempt } : { state: 'reconnecting', attempt: this.#attempt, reason: closed?.reason || reason });
    this.#timer = setTimeout(() => void this.#dial(), reconnectBackoffDelayMs(this.#failures++, this.#options.backoff));
    void this.#diagnose(this.#generation);
  }

  async #diagnose(generation: number): Promise<void> {
    const diagnosis = await this.#options.diagnose();
    // A later dial may have connected, or lost again, while Caduceus was being asked.
    if (this.#stopped || generation !== this.#generation || this.#status.state === 'connected') return;
    if (diagnosis.kind === 'signed-out') {
      this.#signedOut();
      return;
    }
    if (diagnosis.kind === 'unreachable') {
      this.#setBackend({ status: this.#backend.status, unreachable: true });
      this.#setStatus({ state: 'offline', attempt: this.#attempt, reason: 'Caduceus is not reachable.' });
      return;
    }
    const { status } = diagnosis;
    this.#setBackend({ status, unreachable: false });
    if (status.state === 'stopped') {
      this.#setStatus({ state: 'offline', attempt: this.#attempt, reason: 'The Hermes backend has stopped.' });
    } else if (status.state === 'starting' || status.state === 'restarting') {
      this.#setStatus({ state: 'reconnecting', attempt: this.#attempt, reason: status.state === 'starting' ? 'Hermes is starting.' : 'Hermes is restarting.' });
    } else {
      this.#setStatus({ ...this.#status, state: 'reconnecting' });
    }
  }

  #signedOut(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.client.close();
    this.#setStatus({ state: 'offline', attempt: this.#attempt, reason: GATEWAY_CLOSE.sessionEnded.reason });
    this.#options.onSignedOut?.();
  }

  #ready(event: GatewayEvent<'gateway.ready'>): void {
    const epoch = event.payload?.replay_epoch || undefined;
    const ready: GatewayReady = { epoch, reconnected: this.#connectedBefore, restarted: this.#epoch !== undefined && epoch !== undefined && epoch !== this.#epoch };
    this.#epoch = epoch ?? this.#epoch;
    this.#connectedBefore = true;
    this.#attempt = 0;
    this.#setBackend({ status: { state: 'ready' }, unreachable: false });
    this.#setStatus({ state: 'connected', attempt: 0 });
    for (const handler of this.#readyHandlers) handler(ready);
  }

  #setStatus(status: GatewayStatus): void {
    if (sameStatus(this.#status, status)) return;
    this.#status = status;
    this.#listeners.forEach((listener) => listener());
  }

  #setBackend(backend: BackendView): void {
    if (this.#backend.unreachable === backend.unreachable && JSON.stringify(this.#backend.status) === JSON.stringify(backend.status)) return;
    this.#backend = backend;
    this.#listeners.forEach((listener) => listener());
  }
}
