// The page's connection to the terminal shell (`/_caduceus/api/terminal`): it gets the passkey step-up the server will ask for, opens the socket, hands the
// frames on and, when the network drops, reconnects to the same shell (which replays what it printed). Free of the DOM and of React: the socket and the
// passkey prompt are passed in.
import { GATEWAY_CLOSE, type TerminalClientFrame, type TerminalServerFrame } from '@caduceus/contracts/caduceus-api';
import { parseServerFrame } from './terminal-model.ts';

export type TerminalStatus =
  | { state: 'connecting' }
  | { state: 'live' }
  | { state: 'reconnecting' }
  /** Nothing is going on: `reason` says why in words, and Reconnect opens it again. */
  | { state: 'closed'; reason: string };

export interface TerminalConnection {
  send(frame: TerminalClientFrame): void;
  /** Opens the connection again after it closed (asking for the passkey if it must). */
  reconnect(): void;
  close(): void;
}

export interface TerminalConnectionOptions {
  /** The address to open now: it carries the window's current size. */
  url(): string;
  /** `new WebSocket` by default. */
  socketFactory?: (url: string) => WebSocket;
  /**
   * Asks the owner for the passkey (the step-up dialog). Called only after the server refused to open the shell, so the page does not guess whether a grant is
   * still live: the server is the one that knows. Resolves `false` when the owner declines.
   */
  askForGrant(): Promise<boolean>;
  backoff?: { baseDelayMs: number; capMs: number };
  onStatus(status: TerminalStatus): void;
  onFrame(frame: TerminalServerFrame): void;
}

const DEFAULT_BACKOFF = { baseDelayMs: 1000, capMs: 15_000 };
/** How many times in a row a lost connection is tried again by itself before it waits for the owner to press Reconnect. */
const AUTOMATIC_ATTEMPTS = 8;

const NEEDS_PASSKEY = 'Opening the terminal needs your passkey.';
const NOT_OPENED = 'Caduceus did not open the shell. Read-only mode may be on, or the passkey confirmation was not accepted.';
/** The code of a close that is on purpose (RFC 6455 1000). */
const NORMAL_CLOSE = 1000;
const THE_END = 'The terminal ended.';
const NOT_RESTORED = 'The connection to the shell was lost. Press Reconnect to try again.';

/** Why an attempt is made: the first one (or Reconnect), the one after the server refused it and the owner confirmed, or a retry by itself after a drop. */
type Attempt = { kind: 'first' } | { kind: 'asked' } | { kind: 'automatic'; number: number };

export function openTerminalConnection(options: TerminalConnectionOptions): TerminalConnection {
  const { socketFactory = (url: string) => new WebSocket(url), backoff = DEFAULT_BACKOFF } = options;
  let socket: WebSocket | undefined;
  let stopped = false;
  let cancelRetry: (() => void) | undefined;
  /** Bumped by every `connect`, so that an attempt that was overtaken goes quiet. */
  let generation = 0;

  const status = (next: TerminalStatus) => {
    if (!stopped) options.onStatus(next);
  };

  /** One attempt to open the socket. */
  const connect = async (attempt: Attempt): Promise<void> => {
    const mine = ++generation;
    status(attempt.kind === 'automatic' ? { state: 'reconnecting' } : { state: 'connecting' });
    if (attempt.kind === 'asked') {
      const granted = await options.askForGrant();
      if (mine !== generation || stopped) return;
      if (!granted) return status({ state: 'closed', reason: NEEDS_PASSKEY });
    }
    const current = socketFactory(options.url());
    socket = current;
    let opened = false;
    let settled = false;
    /** The terminal said it ended; the Hermes TUI relay then closes the socket normally, which is the end and not a drop (Caduceus stopping closes with 1001, and the page reconnects). */
    let ended = false;
    current.addEventListener('open', () => {
      if (mine !== generation) return current.close();
      opened = true;
      status({ state: 'live' });
    });
    current.addEventListener('message', (event) => {
      if (mine !== generation || typeof event.data !== 'string') return;
      const frame = parseServerFrame(event.data);
      if (!frame) return;
      if (frame.type === 'ended') ended = true;
      else if (frame.type === 'attached' || frame.type === 'restarted') ended = false;
      options.onFrame(frame);
    });
    const retryLater = (number: number) => {
      if (number >= AUTOMATIC_ATTEMPTS) return status({ state: 'closed', reason: NOT_RESTORED });
      status({ state: 'reconnecting' });
      const timer = setTimeout(() => void connect({ kind: 'automatic', number: number + 1 }), Math.min(backoff.capMs, backoff.baseDelayMs * 2 ** Math.min(number, 10)));
      cancelRetry = () => clearTimeout(timer);
    };
    // A refused upgrade shows only as a socket that never opened (a browser fires `error` and then `close`, other WebSockets only `error`).
    const neverOpened = () => {
      if (settled || mine !== generation || stopped) return;
      settled = true;
      // Without a grant (never given, run out, or lost when Caduceus restarted) the server refuses: ask for the passkey, once. A retry after a drop may find Caduceus still
      // starting, so it goes on trying for a while before it says so.
      if (attempt.kind === 'first') void connect({ kind: 'asked' });
      else if (attempt.kind === 'asked') status({ state: 'closed', reason: NOT_OPENED });
      else retryLater(attempt.number);
    };
    current.addEventListener('error', () => {
      if (!opened) neverOpened();
    });
    current.addEventListener('close', (event) => {
      if (mine !== generation || stopped) return;
      if (!opened) return neverOpened();
      settled = true;
      if (event.code === GATEWAY_CLOSE.sessionEnded.code) return status({ state: 'closed', reason: GATEWAY_CLOSE.sessionEnded.reason });
      if (ended && event.code === NORMAL_CLOSE) return status({ state: 'closed', reason: THE_END });
      retryLater(0);
    });
  };

  void connect({ kind: 'first' });

  return {
    send(frame) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
    },
    reconnect() {
      cancelRetry?.();
      socket?.close();
      void connect({ kind: 'first' });
    },
    close() {
      stopped = true;
      generation++;
      cancelRetry?.();
      socket?.close();
    },
  };
}
