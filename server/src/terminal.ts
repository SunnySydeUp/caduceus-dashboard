// The terminal shell (M7 #05): a real `$SHELL` in a PTY, run by the Caduceus server itself, since Hermes only exposes its own TUI over
// `/api/pty`. The upgrade passes the gate first (`websocket-routes.ts`: the route is a T2, so it needs a step-up grant on the session, and
// read-only mode closes it). A shell belongs to a folder, not to a browser: every viewer that asks for the same folder watches the same
// shell, and the shell keeps its last output (the scrollback) so that a viewer that comes back sees where it was. It outlives a dropped
// connection for the grace period, ends when nothing was typed for the idle period, and is killed when Caduceus stops. Start, end and
// restart are audited with the folder, the device and the profile; what is typed and printed never is.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Context, Hono } from 'hono';
import type { IPty } from 'node-pty';
import pty from 'node-pty';
import { WebSocket, WebSocketServer } from 'ws';
import { GATEWAY_CLOSE, type TerminalServerFrame } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuditLog } from './audit-log.ts';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { FileGuard } from './file-guard.ts';
import type { GraceTimers } from './gateway-proxy.ts';
import { readBody } from './hermes-proxy.ts';
import type { RestPolicy } from './policy.ts';
import { refuseUpgrade, type UpgradeHandler } from './websocket-routes.ts';

export const TERMINAL_ROUTE = '/_caduceus/api/terminal';
/** How long a shell that nobody watches lives on: a phone that lost its connection, or a tab that reloads, comes back in this time. */
export const DEFAULT_TERMINAL_GRACE_MS = 10 * 60_000;
/** How long a shell may sit with nothing typed before it ends, watched or not: a shell left open on a screen is a standing way into the Mac. */
export const DEFAULT_TERMINAL_IDLE_MS = 30 * 60_000;
/** The output a shell keeps for a viewer that attaches later. */
const SCROLLBACK_CHARS = 256 * 1024;
/** The most one frame from a viewer may carry (a paste is the largest thing a person sends). */
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_RESTART_BODY = 4_096;
const DEFAULT_SIZE = { cols: 80, rows: 24 };
const MAX_COLS = 1000;
const MAX_ROWS = 500;

export interface TerminalOptions {
  /** The program to run; the owner's `$SHELL` by default. The tests run `/bin/sh`. */
  shell?: string;
  /** Its arguments: a login shell by default, so that the shell finds the PATH of the owner's own terminal (a background service has a bare one). */
  args?: readonly string[];
  /** The environment the shell starts with; Caduceus's own by default. Whatever the source, `CADUCEUS_*` is never passed on. */
  env?: NodeJS.ProcessEnv;
  graceMs?: number;
  idleMs?: number;
  /** Measures the grace and idle periods (the tests wind a clock by hand). */
  timers?: GraceTimers;
}

export interface TerminalDeps {
  audit: AuditLog;
  files: FileGuard;
  options?: TerminalOptions;
}

export interface Terminals {
  /** The upgrade handler of `TERMINAL_ROUTE`. */
  accept: UpgradeHandler;
  /** Mounts the Restart route. */
  mount(app: Hono<AuthEnv>, policy: RestPolicy): void;
  /** Closes the viewers of a session that ended; the shells go on for the grace period. */
  closeSession(sessionId: string): void;
  /** Caduceus is stopping: every shell is killed and every viewer closed. */
  closeAll(): void;
}

interface Viewer {
  socket: WebSocket;
  sessionId: string;
}

interface Shell {
  cwd: string;
  profile: string | undefined;
  /** Who started it, as the audit log names the device; the end of the shell is audited under it. */
  source: string;
  proc: IPty | undefined;
  viewers: Set<Viewer>;
  scrollback: string[];
  scrollbackChars: number;
  cols: number;
  rows: number;
  cancelIdle: (() => void) | undefined;
  cancelGrace: (() => void) | undefined;
}

