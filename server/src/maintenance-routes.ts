// System › Maintenance › Diagnostics (M5 #13): the drained restarts of Hermes and of Caduceus, the live output of Hermes's diagnostic actions (doctor, security
// audit, prompt size, support dump, config migrate: Hermes spawns each and keeps its log, and this relays the log of the latest run as it grows), the install
// facts a bug report needs, and the API reference rendered from the pinned contracts. Nothing is kept: Hermes holds the actions' logs, and the facts and the
// reference are made fresh on every request.
import type { Hono } from 'hono';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import type { CompatibilityReport, InstallFacts } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { apiReference } from './api-reference.ts';
import type { AuditLog } from './audit-log.ts';
import { authClient, type AuthEnv } from './auth-routes.ts';
import { waitForTurns, type Drain } from './drain.ts';
import type { HermesBackend } from './hermes-backend.ts';
import type { HermesContracts } from './hermes-contract.ts';
import { readBody } from './hermes-proxy.ts';
import type { RestPolicy } from './policy.ts';
import type { SelfUpdate } from './self-update.ts';
import { linesAfter } from './update-log.ts';

const MAX_BODY = 1024;
const HEARTBEAT_MS = 20_000;
const MAX_LINE = 2000;
/** How many lines of an action's log one read asks for (the most Hermes gives). */
const LOG_WINDOW = 2000;

/** Hermes's actions whose output the page follows: its names for them (`/api/actions/{name}/status`). The diagnostic ones (M5 #13) and the Backup tab's (M5 #14): backup, restore (`import`) and prune. */
export const ACTION_NAMES: readonly string[] = ['doctor', 'security-audit', 'prompt-size', 'dump', 'config-migrate', 'backup', 'import', 'checkpoints-prune'];

export interface MaintenanceRoutesDeps {
  backend: HermesBackend;
  policy: RestPolicy;
  audit: AuditLog;
  drain: Drain;
  pinned: HermesContracts;
  compatibility(): Promise<CompatibilityReport>;
  /** Reads the version of the checkout Caduceus runs from. */
  selfUpdate: Pick<SelfUpdate, 'version'>;
  /** Ends every page connection and asks the process to restart; without it Caduceus cannot restart itself. */
  restart?: () => Promise<void> | void;
  /** Reads Hermes's status of an action; shared with the restore, which restarts Hermes while a page may still follow the import. */
  actionStatus: ReadActionStatus;
  pollMs: number;
  drainTimeoutMs: number;
}

export interface MaintenanceRoutes {
  closeSession(sessionId: string): void;
  closeAll(): void;
}

export interface ActionStatus {
  running: boolean;
  exitCode: number | null;
  lines: string[];
}

/** What Hermes's own status says about an action, or `undefined` when it did not answer. */
export type ReadActionStatus = (name: string) => Promise<ActionStatus | undefined>;

/**
 * Reads Hermes's status of its actions and keeps the exit code of each run it saw end. Hermes holds an exit code in memory only, so a restarted Hermes
 * answers `exit_code: null` for a run that ended well: a restore restarts Hermes the moment its import ends, while a page may still be following the log,
 * and the page could not tell that run from one Hermes lost. The code is kept with the run's start line in the log (which Hermes writes to a file and
 * keeps) and given back for that run only.
 */
export function createActionStatus(backend: HermesBackend): ReadActionStatus {
  const ended = new Map<string, { started: string; exitCode: number }>();
  return async (name) => {
    let status: ActionStatus;
    try {
      const res = await backend.fetch(`/api/actions/${name}/status?lines=${LOG_WINDOW}`);
      if (!res.ok) return undefined;
      const body: unknown = await res.json();
      if (!isRecord(body)) return undefined;
      status = { running: body.running === true, exitCode: typeof body.exit_code === 'number' ? body.exit_code : null, lines: Array.isArray(body.lines) ? body.lines.map(String) : [] };
    } catch {
      return undefined;
    }
    const started = status.lines.findLast((line) => line.startsWith(`=== ${name} started `));
    if (status.running || started === undefined) return status;
    if (status.exitCode !== null) ended.set(name, { started, exitCode: status.exitCode });
    else if (ended.get(name)?.started === started) return { ...status, exitCode: ended.get(name)!.exitCode };
    return status;
  };
}

/** Hermes appends every run of an action to one log, each starting with `=== <name> started <time> ===`: the lines of the latest run. */
export function latestRun(name: string, lines: readonly string[]): string[] {
  const at = lines.findLastIndex((line) => line.startsWith(`=== ${name} started `));
  return at < 0 ? [...lines] : lines.slice(at + 1);
}

