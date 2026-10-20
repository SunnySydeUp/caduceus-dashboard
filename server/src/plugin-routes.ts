// Installing and updating a Hermes plugin with a live log (M5 #11). Hermes's own routes for both (`POST /api/dashboard/agent-plugins/install`
// and `…/{name}/update`) answer once, when everything is done, and say nothing while a clone or a `pip install` runs. Hermes's command line
// does the same work (`hermes plugins install|update` share their code with those routes) and prints as it goes, so Caduceus runs the command
// on the Mac that runs Hermes and relays its output to whoever watches, event by event (server-sent events, as the log tail does).
//
// The browser sends only a few checked fields; the command line is built here as a fixed list of arguments (no shell, `--` before the
// address, so a value that starts with a dash is still a value). Nothing about a plugin is kept: Hermes holds the plugin and its enabled
// state, the list is read from Hermes each time, and an operation is only the log of a command that ran (the last ten, in memory).
// Enabling, disabling and removing are Hermes's own routes (T1) and do not come through here.
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { AuditLog } from './audit-log.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import type { RestPolicy } from './policy.ts';

const MAX_BODY = 4096;
/** How long a clone and the dependencies it brings may take before Caduceus stops waiting for the command. */
const COMMAND_TIMEOUT_MS = 20 * 60_000;
/** How often a quiet log says it is alive: a proxy between Caduceus and the browser drops a connection that is silent for long. */
const HEARTBEAT_MS = 20_000;
/** The lines of one log that are kept, and the longest one: a runaway command cannot fill memory. */
const MAX_LINES = 2000;
const MAX_LINE = 2000;
/** Finished operations that are remembered, so a tab that reopens can still read the log it was following. */
const KEEP_FINISHED = 10;

/** A bare name such as `strava`: an entry of Hermes's curated catalogue. Anything else is a git address. */
const CATALOGUE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}){0,3}$/;
const COMMIT = /^[0-9a-f]{40}$/i;

/** Credentials in the address (`https://user:token@host/repo`) are never kept, logged or shown. */
export const withoutCredentials = (text: string): string => text.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@]+@/g, '$1');

interface Command {
  args: string[];
  action: 'plugins.install' | 'plugins.update';
  /** What the audit entry names: the address with no credentials, or the plugin's name. */
  target: string;
  verb: 'install' | 'update';
}

/** The command a request asks for, or the name of the field that is wrong. */
function commandOf(request: unknown): { ok: true; command: Command } | { ok: false; field: string } {
  if (!isRecord(request)) return { ok: false, field: '(body)' };
  const known = request.action === 'install' ? ['action', 'identifier', 'catalogue', 'ref', 'force', 'enable'] : ['action', 'name'];
  for (const key of Object.keys(request)) if (!known.includes(key)) return { ok: false, field: key };
  if (request.action === 'update') {
    const { name } = request;
    if (typeof name !== 'string' || !PLUGIN_NAME.test(name) || name.includes('..')) return { ok: false, field: 'name' };
    return { ok: true, command: { args: ['plugins', 'update', '--', name], action: 'plugins.update', target: name, verb: 'update' } };
  }
  if (request.action !== 'install') return { ok: false, field: 'action' };
  const { identifier, catalogue, ref, force, enable } = request;
  if (typeof identifier !== 'string' || identifier.length === 0 || identifier.length > 500 || /[\s\0]/.test(identifier) || identifier.startsWith('-')) return { ok: false, field: 'identifier' };
  if (catalogue !== undefined && typeof catalogue !== 'boolean') return { ok: false, field: 'catalogue' };
  // A bare word is Hermes's catalogue and an address is a git repository: the page says which it means, so one is never taken for the other.
  const bare = CATALOGUE_NAME.test(identifier);
  if ((catalogue === true) !== bare) return { ok: false, field: 'identifier' };
  if (ref !== undefined && (typeof ref !== 'string' || !COMMIT.test(ref))) return { ok: false, field: 'ref' };
  if ((force !== undefined && typeof force !== 'boolean') || (enable !== undefined && typeof enable !== 'boolean')) return { ok: false, field: force !== undefined && typeof force !== 'boolean' ? 'force' : 'enable' };
  return {
    ok: true,
    command: {
      args: ['plugins', 'install', ...(force === true ? ['--force'] : []), ...(ref ? ['--ref', ref] : []), enable === false ? '--no-enable' : '--enable', '--', identifier],
      action: 'plugins.install',
      target: withoutCredentials(identifier),
      verb: 'install',
    },
  };
}

/** How an operation ended: `ok`, the exit code (null when the command could not run), and a sentence for the owner. */
export interface OperationEnd {
  ok: boolean;
  code: number | null;
  message: string;
}

type Event = { kind: 'line'; text: string } | { kind: 'end'; end: OperationEnd };

interface Operation {
  id: string;
  lines: string[];
  /** What the command printed since its last line end. */
  partial: string;
  end?: OperationEnd;
  listeners: Set<(event: Event) => void>;
}

/** The sentence a failed command is judged by: the last thing Hermes called an error, else the last thing it said. */
function reasonOf(lines: readonly string[]): string {
  const said = lines.map((line) => line.trim()).filter(Boolean);
  const error = said.findLast((line) => /^(Error|Blocked)\b/.test(line));
  return (error ?? said.at(-1) ?? 'Hermes stopped without saying why.').slice(0, 300);
}