const realTimers: GraceTimers = {
  start(run, ms) {
    const timer = setTimeout(run, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

/**
 * node-pty 1.1.0 ships its macOS helper without the executable bit, and `npm install` does not set it; without it no shell starts
 * (`posix_spawnp failed`). Set it once, before the first shell.
 */
let helperChecked = false;
function ensureSpawnHelper(): void {
  if (helperChecked) return;
  helperChecked = true;
  if (process.platform !== 'darwin') return;
  const root = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  const helper = path.join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
  try {
    fs.accessSync(helper, fs.constants.X_OK);
  } catch {
    fs.chmodSync(helper, 0o755);
  }
}

function sizeOf(cols: unknown, rows: unknown): { cols: number; rows: number } | undefined {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return undefined;
  const size = { cols: cols as number, rows: rows as number };
  return size.cols >= 1 && size.cols <= MAX_COLS && size.rows >= 1 && size.rows <= MAX_ROWS ? size : undefined;
}

export function createTerminals({ audit, files, options = {} }: TerminalDeps): Terminals {
  const timers = options.timers ?? realTimers;
  const graceMs = options.graceMs ?? DEFAULT_TERMINAL_GRACE_MS;
  const idleMs = options.idleMs ?? DEFAULT_TERMINAL_IDLE_MS;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const shells = new Map<string, Shell>();
  const byKey = (cwd: string) => shells.get(cwd);

  const send = (viewer: Viewer, frame: TerminalServerFrame) => {
    if (viewer.socket.readyState === WebSocket.OPEN) viewer.socket.send(JSON.stringify(frame));
  };
  const broadcast = (shell: Shell, frame: TerminalServerFrame) => {
    for (const viewer of shell.viewers) send(viewer, frame);
  };

  /** A folder a shell may start in: one the file guard lets Caduceus browse, that is a directory. */
  const resolveCwd = (raw: string | null): { ok: true; cwd: string } | { ok: false; status: 400 | 403 | 404 } => {
    const check = files.check(raw === null || raw === '' ? os.homedir() : raw, 'browse');
    if (!check.ok) return { ok: false, status: check.reason === 'bad-path' ? 400 : 403 };
    try {
      // The guard has resolved links (a link out of the allowed folders fails it), so this is the folder itself.
      return fs.statSync(check.path).isDirectory() ? { ok: true, cwd: check.path } : { ok: false, status: 404 };
    } catch {
      return { ok: false, status: 404 };
    }
  };

  const environment = (): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.env ?? process.env)) {
      if (value !== undefined && !name.startsWith('CADUCEUS_')) env[name] = value;
    }
    return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  };

  const remember = (shell: Shell, data: string) => {
    shell.scrollback.push(data);
    shell.scrollbackChars += data.length;
    while (shell.scrollbackChars > SCROLLBACK_CHARS && shell.scrollback.length > 1) shell.scrollbackChars -= shell.scrollback.shift()!.length;
  };

  /** Restarts the idle clock: called when a shell starts and at every keystroke. */
  const touch = (shell: Shell) => {
    shell.cancelIdle?.();
    shell.cancelIdle = timers.start(() => end(shell, 'idle'), idleMs);
  };

  /** Starts the shell's process in its folder. */
  const spawn = (shell: Shell) => {
    ensureSpawnHelper();
    const proc = pty.spawn(options.shell ?? process.env.SHELL ?? '/bin/zsh', [...(options.args ?? ['-l'])], {
      name: 'xterm-256color',
      cols: shell.cols,
      rows: shell.rows,
      cwd: shell.cwd,
      env: environment(),
    });
    shell.proc = proc;
    proc.onData((data) => {
      if (shell.proc !== proc) return;
      remember(shell, data);
      broadcast(shell, { type: 'output', data });
    });
    proc.onExit(({ exitCode }) => {
      // The process of a shell that was restarted or ended on purpose is already gone from it.
      if (shell.proc === proc) end(shell, 'exited', exitCode);
    });
    touch(shell);
  };

  /** The shell's process is over: kill what is left of it, say why, and forget the shell when nobody is watching. */
  const end = (shell: Shell, reason: Extract<TerminalServerFrame, { type: 'ended' }>['reason'], code?: number) => {
    const proc = shell.proc;
    if (!proc) return;
    shell.proc = undefined;
    shell.cancelIdle?.();
    shell.cancelIdle = undefined;
    if (reason !== 'exited') proc.kill();
    const why = { exited: 'exited', idle: 'idle timeout', abandoned: 'nobody watched it', stopping: 'Caduceus stopped' }[reason];
    audit.record({ actor: 'owner', action: 'terminal.end', target: `${shell.cwd} (${why})`, source: shell.source, tier: 'T2', profile: shell.profile });
    broadcast(shell, { type: 'ended', reason, ...(code === undefined ? {} : { code }) });
    if (shell.viewers.size === 0) forget(shell);
  };

  const forget = (shell: Shell) => {
    shell.cancelGrace?.();
    shell.cancelGrace = undefined;
    if (byKey(shell.cwd) === shell) shells.delete(shell.cwd);
  };

  const detach = (shell: Shell, viewer: Viewer) => {
    shell.viewers.delete(viewer);
    if (shell.viewers.size > 0) return;
    if (!shell.proc) return forget(shell);
    shell.cancelGrace = timers.start(() => {
      shell.cancelGrace = undefined;
      if (shell.viewers.size === 0) end(shell, 'abandoned');
    }, graceMs);
  };

  const start = (cwd: string, profile: string | undefined, source: string, size: { cols: number; rows: number }): Shell => {
    const shell: Shell = { cwd, profile, source, proc: undefined, viewers: new Set(), scrollback: [], scrollbackChars: 0, ...size, cancelIdle: undefined, cancelGrace: undefined };
    shells.set(cwd, shell);
    spawn(shell);
    audit.record({ actor: 'owner', action: 'terminal.start', target: cwd, source, tier: 'T2', profile });
    return shell;
  };

  const accept: UpgradeHandler = (req, socket, head, { session, source }) => {
    const query = new URL(req.url ?? '/', 'http://caduceus').searchParams;
    const cwd = resolveCwd(query.get('cwd'));
    if (!cwd.ok) return refuseUpgrade(socket, cwd.status);
    const size = (query.has('cols') || query.has('rows') ? sizeOf(Number(query.get('cols')), Number(query.get('rows'))) : DEFAULT_SIZE) ?? undefined;
    if (!size) return refuseUpgrade(socket, 400);
    const profile = query.get('profile')?.toLowerCase() || undefined;
    let shell = byKey(cwd.cwd);
    try {
      shell ??= start(cwd.cwd, profile, source, size);
    } catch {
      return refuseUpgrade(socket, 500);
    }
    const attached = shell;
    sockets.handleUpgrade(req, socket, head, (browser) => {
      const viewer: Viewer = { socket: browser, sessionId: session.id };
      attached.cancelGrace?.();
      attached.cancelGrace = undefined;
      attached.viewers.add(viewer);
      send(viewer, { type: 'attached', cwd: attached.cwd, running: attached.proc !== undefined, cols: attached.cols, rows: attached.rows });
      if (attached.scrollback.length > 0) send(viewer, { type: 'output', data: attached.scrollback.join('') });
      browser.on('message', (data, isBinary) => {
        if (isBinary) return browser.close(1003, 'Send JSON text frames.');
        let frame: unknown;
        try {
          frame = JSON.parse(data.toString());
        } catch {
          return browser.close(1003, 'Send JSON text frames.');
        }
        if (!isRecord(frame)) return;
        const proc = attached.proc;
        if (frame.type === 'input' && typeof frame.data === 'string' && proc) {
          touch(attached);
          proc.write(frame.data);
        } else if (frame.type === 'resize' && proc) {
          const next = sizeOf(frame.cols, frame.rows);
          if (!next) return;
          attached.cols = next.cols;
          attached.rows = next.rows;
          proc.resize(next.cols, next.rows);
        }
      });
      browser.once('close', () => detach(attached, viewer));
    });
  };

  return {
    accept,

    mount(app, policy) {
      app.post(`${TERMINAL_ROUTE}/restart`, async (c: Context<AuthEnv, string>) => {
        const url = new URL(c.req.url);
        const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
        const prepared = policy.prepare('POST', url.pathname, requester);
        if (!prepared.allow) return c.json(prepared.body, prepared.status);
        const raw = await readBody(c.req.raw, MAX_RESTART_BODY);
        if (raw === 'too-large') return c.json({ error: 'bad-request' }, 400);
        let body: unknown;
        try {
          body = raw.length === 0 ? undefined : JSON.parse(Buffer.from(raw).toString('utf8'));
        } catch {
          body = undefined;
        }
        const given = isRecord(body) && typeof body.cwd === 'string' ? body.cwd : undefined;
        if (given === undefined) return c.json({ error: 'bad-request' }, 400);
        const cwd = resolveCwd(given);
        if (!cwd.ok) return c.json({ error: cwd.status === 404 ? 'not-a-folder' : 'outside-roots' }, cwd.status);
        const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
        if (!decision.allow) return c.json(decision.body, decision.status);
        const shell = byKey(cwd.cwd);
        if (!shell) return c.json({ error: 'no-shell' }, 404);
        // The old process goes first, silently: its exit is a restart, not the end of the shell the viewers are watching.
        const old = shell.proc;
        shell.proc = undefined;
        old?.kill();
        shell.scrollback = [];
        shell.scrollbackChars = 0;
        spawn(shell);
        audit.record({ actor: 'owner', action: 'terminal.restart', target: shell.cwd, source: requester.source, tier: 'T1', profile: shell.profile });
        broadcast(shell, { type: 'restarted' });
        return c.json({ restarted: true, cwd: shell.cwd });
      });
    },

    closeSession(sessionId) {
      for (const shell of shells.values()) for (const viewer of shell.viewers) if (viewer.sessionId === sessionId) viewer.socket.close(GATEWAY_CLOSE.sessionEnded.code, GATEWAY_CLOSE.sessionEnded.reason);
    },

    closeAll() {
      for (const shell of [...shells.values()]) {
        end(shell, 'stopping');
        for (const viewer of shell.viewers) viewer.socket.close(GATEWAY_CLOSE.serverStopping.code, GATEWAY_CLOSE.serverStopping.reason);
        forget(shell);
      }
    },
  };
}
