// Terminal mode of the chat (M1 #19): Hermes's own TUI (`hermes --tui`) behind its PTY WebSocket (`/api/pty`), relayed to the browser. The upgrade has passed the
// gate first (`websocket-routes.ts`: the route is a T2, because the TUI reaches a shell, so it needs a step-up grant on the session, and read-only mode closes it).
// Caduceus owns the connection to Hermes: one upstream per Hermes session and profile, opened without Hermes's own keep-alive token, so that the PTY lives exactly as
// long as the upstream does. The upstream outlives the browser's socket for the grace period, which is what lets a reload or a tab switch find the same terminal
// again with what it printed (a ring of the last output, and a redraw request so the TUI repaints whole); once the grace is over the upstream is closed, Hermes
// kills the PTY, and the next screen to ask gets a new TUI on the same session and is told so. The browser speaks the JSON frames of the terminal shell
// (`TerminalClientFrame`, `TerminalServerFrame`), not Hermes's raw bytes. Opening and closing a screen are audited; what is typed and printed never is.
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { GATEWAY_CLOSE, type TerminalServerFrame } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { WebSocket, WebSocketServer } from 'ws';
import type { AuditLog } from './audit-log.ts';
import { DEFAULT_GRACE_MS, type CloseReason, type GraceTimers } from './gateway-proxy.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { refuseUpgrade, type UpgradeContext } from './websocket-routes.ts';

export const PTY_ROUTE = '/api/pty';

export interface PtyProxyOptions {
  backend: HermesBackend;
  audit: AuditLog;
  /** How long a terminal that no screen watches lives on (ten minutes); the tests wind a clock by hand. */
  grace?: { ms?: number; timers?: GraceTimers };
  openTimeoutMs?: number;
  keepaliveMs?: number;
}

export interface PtyProxy {
  accept(req: http.IncomingMessage, socket: Duplex, head: Buffer, context: UpgradeContext): void;
  closeSession(sessionId: string, why: CloseReason): void;
  closeAll(why: CloseReason): void;
}