export interface PluginRoutesDeps {
  backend: HermesBackend;
  policy: RestPolicy;
  audit: AuditLog;
}

export interface PluginRoutes {
  /** Ends the streams of a session that ended. */
  closeSession(sessionId: string): void;
  /** Ends every stream: the server is stopping. */
  closeAll(): void;
}

export function mountPluginRoutes(app: Hono<AuthEnv>, { backend, policy, audit }: PluginRoutesDeps): PluginRoutes {
  const operations = new Map<string, Operation>();
  const open = new Set<{ sessionId: string; close(): void }>();

  const emit = (operation: Operation, event: Event) => {
    for (const listener of operation.listeners) listener(event);
  };
  const addLine = (operation: Operation, text: string) => {
    const line = withoutCredentials(text).slice(0, MAX_LINE);
    if (operation.lines.length >= MAX_LINES) return;
    operation.lines.push(line);
    emit(operation, { kind: 'line', text: line });
  };
  const heard = (operation: Operation, text: string) => {
    const pieces = (operation.partial + text).split(/\r\n|\n|\r/);
    operation.partial = pieces.pop() ?? '';
    for (const piece of pieces) addLine(operation, piece);
  };
  const finish = async (operation: Operation, command: Command, run: Promise<{ code: number }>) => {
    let end: OperationEnd;
    try {
      const { code } = await run;
      if (operation.partial !== '') addLine(operation, operation.partial);
      operation.partial = '';
      end = code === 0 ? { ok: true, code, message: `Hermes finished the ${command.verb}.` } : { ok: false, code, message: reasonOf(operation.lines) };
    } catch (error) {
      end = { ok: false, code: null, message: error instanceof Error && error.name === 'TimeoutError' ? `Hermes was still working after ${COMMAND_TIMEOUT_MS / 60_000} minutes, so Caduceus stopped waiting.` : 'Caduceus could not run the Hermes command.' };
    }
    // Hermes keeps the list of plugins it built a moment ago for five seconds, and only its own routes forget it: this one changes nothing and does.
    await backend.fetch('/api/dashboard/plugin-providers', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);
    operation.end = end;
    emit(operation, { kind: 'end', end });
    const finished = [...operations.values()].filter((other) => other.end);
    for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) operations.delete(old.id);
  };

  app.post('/_caduceus/api/plugins/operations', async (c) => {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare('POST', url.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    const raw = await readBody(c.req.raw, MAX_BODY);
    if (raw === 'too-large') return c.json({ error: 'bad-request' }, 400);
    let request: unknown;
    try {
      request = raw.length === 0 ? undefined : JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      request = undefined;
    }
    const parsed = commandOf(request);
    if (!parsed.ok) return c.json({ error: 'bad-request', field: parsed.field }, 400);
    const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);
    if ([...operations.values()].some((other) => !other.end)) return c.json({ error: 'busy', message: 'Hermes is already installing or updating a plugin. Wait for it to finish.' }, 409);

    const { command } = parsed;
    const operation: Operation = { id: crypto.randomUUID(), lines: [], partial: '', listeners: new Set() };
    operations.set(operation.id, operation);
    audit.record({ actor: 'owner', action: command.action, target: command.target, source: requester.source, tier: 'T3', profile: 'default' });
    // A wide console, so Hermes does not break its lines at 80 columns; unbuffered, so a line is heard when it is printed.
    const run = backend.runCli(command.args, { timeoutMs: COMMAND_TIMEOUT_MS, env: { COLUMNS: '120', PYTHONUNBUFFERED: '1', NO_COLOR: '1' }, onOutput: (text) => heard(operation, text) });
    void finish(operation, command, run);
    return c.json({ id: operation.id }, 202);
  });

  app.get('/_caduceus/api/plugins/operations/:id/stream', (c) => {
    const operation = operations.get(c.req.param('id'));
    if (!operation) return c.json({ error: 'not-found' }, 404);
    const encoder = new TextEncoder();
    let live = true;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(started) {
        controller = started;
      },
      cancel: () => void leave(),
    });
    const send = (event: string, data: unknown) => {
      if (live) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };
    const listener = (event: Event) => {
      if (event.kind === 'line') send('line', { text: event.text });
      else {
        send('end', event.end);
        connection.close();
      }
    };
    const heartbeat = setInterval(() => send('ping', {}), HEARTBEAT_MS);
    const leave = () => {
      if (!live) return false;
      live = false;
      clearInterval(heartbeat);
      operation.listeners.delete(listener);
      open.delete(connection);
      return true;
    };
    const connection = {
      sessionId: c.get('session')!.id,
      close() {
        if (leave()) controller.close();
      },
    };
    open.add(connection);
    // What was printed before this tab came is replayed first, then the listener hears the rest: no await in between, so no line is missed or heard twice.
    for (const text of operation.lines) send('line', { text });
    if (operation.end) {
      send('end', operation.end);
      connection.close();
    } else operation.listeners.add(listener);
    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no', connection: 'close' } });
  });

  return {
    closeSession(sessionId) {
      for (const connection of open) if (connection.sessionId === sessionId) connection.close();
    },
    closeAll() {
      for (const connection of open) connection.close();
    },
  };
}
