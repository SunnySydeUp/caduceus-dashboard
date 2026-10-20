import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import type { BackendStatus } from '@caduceus/contracts/caduceus-api';
import { WebSocket } from 'ws';
import { hermesRootHome } from './hermes-root-home.ts';

const WATCHDOG = fileURLToPath(new URL('./hermes-watchdog.mjs', import.meta.url));

/** How to launch Hermes. For the real thing: `{ command: 'hermes' }`. */
export interface LaunchOptions {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  /** Delay before each consecutive restart attempt; the last value repeats. */
  restartDelaysMs?: number[];
  /** The clock that restarts are stamped with (milliseconds since the epoch). The real one by default. */
  now?: () => number;
  /**
   * The directory where the host's one gateway records itself (`hostStateDir`). Hermes answers "is this profile's gateway running?" from that record, so the
   * private rendezvous directory of this backend (see `hermesEnvironment`) shows it. Without it the backend sees no gateway at all.
   */
  sharedHostState?: string;
}

interface BackendEvents {
  ready: [];
  status: [BackendStatus];
  /** Hermes's stderr output, chunk by chunk. */
  log: [string];
}

/**
 * A private Hermes backend on loopback, relaunched whenever it dies.
 * Emits `status` on every transition, `ready` after every successful launch and `log` for Hermes's stderr.
 * The launch secret never leaves this module.
 */
export interface HermesBackend extends EventEmitter<BackendEvents> {
  readonly status: BackendStatus;
  /**
   * When the backend stopped on its own and was started again, oldest first, as far back as the last day (the stamps are
   * on `LaunchOptions.now`). Only the launcher sees every stop, including those before anything else was listening.
   */
  readonly restarts: readonly number[];
  ready(): Promise<void>;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Opens Hermes's JSON-RPC gateway (`/api/ws`), authenticated with the launch secret. A failure to open (the connection
   * is refused, or `handshakeTimeoutMs` passes without Hermes answering) is followed by `close`, as is any later one, so
   * `close` is the event to watch. This is the `ws` client rather than the global `WebSocket`, which never closes a
   * connection that failed to open, and opens a second connection if it is closed while it is still opening.
   */
  openGateway(options?: { handshakeTimeoutMs?: number }): Promise<WebSocket>;
  /**
   * Opens the Kanban plugin's events WebSocket (`/api/plugins/kanban/events`) for one board, from after event `since`,
   * authenticated with the launch secret like `openGateway` and failing the same way (`close` is the event to watch).
   * Without `board` Hermes tails the board that is current. Only these two parameters ever reach Hermes.
   */
  openKanbanEvents(options: { board?: string; since: number; handshakeTimeoutMs?: number }): Promise<WebSocket>;
  /**
   * Opens Hermes's restricted console (`/api/console`, the `hermes>` prompt), authenticated with the launch secret like `openGateway` and failing the
   * same way (`close` is the event to watch). Only `profile` reaches Hermes with it; without one the console works on the profile Hermes has current.
   */
  openConsole(options?: { profile?: string; handshakeTimeoutMs?: number }): Promise<WebSocket>;
  /**
   * Opens Hermes's PTY (`/api/pty`): its TUI, `hermes --tui`, behind a pseudo-terminal, authenticated with the launch secret like `openGateway` and failing the same way
   * (`close` is the event to watch). Frames are the terminal's bytes (and the keystrokes sent to it); a size change is `\x1b[RESIZE:<cols>;<rows>]`. Without `attach` the
   * PTY lives and dies with this socket. Only `resume` (a stored session id) and `profile` reach Hermes with it.
   */
  openPty(options: { resume?: string; profile?: string; handshakeTimeoutMs?: number }): Promise<WebSocket>;
  /**
   * Starts Hermes afresh, now: stops the running one, or skips the wait before the next try, and launches a new one with a
   * new secret, forgetting the backoff and `restarts`. Resolves when the new one is ready. A restart that was asked for is not a stop that
   * was not (`restarts`), and the status passes through `starting`, not `restarting`. Rejects once the backend is stopped.
   */
  restart(): Promise<void>;
  /**
   * Replaces the launch secret, of this launch or an earlier one, wherever `text` holds it. For a text frame from the
   * gateway: `fetch` scrubs what comes back over HTTP, and this does the same for the WebSocket.
   */
  redact(text: string): string;
  /**
   * Runs Hermes's own command line (`hermes <args>`), as the launcher runs `hermes serve`: the same command and environment, so the same
   * `HERMES_HOME`. For what the REST API cannot do (`hermes kanban create` sets a branch, retries and a completion contract). There is no
   * shell, so each argument reaches Hermes as one value; `input` is its standard input. Resolves with how it ended (a command that fails
   * is a result, not a rejection) and rejects only when the command cannot be started or runs past `timeoutMs`. `onOutput` hears what the
   * command prints as it prints it (standard output and error in the order they arrive, secrets replaced), for a log that follows it live;
   * `env` is added to the environment the command runs in.
   */
  runCli(args: readonly string[], options?: { input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; onOutput?(text: string): void }): Promise<CliResult>;
  stop(): Promise<void>;
}