const DEFAULT_OPEN_TIMEOUT_MS = 30_000;
const DEFAULT_KEEPALIVE_MS = 30_000;
const UNSUPPORTED_DATA = 1003;
/** The output a terminal keeps for a screen that attaches later (Hermes keeps the same, 1 MiB of bytes). */
const SCROLLBACK_CHARS = 1024 * 1024;
const MAX_FRAME_BYTES = 64 * 1024;
/** The terminals Caduceus keeps at once: a TUI is a Python and a Node process. */
const MAX_TERMINALS = 8;
/** How many expired terminals are remembered, so that the screen that comes back is told. */
const MAX_REMEMBERED = 100;
const MAX_COLS = 1000;
const MAX_ROWS = 500;
const DEFAULT_SIZE = { cols: 100, rows: 30 };
/** Control-L: the TUI repaints the whole screen (Hermes's own reattach sends it, since a tail of differential output is not a picture). */
const FORCE_REDRAW = '\x0c';
/** How Hermes closes the socket of a PTY whose process exited (`pty_session.py`). */
const WS_CLOSE_PROCESS_EXITED = 4410;
/** A session id as Hermes writes it, and a profile name. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const realTimers: GraceTimers = {
  start(run, ms) {
    const timer = setTimeout(run, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

interface Viewer {
  browser: WebSocket;
  sessionId: string;
}

interface Terminal {
  key: string;
  resume: string | undefined;
  profile: string | undefined;
  upstream: WebSocket;
  viewers: Set<Viewer>;
  scrollback: string[];
  scrollbackChars: number;
  decoder: StringDecoder;
  cancelGrace: (() => void) | undefined;
}

export function createPtyProxy({ backend, audit, grace, openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS, keepaliveMs = DEFAULT_KEEPALIVE_MS }: PtyProxyOptions): PtyProxy {
  const timers = grace?.timers ?? realTimers;
  const graceMs = grace?.ms ?? DEFAULT_GRACE_MS;
  const browsers = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const terminals = new Map<string, Terminal>();
  /** Terminals whose grace ran out, by key, so that the screen that comes back is told. */
  const expired = new Set<string>();
  /** Terminals Hermes is still opening, by key: two screens asking for the same session at once share the one. */
  const opening = new Map<string, Promise<Terminal>>();
  /** Set once Caduceus itself is stopping: the audit log is closed with it, so what ends now is not written to it. */
  let stopping = false;

  const send = (viewer: Viewer, frame: TerminalServerFrame) => {
    if (viewer.browser.readyState === WebSocket.OPEN) viewer.browser.send(JSON.stringify(frame));
  };
  const broadcast = (terminal: Terminal, frame: TerminalServerFrame) => {
    for (const viewer of terminal.viewers) send(viewer, frame);
  };

  const forget = (terminal: Terminal) => {
    terminal.cancelGrace?.();
    terminal.cancelGrace = undefined;
    if (terminals.get(terminal.key) === terminal) terminals.delete(terminal.key);
  };

  /** The terminal's process is over (or Hermes went away): the viewers are told and let go. */
  const finished = (terminal: Terminal, code: number | undefined) => {
    forget(terminal);
    const exited = code === WS_CLOSE_PROCESS_EXITED;
    broadcast(terminal, { type: 'ended', reason: 'exited' });
    for (const viewer of terminal.viewers) viewer.browser.close(exited ? 1000 : GATEWAY_CLOSE.hermesClosed.code, exited ? 'The terminal ended.' : GATEWAY_CLOSE.hermesClosed.reason);
  };

  /** Nobody watches the terminal: it lives on for the grace period, then its upstream is closed (which is what makes Hermes kill the PTY). */
  const startGrace = (terminal: Terminal, source: string) => {
    if (terminal.viewers.size > 0 || terminals.get(terminal.key) !== terminal) return;
    terminal.cancelGrace = timers.start(() => {
      terminal.cancelGrace = undefined;
      if (terminal.viewers.size > 0 || terminals.get(terminal.key) !== terminal) return;
      expired.add(terminal.key);
      if (expired.size > MAX_REMEMBERED) expired.delete(expired.values().next().value!);
      forget(terminal);
      terminal.upstream.close();
      if (!stopping) audit.record({ actor: 'owner', action: 'terminal-mode.expire', target: terminal.resume ?? 'new session', source, tier: 'T2', profile: terminal.profile });
    }, graceMs);
  };

  const open = async (resume: string | undefined, profile: string | undefined, key: string): Promise<Terminal> => {
    const upstream = await backend.openPty({ resume, profile, handshakeTimeoutMs: openTimeoutMs });
    const { promise: opened, resolve, reject } = Promise.withResolvers<void>();
    upstream.addEventListener('open', () => resolve(), { once: true });
    upstream.addEventListener('close', () => reject(new Error('Hermes closed the terminal before it opened')), { once: true });
    await opened;
    const terminal: Terminal = { key, resume, profile, upstream, viewers: new Set(), scrollback: [], scrollbackChars: 0, decoder: new StringDecoder('utf8'), cancelGrace: undefined };
    upstream.on('message', (data: Buffer, isBinary: boolean) => {
      // Hermes sends the terminal's bytes as binary frames, and a few JSON notes about the session as text (`{"type":"resume"}`); a failure to start is plain text for the screen.
      let text: string;
      if (isBinary) text = terminal.decoder.write(data);
      else {
        const note = data.toString();
        if (note.startsWith('{')) return;
        text = note;
      }
      text = backend.redact(text);
      if (text === '') return;
      terminal.scrollback.push(text);
      terminal.scrollbackChars += text.length;
      while (terminal.scrollbackChars > SCROLLBACK_CHARS && terminal.scrollback.length > 1) terminal.scrollbackChars -= terminal.scrollback.shift()!.length;
      broadcast(terminal, { type: 'output', data: text });
    });
    upstream.on('close', (code) => finished(terminal, code));
    return terminal;
  };

  return {
    accept(req, socket, head, { session, source }) {
      if (backend.status.state !== 'ready') return refuseUpgrade(socket, 503);
      const query = new URL(req.url ?? '/', 'http://caduceus').searchParams;
      const resume = query.get('resume') || undefined;
      const profile = query.get('profile')?.toLowerCase() || undefined;
      const cols = Number(query.get('cols') ?? DEFAULT_SIZE.cols);
      const rows = Number(query.get('rows') ?? DEFAULT_SIZE.rows);
      if ((resume !== undefined && !SESSION_ID.test(resume)) || (profile !== undefined && !PROFILE.test(profile))) return refuseUpgrade(socket, 400);
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || cols > MAX_COLS || rows < 1 || rows > MAX_ROWS) return refuseUpgrade(socket, 400);
      const key = `${profile ?? ''}\0${resume ?? ''}`;

      void (async () => {
        let fresh = false;
        let pending = opening.get(key);
        if (!pending && !terminals.has(key)) {
          if (terminals.size + opening.size >= MAX_TERMINALS) return refuseUpgrade(socket, 503);
          fresh = true;
          pending = open(resume, profile, key)
            .then((made) => {
              terminals.set(key, made);
              return made;
            })
            .finally(() => opening.delete(key));
          opening.set(key, pending);
        }
        const live = (await pending) ?? terminals.get(key);
        if (!live) return refuseUpgrade(socket, 502);
        // A screen that left while Hermes was still opening the terminal takes nothing with it, so the terminal gets its grace like any other.
        if (socket.destroyed) return startGrace(live, source);
        browsers.handleUpgrade(req, socket, head, (browser) => {
          const viewer: Viewer = { browser, sessionId: session.id };
          live.cancelGrace?.();
          live.cancelGrace = undefined;
          live.viewers.add(viewer);
          audit.record({ actor: 'owner', action: 'terminal-mode.open', target: resume ?? 'new session', source, tier: 'T2', profile });
          send(viewer, { type: 'attached', running: true, cols, rows });
          if (fresh) {
            if (expired.delete(key)) send(viewer, { type: 'notice', text: `The terminal Caduceus kept for this session was closed after ${Math.round(graceMs / 60_000)} minutes with no screen watching it. This is a new terminal on the same session.` });
            if (live.upstream.readyState === WebSocket.OPEN) live.upstream.send(`\x1b[RESIZE:${cols};${rows}]`);
          } else {
            if (live.scrollback.length > 0) send(viewer, { type: 'output', data: live.scrollback.join('') });
            // The size of the screen that came back, then a repaint: the replay above is the tail of a differential output.
            if (live.upstream.readyState === WebSocket.OPEN) {
              live.upstream.send(`\x1b[RESIZE:${cols};${rows}]`);
              live.upstream.send(FORCE_REDRAW);
            }
          }
          // A frame over the limit is an `error` event of `ws` before it is a close (1009): the close is what is handled.
          browser.on('error', () => undefined);
          let answered = true;
          browser.on('pong', () => {
            answered = true;
          });
          const keepalive = setInterval(() => {
            if (!answered) return browser.terminate();
            answered = false;
            browser.ping();
          }, keepaliveMs);
          browser.on('message', (data, isBinary) => {
            if (isBinary) return browser.close(UNSUPPORTED_DATA, 'Send JSON text frames.');
            let frame: unknown;
            try {
              frame = JSON.parse(data.toString());
            } catch {
              return browser.close(UNSUPPORTED_DATA, 'Send JSON text frames.');
            }
            if (!isRecord(frame) || live.upstream.readyState !== WebSocket.OPEN) return;
            if (frame.type === 'input' && typeof frame.data === 'string') live.upstream.send(frame.data);
            else if (frame.type === 'resize' && Number.isInteger(frame.cols) && Number.isInteger(frame.rows)) {
              const width = frame.cols as number;
              const height = frame.rows as number;
              if (width >= 1 && width <= MAX_COLS && height >= 1 && height <= MAX_ROWS) live.upstream.send(`\x1b[RESIZE:${width};${height}]`);
            }
          });
          browser.once('close', () => {
            clearInterval(keepalive);
            live.viewers.delete(viewer);
            if (!stopping) audit.record({ actor: 'owner', action: 'terminal-mode.close', target: resume ?? 'new session', source, tier: 'T2', profile });
            startGrace(live, source);
          });
        });
      })().catch(() => refuseUpgrade(socket, 502));
    },

    closeSession(sessionId, why) {
      for (const terminal of terminals.values()) for (const viewer of terminal.viewers) if (viewer.sessionId === sessionId) viewer.browser.close(why.code, why.reason);
    },

    closeAll(why) {
      stopping = true;
      for (const terminal of [...terminals.values()]) {
        forget(terminal);
        terminal.upstream.close();
        for (const viewer of terminal.viewers) viewer.browser.close(why.code, why.reason);
      }
    },
  };
}