export function mountMaintenanceRoutes(app: Hono<AuthEnv>, deps: MaintenanceRoutesDeps): MaintenanceRoutes {
  const { backend, policy, audit, drain } = deps;
  const open = new Set<{ sessionId: string; close(): void }>();

  app.post('/_caduceus/api/maintenance/restart', async (c) => {
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
    if (!isRecord(request) || Object.keys(request).some((key) => key !== 'target') || (request.target !== 'backend' && request.target !== 'caduceus')) return c.json({ error: 'bad-request', field: 'target' }, 400);
    const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    const { target } = request;
    if (drain.active()) return c.json({ error: 'busy', message: 'Caduceus is already draining for an update or a restart. Wait for it to finish.' }, 409);
    if (target === 'caduceus' && !deps.restart) return c.json({ error: 'unavailable', message: 'Caduceus is not running as the background service here, so it cannot restart itself.' }, 409);
    if (target === 'backend' && backend.status.state !== 'ready') return c.json(backend.status, 503);

    audit.record({ actor: 'owner', action: `maintenance.restart-${target}`, target: target === 'backend' ? 'hermes-backend' : 'caduceus', source: requester.source, tier: 'T2' });
    drain.begin(target === 'backend' ? 'The Hermes backend is restarting.' : 'Caduceus is restarting.');
    // Not awaited: the page watches the drain begin, its connection drop and its connection come back.
    void (async () => {
      try {
        await waitForTurns(backend, { pollMs: deps.pollMs, timeoutMs: deps.drainTimeoutMs, say: () => undefined });
        if (target === 'backend') await backend.restart();
        else {
          // Still draining when the process goes: no turn can start in between. Its restart takes the drain with it.
          await deps.restart!();
          return;
        }
      } catch {
        // A backend that is stopped has nothing to restart; either way the drain must not outlive the attempt.
      }
      drain.end();
    })();
    return c.json({ draining: true }, 202);
  });

  app.get('/_caduceus/api/maintenance/actions/:name/stream', (c) => {
    const name = c.req.param('name');
    if (!ACTION_NAMES.includes(name)) return c.json({ error: 'not-found' }, 404);
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
    const heartbeat = setInterval(() => send('ping', {}), HEARTBEAT_MS);
    const leave = () => {
      if (!live) return false;
      live = false;
      clearInterval(heartbeat);
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
    // Hermes's log is a window that is asked for again and again: each line of the latest run is sent once, as it appears.
    void (async () => {
      let shown: string[] = [];
      let missed = 0;
      while (live) {
        const status = await deps.actionStatus(name);
        if (status) {
          missed = 0;
          const run = latestRun(name, status.lines);
          for (const line of linesAfter(shown, run)) send('line', { text: line.slice(0, MAX_LINE) });
          shown = run;
          if (!status.running) {
            send('end', { ok: status.exitCode === 0 || status.exitCode === null, exitCode: status.exitCode });
            connection.close();
            return;
          }
        } else if (++missed >= 20) {
          send('end', { ok: false, exitCode: null });
          connection.close();
          return;
        }
        await delay(deps.pollMs);
      }
    })();
    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no', connection: 'close' } });
  });

  app.get('/_caduceus/api/maintenance/facts', async (c) => {
    const status = await backend.fetch('/api/status').then(async (res) => (res.ok ? ((await res.json()) as unknown) : undefined)).catch(() => undefined);
    const identity = await backend.fetch('/api/host/identity').then(async (res) => (res.ok ? ((await res.json()) as unknown) : undefined)).catch(() => undefined);
    const compatibility = await deps.compatibility();
    const settled = compatibility.state !== 'checking';
    const facts: InstallFacts = {
      caduceus: { version: await deps.selfUpdate.version(), node: process.version, platform: `${os.type()} ${os.release()}`, arch: os.arch() },
      hermes: { version: isRecord(status) && typeof status.version === 'string' ? status.version : null, state: backend.status.state },
      contracts: {
        pinned: deps.pinned.version,
        hermes: settled ? compatibility.hermesVersion : null,
        state: compatibility.state === 'checking' ? 'checking' : compatibility.state,
        differences: settled ? compatibility.reasons : [],
      },
      host: {
        role: isRecord(identity) && typeof identity.role === 'string' ? identity.role : null,
        protocolVersion: isRecord(identity) && typeof identity.protocolVersion === 'number' ? identity.protocolVersion : null,
        servesSpa: isRecord(identity) && typeof identity.servesSpa === 'boolean' ? identity.servesSpa : null,
      },
    };
    return c.json(facts);
  });

  app.get('/_caduceus/api/maintenance/api-reference', (c) => c.json(apiReference(deps.pinned)));

  return {
    closeSession(sessionId) {
      for (const connection of open) if (connection.sessionId === sessionId) connection.close();
    },
    closeAll() {
      for (const connection of open) connection.close();
    },
  };
}