/** How a Hermes command line ended. Anything Hermes printed that held a launch secret has it replaced. */
export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const READY_LINE = /(?<!\w)HERMES_(?:BACKEND|DASHBOARD)_READY port=(\d+)/;
const DEFAULT_RESTART_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000];
/** How long Hermes must stay up after announcing ready before its crash no longer counts toward backoff. */
const STABLE_AFTER_MS = 30_000;
/** How long a restart stays in `restarts`. */
const RESTART_MEMORY_MS = 24 * 60 * 60_000;

/**
 * Hermes's gateway takes agent checkpoints (the ones Workspace › Checkpoints lists) only when this is set in its environment; its `checkpoints.enabled` config is for the CLI.
 * Caduceus turns it on for the Hermes it runs, unless the environment it was started with says otherwise.
 */
const CHECKPOINTS_ON = { HERMES_TUI_CHECKPOINTS: '1' };

/**
 * Where Hermes 0.22 keeps what the operating-system user's profiles share (`_get_lock_dir()` in its `gateway/status.py`): `HERMES_GATEWAY_LOCK_DIR`, else
 * `$XDG_STATE_HOME/hermes/gateway-locks` (an absolute path only), else `~/.local/state/hermes/gateway-locks`.
 */
export function hostStateDir(env: NodeJS.ProcessEnv, homeDir: string = os.homedir()): string {
  if (env.HERMES_GATEWAY_LOCK_DIR) return env.HERMES_GATEWAY_LOCK_DIR;
  const stateHome = env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(homeDir, '.local', 'state');
  return path.join(stateHome, 'hermes', 'gateway-locks');
}

/** Where the link at `file` points, or `undefined` when there is no link there. */
function linkTarget(file: string): string | undefined {
  try {
    return fs.readlinkSync(file);
  } catch {
    return undefined;
  }
}

/** The files of the gateway's role in that directory: its record (who runs it and which profiles it serves) and its lock (whether that process still holds it). */
const GATEWAY_ROLE_FILES = ['host-gateway.json', 'host-gateway.lock'];

/**
 * Hermes 0.22 allows one `hermes serve` per host: a second one attaches to the first or is refused, and the first is recorded in a directory
 * that every profile of the operating-system user shares (`HERMES_GATEWAY_LOCK_DIR`, else `~/.local/state/hermes/gateway-locks`). Caduceus's
 * backend is a private one, so it gets a directory of its own under the Hermes root: it starts whatever else is running, never takes the place
 * of the owner's own server in that record, and the owner's later `hermes dashboard` is never refused behind it. The CLIs Caduceus runs get the
 * same directory, so the ones that look for a backend (`hermes plugins install`) find this one. The environment it was started with wins.
 *
 * The same directory holds the record of the host's one gateway, and Hermes reads a profile that gateway serves as running only from there (a served
 * profile has no gateway files of its own). So the gateway's record and lock are links to the shared ones, and nothing else is: the backend sees the owner's
 * gateway and its singleton lock, not the owner's server. A link to a gateway that has not started yet resolves once it has.
 */
function hermesEnvironment(sharedHostState: string | undefined, ...layers: (NodeJS.ProcessEnv | undefined)[]): NodeJS.ProcessEnv {
  const env = Object.assign({ ...CHECKPOINTS_ON }, process.env, ...layers);
  if (env.HERMES_GATEWAY_LOCK_DIR) return env;
  const privateDir = path.join(hermesRootHome(env), 'caduceus', 'host-state');
  if (sharedHostState !== undefined) {
    fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    for (const name of GATEWAY_ROLE_FILES) {
      const link = path.join(privateDir, name);
      const target = path.join(sharedHostState, name);
      if (linkTarget(link) === target) continue;
      fs.rmSync(link, { force: true });
      fs.symlinkSync(target, link);
    }
  }
  return { HERMES_GATEWAY_LOCK_DIR: privateDir, ...env };
}

export function launchHermesBackend(options: LaunchOptions): HermesBackend {
  return new HermesBackendProcess(options);
}

class HermesBackendProcess extends EventEmitter<BackendEvents> implements HermesBackend {
  readonly #options: LaunchOptions;
  #child: ChildProcess | undefined;
  #secret = '';
  /** Every secret this backend has launched Hermes with: a frame of the previous launch can still arrive after the next has begun. */
  readonly #secrets = new Set<string>();
  #port = 0;
  /** Resolves when the current launch is ready; re-armed whenever a ready backend dies. */
  #readyGate = Promise.withResolvers<void>();
  #failures = 0;
  #readyAt = 0;
  #restartTimer: NodeJS.Timeout | undefined;
  #stopped = false;
  #status: BackendStatus = { state: 'starting' };
  #restarts: number[] = [];
  /** Children `restart()` has stopped on purpose: their exit is not a crash, and `restart()` itself launches the next. */
  readonly #retired = new WeakSet<ChildProcess>();
  #restarting: Promise<void> | undefined;

  constructor(options: LaunchOptions) {
    super();
    this.#options = options;
    this.#launch();
  }

  get status(): BackendStatus {
    return this.#status;
  }

  get restarts(): readonly number[] {
    return this.#restarts;
  }

  ready(): Promise<void> {
    return this.#readyGate.promise;
  }

  /** Calls the backend with the launch secret attached; the secret is scrubbed from whatever comes back. */
  async fetch(path: string, init?: RequestInit): Promise<Response> {
    await this.ready();
    const secret = this.#secret;
    const headers = new Headers(init?.headers);
    headers.set('x-hermes-session-token', secret);
    const upstream = await fetch(`http://127.0.0.1:${this.#port}${path}`, { ...init, headers });

    const scrubbed = new Headers();
    for (const [name, value] of upstream.headers) {
      // fetch() already decoded the body and redaction changes its length.
      if (name === 'content-length' || name === 'content-encoding') continue;
      scrubbed.append(name, value.replaceAll(secret, REDACTED));
    }
    return new Response(upstream.body?.pipeThrough(redactBytes(secret)) ?? null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: scrubbed,
    });
  }

  redact(text: string): string {
    let redacted = text;
    for (const secret of this.#secrets) redacted = redacted.replaceAll(secret, REDACTED);
    return redacted;
  }

  async runCli(args: readonly string[], { input, timeoutMs = 30_000, env, onOutput }: { input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; onOutput?(text: string): void } = {}): Promise<CliResult> {
    const child = spawn(this.#options.command, [...(this.#options.args ?? []), ...args], {
      env: hermesEnvironment(this.#options.sharedHostState, this.#options.env, env),
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(timeoutMs),
    });
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    // A multi-byte character can be split between two chunks: one decoder per stream keeps it whole.
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const heard = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      chunks[stream].push(chunk);
      if (onOutput) onOutput(this.redact(decoders[stream].write(chunk)));
    };
    child.stdout.on('data', (chunk: Buffer) => heard('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => heard('stderr', chunk));
    // A command that never reads its input closes the pipe early; that is not an error of ours.
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? '');
    const { promise, resolve, reject } = Promise.withResolvers<CliResult>();
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout: this.redact(Buffer.concat(chunks.stdout).toString('utf8')), stderr: this.redact(Buffer.concat(chunks.stderr).toString('utf8')) }));
    return promise;
  }

  async openGateway({ handshakeTimeoutMs }: { handshakeTimeoutMs?: number } = {}): Promise<WebSocket> {
    return this.#openSocket('/api/ws', '', handshakeTimeoutMs);
  }

  async openKanbanEvents({ board, since, handshakeTimeoutMs }: { board?: string; since: number; handshakeTimeoutMs?: number }): Promise<WebSocket> {
    const query = new URLSearchParams({ since: String(since) });
    if (board) query.set('board', board);
    return this.#openSocket('/api/plugins/kanban/events', `&${query}`, handshakeTimeoutMs);
  }

  async openConsole({ profile, handshakeTimeoutMs }: { profile?: string; handshakeTimeoutMs?: number } = {}): Promise<WebSocket> {
    return this.#openSocket('/api/console', profile ? `&profile=${encodeURIComponent(profile)}` : '', handshakeTimeoutMs);
  }

  async openPty({ resume, profile, handshakeTimeoutMs }: { resume?: string; profile?: string; handshakeTimeoutMs?: number }): Promise<WebSocket> {
    const query = new URLSearchParams();
    if (resume) query.set('resume', resume);
    if (profile) query.set('profile', profile);
    return this.#openSocket('/api/pty', query.size > 0 ? `&${query}` : '', handshakeTimeoutMs);
  }

  async #openSocket(route: string, extraQuery: string, handshakeTimeoutMs: number | undefined): Promise<WebSocket> {
    await this.ready();
    // On a loopback bind Hermes accepts its session token as `?token=` (hermes-protocol.md §2.3).
    const socket = new WebSocket(`ws://127.0.0.1:${this.#port}${route}?token=${encodeURIComponent(this.#secret)}${extraQuery}`, { handshakeTimeout: handshakeTimeoutMs });
    // An `error` event that nobody listens for is thrown in `ws`; what a caller acts on is the `close` that follows it.
    socket.on('error', () => undefined);
    return socket;
  }

  restart(): Promise<void> {
    // A second request while one is under way is the same restart: two launches would leave a Hermes nobody supervises.
    this.#restarting ??= this.#restart().finally(() => {
      this.#restarting = undefined;
    });
    return this.#restarting;
  }

  async #restart(): Promise<void> {
    if (this.#stopped) throw new Error('The Hermes backend is stopped.');
    clearTimeout(this.#restartTimer);
    this.#failures = 0;
    // A fresh start: what stopped the Hermes before it is no news about this one.
    this.#restarts = [];
    const child = this.#child;
    // Requests wait for the new launch, as they do after a crash.
    if (this.#status.state === 'ready') this.#readyGate = Promise.withResolvers<void>();
    this.#setStatus({ state: 'starting' });
    if (child && child.exitCode === null && child.signalCode === null) {
      this.#retired.add(child);
      const { promise: exited, resolve } = Promise.withResolvers<void>();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      await exited;
    }
    if (this.#stopped) throw new Error('The Hermes backend was stopped while it restarted.');
    this.#launch();
    return this.#readyGate.promise;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#restartTimer);
    this.#setStatus({ state: 'stopped' });
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const { promise: exited, resolve } = Promise.withResolvers<void>();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    await exited;
  }

  #setStatus(status: BackendStatus): void {
    this.#status = status;
    this.emit('status', status);
  }

  #launch(): void {
    this.#secret = randomBytes(32).toString('base64url');
    this.#secrets.add(this.#secret);
    // Hermes runs under a watchdog that stops it if this process dies without cleaning up.
    // The watchdog's stdin pipe is held open (never written) as the parent-alive signal.
    const child = spawn(
      process.execPath,
      [WATCHDOG, this.#options.command, ...(this.#options.args ?? []), 'serve', '--host', '127.0.0.1', '--port', '0'],
      {
        env: hermesEnvironment(this.#options.sharedHostState, this.#options.env, { HERMES_DASHBOARD_SESSION_TOKEN: this.#secret }),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.#child = child;

    let output = '';
    let announced = false;
    child.stdout!.on('data', (chunk: Buffer) => {
      if (announced || this.#retired.has(child)) return;
      output += chunk.toString();
      const match = READY_LINE.exec(output);
      if (!match) return;
      announced = true;
      this.#port = Number(match[1]);
      this.#readyAt = performance.now();
      this.#readyGate.resolve();
      this.#setStatus({ state: 'ready' });
      this.emit('ready');
    });

    // Always drain stderr: an unread pipe fills and Hermes stalls on its next log write without exiting.
    child.stderr!.on('data', (chunk: Buffer) => this.emit('log', chunk.toString()));

    child.once('exit', () => {
      const wasReady = this.#status.state === 'ready';
      if (this.#stopped || this.#retired.has(child)) return;
      if (wasReady) this.#readyGate = Promise.withResolvers<void>();
      // Only a run that stayed up resets the backoff; a crash right after ready still counts as failing.
      if (wasReady && performance.now() - this.#readyAt >= STABLE_AFTER_MS) this.#failures = 0;
      const now = (this.#options.now ?? Date.now)();
      this.#restarts = [...this.#restarts.filter((at) => now - at < RESTART_MEMORY_MS), now];
      const delays = this.#options.restartDelaysMs ?? DEFAULT_RESTART_DELAYS_MS;
      const delay = delays[Math.min(this.#failures, delays.length - 1)];
      this.#failures += 1;
      this.#setStatus({ state: 'restarting', attempt: this.#failures, retryInMs: delay });
      this.#restartTimer = setTimeout(() => this.#launch(), delay);
    });
  }
}

const REDACTED = '[redacted]';

/** Replaces every occurrence of `secret` in a byte stream, including occurrences split across chunks. */
function redactBytes(secret: string): TransformStream<Uint8Array, Uint8Array> {
  const needle = Buffer.from(secret);
  const mask = Buffer.from(REDACTED);
  let carry = Buffer.alloc(0);
  return new TransformStream({
    transform(chunk, controller) {
      const input = Buffer.concat([carry, chunk]);
      const parts: Buffer[] = [];
      let from = 0;
      for (let at = input.indexOf(needle); at !== -1; at = input.indexOf(needle, from)) {
        parts.push(input.subarray(from, at), mask);
        from = at + needle.length;
      }
      parts.push(input.subarray(from));
      const output = Buffer.concat(parts);
      // Hold back a tail that could be the start of a secret completed by the next chunk.
      const keep = Math.min(needle.length - 1, output.length);
      controller.enqueue(output.subarray(0, output.length - keep));
      carry = output.subarray(output.length - keep);
    },
    flush(controller) {
      if (carry.length) controller.enqueue(carry);
    },
  });
}
