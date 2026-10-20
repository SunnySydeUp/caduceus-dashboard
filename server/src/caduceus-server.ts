import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { bodyLimit } from 'hono/body-limit';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAIN_EVENT, GATEWAY_CLOSE, type CompatibilityReport } from '@caduceus/contracts/caduceus-api';
import type { Policy } from '@caduceus/contracts/policy/tiers';
import type { HermesBackend } from './hermes-backend.ts';
import { checkCompatibility, loadPinnedContracts, withDesktopContract, type HermesContracts } from './hermes-contract.ts';
import { contractDrift } from './contract-diff.ts';
import { mountOwnerAuth, type AuthEnv } from './auth-routes.ts';
import { createAuditLog } from './audit-log.ts';
import { mountAuditRoutes } from './audit-routes.ts';
import { createAuthMethodStore } from './auth-methods.ts';
import { createOidcSignIn } from './oidc.ts';
import { mountOidcRoutes } from './oidc-routes.ts';
import { mountAuthMethodRoutes, tailnetIdentityOf } from './auth-method-routes.ts';
import { createBehaviourFiles } from './behaviour-files.ts';
import { createConfirmations } from './confirmations.ts';
import { createDrain } from './drain.ts';
import { execQuickCommandNames } from './exec-quick-commands.ts';
import { contentSecurityPolicy, inlineScriptHashes } from './content-security-policy.ts';
import { createFileGuard } from './file-guard.ts';
import { createGatewayObserver } from './gateway-observer.ts';
import { createGatewayPolicy, type GatewayPolicy } from './gateway-policy.ts';
import { createGatewayProxy, type GatewayProxyOptions } from './gateway-proxy.ts';
import { mountReminders } from './reminders.ts';
import { mountToday } from './today.ts';
import { createBudgetGuard, type BudgetGuard } from './budget-guard.ts';
import { createBudgets } from './budgets.ts';
import { createInbox, mountInbox } from './inbox.ts';
import { createPresence, mountPresence } from './presence.ts';
import { mountPush } from './push.ts';
import { createPushWatcher } from './push-watcher.ts';
import { createActivityFeed, createRunTracker } from './inbox-activity.ts';
import { createCronSource } from './inbox-cron.ts';
import { mountJobNotifications } from './job-notifications.ts';
import { createWorkSource } from './inbox-work.ts';
import { createPairingSource } from './inbox-pairing.ts';
import { createLiveRequests } from './inbox-requests.ts';
import type { InboxSource } from './inbox-source.ts';
import { createSystemSource } from './inbox-system.ts';
import { createKanbanEventsProxy } from './kanban-events-proxy.ts';
import { openCaduceusStore } from './caduceus-store.ts';
import { mountChatBehaviour } from './chat-behaviour.ts';
import { createHealth } from './health.ts';
import { mountChatLimits } from './chat-limits.ts';
import { mountGatewayRoutes } from './gateway-routes.ts';
import { processStartTimes } from './process-start.ts';
import { mountHealthRoutes } from './health-routes.ts';
import { mountLogRoutes } from './log-routes.ts';
import { mountDevicePreferences } from './device-preferences.ts';
import { mountChatPreferences } from './chat-preferences.ts';
import { mountOnboardingPreferences } from './onboarding-preferences.ts';
import { isDraftUpload, mountChatDrafts } from './chat-drafts.ts';
import { mountSavedPrompts } from './saved-prompts.ts';
import { mountProfilePreferences } from './profile-preferences.ts';
import { mountSavedFilters } from './saved-filters.ts';
import { createArtifactCapture } from './artifact-capture.ts';
import { createArtifactStore, mountArtifacts } from './artifacts.ts';
import { createPlaybookEngine } from './playbook-engine.ts';
import { hermesKanban } from './playbook-kanban.ts';
import { createLease } from './playbook-lease.ts';
import { workflowCapabilities } from './playbook-capabilities.ts';
import { mountPlaybookRuns } from './playbook-routes.ts';
import { mountPlaybooks } from './playbooks.ts';
import { createWorkspaceRegistry, mountWorkspaces } from './workspaces.ts';
import { createOwnerAuth } from './owner-auth.ts';
import { mountHermesProxy } from './hermes-proxy.ts';
import { createRestore } from './restore.ts';
import { mcpServerInfo } from './mcp-info.ts';
import { mountMcpRoutes } from './mcp-routes.ts';
import { openMcpToken } from './mcp-token.ts';
import { mountKeyRoutes } from './key-routes.ts';
import { mountHindsightRoutes } from './hindsight.ts';
import { mountNotesRoutes } from './notes.ts';
import { mountPluginRoutes } from './plugin-routes.ts';
import { createConsoleProxy } from './console-proxy.ts';
import { createActionStatus, mountMaintenanceRoutes } from './maintenance-routes.ts';
import { createSelfUpdate, type Deployment } from './self-update.ts';
import { mountUpdateRoutes } from './update-routes.ts';
import { mountPasskeyRoutes } from './passkey-routes.ts';
import { createPolicy } from './policy.ts';
import { mountPolicyRoutes } from './policy-routes.ts';
import { createReadOnlyMode } from './read-only.ts';
import { createPasskeys } from './passkeys.ts';
import { gateUpgrades } from './websocket-routes.ts';
import { createTailnetIdentity } from './tailnet-identity.ts';
import { isSubresourceFile, mountWebApp } from './web-app.ts';
import { createPtyProxy, PTY_ROUTE } from './pty-proxy.ts';
import { createTerminals, TERMINAL_ROUTE, type TerminalOptions } from './terminal.ts';
import { mountRunLog } from './run-log.ts';
import { mountFileOperations } from './file-operations.ts';
import { createShares } from './shares.ts';
import { mountScriptFiles } from './script-files.ts';
import { mountWorkTasks } from './work-tasks.ts';

/** The most a Caduceus API request (`/_caduceus/api/*`) may carry. */
export const API_BODY_LIMIT_BYTES = 64 * 1024;

export interface CaduceusServerOptions {
  backend: HermesBackend;
  /** The Hermes root home (`~/.hermes` in production). Caduceus keeps its own store in its `caduceus/` directory. */
  hermesRoot: string;
  /** The clock sessions expire by and audit entries are stamped with (milliseconds since the epoch). */
  now?: () => number;
  /** When processes started, from the operating system (`ps`); the tests of the restart-to-apply banner set it by hand to say that a gateway restarted. */
  processStartTimes?: (pids: readonly number[]) => Promise<Map<number, number>>;
  /** Port on 127.0.0.1; 0 picks a free one. Caduceus never binds anything but loopback. */
  port?: number;
  /** The HTTPS origin Tailscale Serve exposes Caduceus at (ticket 13), e.g. `https://mac.tailnet.ts.net:9443`. */
  publicOrigin?: string;
  /**
   * The Tailscale logins (`Tailscale-User-Login`) allowed through Tailscale Serve (ticket 13). Once given, a request that came
   * through Serve and does not carry one of them is refused, whatever else it carries; an empty list refuses all of them. A
   * request from this Mac itself is never subject to it. Without it nothing is enforced (development and tests).
   */
  tailnetOwners?: readonly string[];
  /** Told where each request the tailnet identity gate refused came from (`tailnet:<login>` or `forwarded:<address>`); the server itself logs nothing. */
  onTailnetRefusal?: (source: string) => void;
  /**
   * The WebAuthn relying-party ID every passkey is bound to: a hostname that must stay stable. Defaults to
   * `localhost` (development, at `http://localhost:<port>`); ticket 13 sets the tailnet hostname.
   */
  rpId?: string;
  /** The `remindctl` command Today's reminders are read with (a path); found on the PATH by default. A test gives a stand-in. */
  remindctl?: string;
  /** Built web app to serve at `/`. Hermes's own `/` (its token page) is never forwarded. */
  webRoot?: string;
  /** Where the running Hermes is installed (`findHermesInstall`); its published gateway contract is read from there. */
  hermesInstallDir?: string;
  /** The contracts Hermes is checked against; defaults to the pins in the contracts workspace. */
  pinned?: HermesContracts;
  /**
   * The folders Hermes's file endpoints may write to through Caduceus (and the Hermes root home, always). Defaults to the
   * owner's home directory; a write anywhere else is refused (architecture §5, the file-write guard).
   */
  fileRoots?: readonly string[];
  /** The owner's home directory: what `~` means to the file guard, and where it keeps its shell start-up files, SSH and launch agents out of reach of a write. Defaults to this user's. */
  home?: string;
  /**
   * Workspaces beyond the owner's registry (M3 #10) that a raw file write may be a T1 in, rather than a T3. The registry's own
   * entries always count; a test names more here.
   */
  workspaceRoots?: () => readonly string[];
  /**
   * Hermes routes beyond the pinned contract that the policy proxy forwards anyway, as `METHOD /path` with their
   * policy. Anything not pinned is denied; the tests use this for the routes of their stand-in Hermes.
   */
  extraRoutes?: Readonly<Record<string, Policy>>;
  /** How long Hermes has to accept a browser's gateway connection before Caduceus refuses it (502); the tests shorten it. */
  gatewayOpenTimeoutMs?: number;
  /** How often Caduceus pings a browser's gateway connection; one that misses a ping is dropped, and its upstream with it. The tests shorten it. */
  gatewayKeepaliveMs?: number;
  /** How long Caduceus keeps a browser's upstream open after its socket went away (ten minutes), and the timers that measure it; the tests wind a clock by hand. */
  gatewayGrace?: GatewayProxyOptions['grace'];
  /** How long after an answer the live tail of a log, and the worker log of a run, ask Hermes again (1.5 s: architecture §4 says every 1–2 s); the tests shorten it. */
  logPollMs?: number;
  /** How often the Inbox asks Hermes which sessions are waiting on the owner (one second: a request shows within two); the tests shorten it. */
  inboxPollMs?: number;
  /** How often the push watcher looks again with nothing to prompt it (30 s): a lapsed presence, the end of quiet hours, a digest's hour; the tests shorten it. */
  pushTickMs?: number;
  /** Tests only: a push service on this Mac's loopback over plain HTTP is accepted. Production accepts only the browsers' push services over HTTPS. */
  allowLoopbackPush?: boolean;
  /** Told after every look of the push watcher; the tests wait on it. */
  pushLooked?: () => void;
  /**
   * Where Caduceus is deployed (the git checkout the service runs from), for its own update (M5 #12). Without it, or without `restart`, the Updates
   * screen can check Hermes but not update Caduceus.
   */
  deployment?: Deployment;
  /**
   * Restarts this Caduceus process, for after its own update: it is called once every connection of the page has been ended, and the process is
   * expected to stop (the background service starts it again). Only a process that is supervised may give it; development and the tests leave it out or fake it.
   */
  restart?: () => Promise<void> | void;
  /** How often an update asks Hermes about its log and the turns still working (1.5 s); the tests shorten it. */
  updatePollMs?: number;
  /** How long the drain before an update waits for working turns (2 minutes); the tests shorten it. */
  drainTimeoutMs?: number;
  /** How often the Inbox's sources that read Hermes's lists (jobs, pairing requests, Health) ask again, besides when Hermes says they moved (30 s); the tests shorten it. */
  inboxReadMs?: number;
  /** Whether the Inbox asks Hermes if an update is waiting (it asks GitHub through Hermes, at most every half hour). Off unless the caller says so: a test server must not go to the network. */
  hermesUpdateCheck?: boolean;
  /** More sources for the Inbox, beside the ones Caduceus has (a later module's own, or a test's). */
  inboxSources?: readonly InboxSource[];
  /** How often budget usage is read again besides when Hermes says sessions moved (60 s); the tests shorten it. */
  budgetReadMs?: number;
  /** The terminal shell (M7 #05): which program it runs and with what environment, and the grace and idle periods and the timers that measure them. The tests run `/bin/sh` and wind the clock by hand. */
  terminal?: TerminalOptions;
  /** How long the chat's terminal mode (Hermes's TUI behind `/api/pty`, M1 #19) lives on with no screen watching it (ten minutes), and the timers that measure it; the tests wind a clock by hand. */
  terminalModeGrace?: GatewayProxyOptions['grace'];
  /**
   * The playbook engine (M6 #02) advances playbook runs by itself: it reads every board when Hermes says a task changed and every `sweepMs` (15 s).
   * It runs only when this is given, which the service does; a library user and most tests have no use for a worker reading the boards.
   */
  playbookEngine?: { sweepMs?: number; /** Told after every pass over a board; the tests wait on it. */ looked?: (board: string) => void; /** Told after every capture of finished deliverables into Artifacts (M6 #05), with how many files it kept; the tests wait on it. */ captured?: (board: string, kept: number) => void };
  /**
   * The budget guard (M6 #06) reads spend against the budgets every `intervalMs` (one minute; 0 leaves the timer off and a test calls `evaluate`) and pauses
   * unattended work when one is used up. It runs only when this is given, which the service does, like the playbook engine. `ready` is told with the guard.
   */
  budgetGuard?: { intervalMs?: number; failed?: (error: Error) => void; ready?: (guard: BudgetGuard) => void };
  /** How often the shares' expiry sweep runs (ten minutes); a share is also swept before it is read, so this only frees disk on an idle server. */
  shareSweepMs?: number;
}

export interface CaduceusServer {
  readonly url: string;
  /**
   * The policy of the live gateway connection: the per-frame hook the browser WebSocket proxy calls, in both directions,
   * with the owner's session id. Exposed so that a test can judge frames without a socket.
   */
  readonly gatewayPolicy: GatewayPolicy;
  close(): Promise<void>;
}

export async function startCaduceusServer(options: CaduceusServerOptions): Promise<CaduceusServer> {
  const { backend } = options;
  const store = openCaduceusStore(options.hermesRoot);
  const app = new Hono<AuthEnv>();
  // Filled in once the port is known.
  const origins = new Set<string>(options.publicOrigin ? [options.publicOrigin] : []);
  const now = options.now ?? Date.now;
  const audit = createAuditLog(store, now);
  const auth = createOwnerAuth(store, audit, now);
  const tailnet = createTailnetIdentity(options.tailnetOwners, options.onTailnetRefusal);
  // Every answer, a refusal and a file Hermes sent included: never framed by another site (its own PDF previews frame its own files; this is the one defence against a page that frames Caduceus and clicks its confirm
  // buttons), never sniffed into another type, never sent on as a referrer, and held to the content security policy of `content-security-policy.ts`.
  // The one exception is the app's own hashed scripts, styles and fonts (`isSubresourceFile`): a browser loads those only as parts of a page, never shows or runs them as one, so the policy, framing and
  // referrer headers say nothing about them (it still never sniffs them), and they are about 500 bytes on each of the dozens of requests of a first load, which `npm run perf` counts.
  const policyHeader = contentSecurityPolicy(inlineScriptHashes(options.webRoot));
  app.use('*', async (c, next) => {
    await next();
    try {
      c.res.headers.set('X-Content-Type-Options', 'nosniff');
      if (c.res.ok && isSubresourceFile(c.req.path)) return;
      c.res.headers.set('Referrer-Policy', 'no-referrer');
      c.res.headers.set('X-Frame-Options', 'SAMEORIGIN');
      // A route that sends its own policy (an artifact opened on its own address is sandboxed, M6 #05) keeps it, with this added; every other answer gets the app's policy.
      const own = c.res.headers.get('Content-Security-Policy');
      c.res.headers.set('Content-Security-Policy', own ? `${own}; frame-ancestors 'self'` : policyHeader);
    } catch {
      // A response whose headers are fixed (a WebSocket upgrade) is not a page that can be framed.
    }
  });
  // Before everything else, so that a request from a tailnet user who is not the owner reaches nothing at all (no page, no
  // sign-in attempt to throttle, no Hermes). It refuses with `no-store` itself, since the wrappers below only cover two prefixes.
  app.use('*', tailnet.middleware);
  // No cache keeps an answer of the API or of Hermes: they carry the session, passkey ceremonies, step-up and revealed
  // secrets, and everything in them is about the moment it was asked. The service worker caches the app's own files only
  // (`web/src/sw/cache-rules.ts`); this keeps the browser's HTTP cache and any proxy to the same rule. It wraps the gate,
  // so a refusal carries it too.
  for (const prefix of ['/_caduceus/*', '/api/*']) {
    app.use(prefix, async (c, next) => {
      await next();
      c.res.headers.set('Cache-Control', 'no-store');
    });
  }
  // The Caduceus API takes small JSON bodies (a password, a passkey response); a megabyte of it is never one of them.
  // Before the gate and the routes, so that nothing reads a body it will not accept.
  const smallBodies = bodyLimit({ maxSize: API_BODY_LIMIT_BYTES, onError: (c) => c.json({ error: 'payload-too-large', maxBytes: API_BODY_LIMIT_BYTES }, 413) });
  // A draft's attachment is the one body that is larger: its route keeps its own, larger limit.
  app.use('/_caduceus/*', (c, next) => (isDraftUpload(c.req.method, c.req.path) ? next() : smallBodies(c, next)));
  const authMethods = createAuthMethodStore(store);
  mountOwnerAuth(app, auth, audit, origins, (c) => {
    const oidc = authMethods.oidc();
    const tailscale = authMethods.tailscale();
    return {
      ...(oidc.enabled && oidc.config ? { oidcSignIn: { provider: new URL(oidc.config.issuer).host } } : {}),
      ...(tailscale.enabled && tailscale.config && tailnetIdentityOf(c) === tailscale.config.login ? { tailscaleSignIn: true as const } : {}),
    };
  });
  mountAuditRoutes(app, audit, now);
  const passkeys = createPasskeys(store, audit, now, { id: options.rpId ?? 'localhost', origins });
  mountPasskeyRoutes(app, auth, passkeys);
  const oidc = mountOidcRoutes(app, { auth, audit, methods: authMethods, signIn: createOidcSignIn(now), origins });
  mountAuthMethodRoutes(app, { auth, audit, passkeys, methods: authMethods, oidcState: oidc.state });
  mountDevicePreferences(app, store);
  mountProfilePreferences(app, store);
  mountSavedFilters(app, store);
  mountChatPreferences(app, store);
  mountOnboardingPreferences(app, store);
  mountChatBehaviour(app, store);

  app.get('/_caduceus/api/backend', (c) => c.json(backend.status));

  const readOnly = createReadOnlyMode(store, audit);
  mountChatDrafts(app, store, now, { readOnly, backend });
  mountSavedPrompts(app, store, now, readOnly);
  const pinned = options.pinned ?? (await loadPinnedContracts());
  let compatibility: CompatibilityReport = { state: 'checking' };
  let checking = Promise.resolve();
  let checkRun = 0;
  /** The desktop contract number the first session of this launch reported: only a session says it, so the check cannot (M1 #03). */
  let desktopContract: number | undefined;
  // What Caduceus sends a Hermes that has dropped or reshaped what it was built on may not do what it means: stop sending
  // changes until the owner has looked. Only a difference that was read counts, never a contract that could not be read.
  const settle = (report: CompatibilityReport) => {
    compatibility = desktopContract === undefined ? report : withDesktopContract(report, desktopContract);
    if (compatibility.state === 'incompatible' && contractDrift(compatibility).length > 0) readOnly.turnOnAutomatically('contract-mismatch');
  };
  // Every launch may be a different Hermes (say, after `hermes update`), so each one is checked anew.
  const check = () => {
    const run = ++checkRun;
    desktopContract = undefined;
    compatibility = { state: 'checking' };
    checking = checkCompatibility(backend, pinned, options.hermesInstallDir).then((report) => {
      if (run === checkRun) settle(report);
    });
  };
  backend.on('ready', check);
  if (backend.status.state === 'ready') check();

  // The check of a ready backend takes well under a second, so answer with its result rather than "checking".
  const currentCompatibility = async () => {
    if (backend.status.state === 'ready') await checking;
    return compatibility;
  };
  app.get('/_caduceus/api/compatibility', async (c) => c.json(await currentCompatibility()));
  mountChatLimits(app, backend);
  const health = createHealth({ backend, now, compatibility: currentCompatibility, readOnly });
  mountHealthRoutes(app, { health, auth, audit, backend });

  const confirmations = createConfirmations(now);
  // The workspaces the file guard knows are the owner's registry (M3 #10) and any a caller names.
  const workspaces = createWorkspaceRegistry(store);
  const files = createFileGuard({ hermesRoot: options.hermesRoot, roots: options.fileRoots ?? [os.homedir()], home: options.home, workspaces: () => [...(options.workspaceRoots?.() ?? []), ...workspaces.paths()] });
  const policy = createPolicy({ audit, auth, readOnly, confirmations, files, extraRoutes: options.extraRoutes });
  mountPolicyRoutes(app, auth, readOnly, confirmations, policy);
  const drain = createDrain(now);
  const gatewayPolicy = createGatewayPolicy({
    audit,
    drain,
    confirmations,
    readOnly,
    hasStepUp: (sessionId) => auth.hasStepUp(sessionId),
    execQuickCommands: () => execQuickCommandNames(backend),
  });
  // The MCP server's calls (M4 #11) pass the same two policies as the page's, as an actor with no step-up.
  let serverUrl = '';
  mountMcpRoutes(app, {
    backend,
    token: openMcpToken(store.dir),
    audit,
    policy,
    gatewayPolicy,
    info: () => mcpServerInfo({ nodePath: process.execPath, projectRoot: fileURLToPath(new URL('../..', import.meta.url)), url: serverUrl, hermesRoot: options.hermesRoot }),
  });
  const consoleProxy = createConsoleProxy({ backend, audit, openTimeoutMs: options.gatewayOpenTimeoutMs, keepaliveMs: options.gatewayKeepaliveMs });
  const kanbanEvents = createKanbanEventsProxy({ backend, openTimeoutMs: options.gatewayOpenTimeoutMs, keepaliveMs: options.gatewayKeepaliveMs });
  mountGatewayRoutes(app, { backend, store, now, processStartTimes: options.processStartTimes ?? processStartTimes });
  const logRoutes = mountLogRoutes(app, { backend, pollMs: options.logPollMs ?? 1500, policy, audit, files, hermesRoot: options.hermesRoot });
  mountKeyRoutes(app, { backend, policy });
  mountHindsightRoutes(app, { backend, policy, audit, store });
  mountNotesRoutes(app, { backend, policy, audit, store, now });
  const pluginRoutes = mountPluginRoutes(app, { backend, policy, audit });
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
  const selfUpdate = createSelfUpdate(options.deployment ?? { root: projectRoot }, now);
  // Every page is told Caduceus is stopping, and reconnects once it is back; then the process is asked to go.
  const restart = options.restart
    ? async () => {
        gatewayProxy.closeAll(GATEWAY_CLOSE.serverStopping);
        kanbanEvents.closeAll(GATEWAY_CLOSE.serverStopping);
        consoleProxy.closeAll(GATEWAY_CLOSE.serverStopping);
        await options.restart!();
      }
    : undefined;
  const updateRoutes = mountUpdateRoutes(app, {
    backend,
    policy,
    audit,
    store,
    now,
    drain,
    compatibility: currentCompatibility,
    selfUpdate: options.deployment ? selfUpdate : undefined,
    restart,
    pollMs: options.updatePollMs ?? 1500,
    drainTimeoutMs: options.drainTimeoutMs ?? 120_000,
  });
  // One reader for the maintenance routes and the restore: it keeps what each saw of an action's exit code across Hermes's restart.
  const actionStatus = createActionStatus(backend);
  const maintenanceRoutes = mountMaintenanceRoutes(app, {
    backend,
    policy,
    audit,
    drain,
    pinned,
    compatibility: currentCompatibility,
    selfUpdate,
    restart,
    actionStatus,
    pollMs: options.logPollMs ?? 1500,
    drainTimeoutMs: options.drainTimeoutMs ?? 120_000,
  });
  const library = mountPlaybooks(app, { store, backend, policy });
  const kanban = hermesKanban(backend);
  const engine = createPlaybookEngine({
    kanban,
    source: library,
    lease: createLease({ file: path.join(store.dir, 'playbook-engine.lease'), owner: `caduceus-${process.pid}-${randomBytes(4).toString('hex')}`, ttlMs: 30_000, now }),
    capabilities: () => workflowCapabilities(pinned),
    sweepMs: options.playbookEngine?.sweepMs ?? 15_000,
    watch: true,
  });
  mountPlaybookRuns(app, { engine, library, policy, onWrite: kanbanEvents.announceWrite });
  const artifacts = createArtifactStore({ store, now });
  artifacts.sweep();
  mountArtifacts(app, { artifacts, policy, kanban, backend, files });
  const capture = createArtifactCapture({
    kanban,
    source: library,
    artifacts,
    lease: createLease({ file: path.join(store.dir, 'artifact-capture.lease'), owner: `caduceus-${process.pid}-${randomBytes(4).toString('hex')}`, ttlMs: 30_000, now }),
    onFailure: (error) => engine.emit('failure', error),
  });
  engine.on('reconciled', (board) => void capture.pass(board).then((kept) => options.playbookEngine?.captured?.(board, kept)));
  mountWorkTasks(app, { backend, policy, onWrite: kanbanEvents.announceWrite });
  mountScriptFiles(app, { backend, policy });
  mountFileOperations(app, { policy, files, audit, store, backend, now });
  const shares = createShares({ backend, policy, audit, store, now, publicOrigin: options.publicOrigin });
  shares.mount(app);
  shares.sweep();
  const sweepShares = setInterval(shares.sweep, options.shareSweepMs ?? 10 * 60_000);
  sweepShares.unref();
  const runLogs = mountRunLog(app, { backend, pollMs: options.logPollMs ?? 1500 });
  mountWorkspaces(app, { store, registry: workspaces, files, backend, policy });
  const ptyProxy = createPtyProxy({ backend, audit, grace: options.terminalModeGrace, openTimeoutMs: options.gatewayOpenTimeoutMs, keepaliveMs: options.gatewayKeepaliveMs });
  const terminals = createTerminals({ audit, files, options: options.terminal });
  terminals.mount(app, policy);
  const behaviour = createBehaviourFiles({ store, backend, files, now });
  behaviour.mount(app);
  const restore = createRestore({ backend, actionStatus, drain, restart, pollMs: options.logPollMs ?? 1500, drainTimeoutMs: options.drainTimeoutMs ?? 120_000 });
  mountHermesProxy(app, backend, policy, behaviour, restore, kanbanEvents.announceWrite);
  // The observer connection (M2 #01): Caduceus's own standing connection to the gateway, which answers nothing. The Inbox reads Hermes through it.
  const observer = createGatewayObserver(backend);
  const activity = createActivityFeed(now);
  const liveRequests = createLiveRequests({ backend, observer, now, pollMs: options.inboxPollMs ?? 1000, onSessions: createRunTracker(activity, now), onBackgroundDone: (run) => activity.add({ at: now(), profile: run.profile, storedSessionId: run.storedSessionId, title: run.title }) });
  const readMs = options.inboxReadMs ?? 30_000;
  const jobMutes = mountJobNotifications(app, { store, policy });
  const budgets = createBudgets({ backend, store, policy, observer, now, pollMs: options.budgetReadMs ?? 60_000 });
  budgets.mount(app);
  const guard = createBudgetGuard({
    backend,
    store,
    policy,
    budgets,
    lease: createLease({ file: path.join(store.dir, 'budget-guard.lease'), owner: `caduceus-${process.pid}-${randomBytes(4).toString('hex')}`, ttlMs: 30_000, now }),
    now,
    intervalMs: options.budgetGuard?.intervalMs ?? 60_000,
    onFailure: (error) => options.budgetGuard?.failed?.(error),
  });
  guard.mount(app);
  const sources: InboxSource[] = [
    liveRequests,
    budgets.source,
    guard.source,
    createCronSource({ backend, observer, now, pollMs: readMs, mutes: jobMutes }),
    createWorkSource({ backend, now, pollMs: readMs }),
    createPairingSource({ backend, observer, now, pollMs: readMs }),
    createSystemSource({ backend, observer, now, pollMs: readMs, report: () => health.report(), updateEveryMs: 30 * 60_000, checkUpdates: options.hermesUpdateCheck === true }),
    ...(options.inboxSources ?? []),
  ];
  const inbox = createInbox({ sources, activity, runs: liveRequests.runs, store, now, live: () => observer.up });
  const inboxRoutes = mountInbox(app, { inbox, requests: liveRequests, policy });
  mountToday(app, { store, backend, activity, now });
  mountReminders(app, { command: options.remindctl, now });
  const pushSubscriptions = mountPush(app, { store, now, test: (device) => pushWatcher.sendTest(device), policy, allowLoopback: options.allowLoopbackPush === true });
  const presence = createPresence(now);
  mountPresence(app, presence);
  // The push watcher (M2 #03) listens to what the Inbox does and tells the devices that subscribed. The tests give it a short tick and their own clock.
  const pushWatcher = createPushWatcher({ store, subscriptions: pushSubscriptions, inbox, activity, presence, now, tickMs: options.pushTickMs ?? 30_000, subject: 'mailto:caduceus@localhost', allowLoopback: options.allowLoopbackPush === true, looked: options.pushLooked });
  const stopAnnouncing = observer.onStatus(() => inboxRoutes.announce());

  if (options.webRoot) {
    // A share's page is the app shell for whoever it is open for; for a link that is expired, revoked or never was, the shell still draws "not found", with the status to match.
    app.get('/share/:token', async (c, next) => {
      // The parameter is read before the shell answers: afterwards the request is at the shell's route, which has none.
      const token = c.req.param('token');
      await next();
      if (!shares.isOpen(token)) c.res = new Response(c.res.body, { status: 404, headers: c.res.headers });
    });
    mountWebApp(app, options.webRoot);
  }

  const { promise: listening, resolve } = Promise.withResolvers<AddressInfo>();
  // `serve` makes a plain `http.Server` unless it is given another `createServer`.
  const server = serve({ fetch: app.fetch, port: options.port ?? 0, hostname: '127.0.0.1' }, resolve) as http.Server;
  const gatewayProxy = createGatewayProxy({
    backend,
    policy: gatewayPolicy,
    openTimeoutMs: options.gatewayOpenTimeoutMs,
    keepaliveMs: options.gatewayKeepaliveMs,
    grace: options.gatewayGrace,
    onDesktopContract(number) {
      if (number === desktopContract) return;
      desktopContract = number;
      // A check still running has not read the markers: it puts the number on them when it is done.
      if (compatibility.state !== 'checking') settle(compatibility);
    },
  });
  gateUpgrades(server, {
    auth,
    readOnly,
    origins,
    tailnet,
    routes: { '/api/ws': gatewayProxy.accept, '/api/plugins/kanban/events': kanbanEvents.accept, '/api/console': consoleProxy.accept, [PTY_ROUTE]: ptyProxy.accept, [TERMINAL_ROUTE]: terminals.accept },
  });
  // A session that ends (signed out, revoked, expired) takes its live connections with it.
  const stopListening = auth.onSessionEnded((sessionId) => {
    gatewayProxy.closeSession(sessionId, GATEWAY_CLOSE.sessionEnded);
    kanbanEvents.closeSession(sessionId, GATEWAY_CLOSE.sessionEnded);
    logRoutes.closeSession(sessionId);
    runLogs.closeSession(sessionId);
    pluginRoutes.closeSession(sessionId);
    updateRoutes.closeSession(sessionId);
    maintenanceRoutes.closeSession(sessionId);
    consoleProxy.closeSession(sessionId, GATEWAY_CLOSE.sessionEnded);
    ptyProxy.closeSession(sessionId, GATEWAY_CLOSE.sessionEnded);
    terminals.closeSession(sessionId);
    pushSubscriptions.removeForSession(sessionId);
  });
  // Every page is told when the drain begins and ends, as a gateway event of Caduceus's own, so that new turns are not tried in vain.
  const stopDrainEvents = drain.onChange((state) => gatewayProxy.broadcast(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: DRAIN_EVENT, payload: state } })));
  const address = await listening;
  const url = `http://127.0.0.1:${address.port}`;
  serverUrl = url;
  if (options.budgetGuard) {
    options.budgetGuard.ready?.(guard);
    guard.begin();
  }
  if (options.playbookEngine) {
    if (options.playbookEngine.looked) engine.on('reconciled', options.playbookEngine.looked);
    engine.begin();
  }
  origins.add(url).add(`http://localhost:${address.port}`);

  return {
    url,
    gatewayPolicy,
    async close() {
      backend.off('ready', check);
      stopListening();
      stopDrainEvents();
      // Closing the server waits for every connection, and an open WebSocket is one.
      gatewayProxy.closeAll(GATEWAY_CLOSE.serverStopping);
      kanbanEvents.closeAll(GATEWAY_CLOSE.serverStopping);
      logRoutes.closeAll();
      runLogs.closeAll();
      pluginRoutes.closeAll();
      updateRoutes.closeAll();
      maintenanceRoutes.closeAll();
      consoleProxy.closeAll(GATEWAY_CLOSE.serverStopping);
      ptyProxy.closeAll(GATEWAY_CLOSE.serverStopping);
      terminals.closeAll();
      clearInterval(sweepShares);
      const { promise: closed, resolve: done } = Promise.withResolvers<void>();
      server.close(() => done());
      // A stopping server does not wait out a connection that is still open (a live-tail response just ended, a client's idle keep-alive): Node would hold it for its keep-alive timeout.
      server.closeAllConnections();
      await Promise.all([closed, checking]);
      await engine.stop();
      await capture.stop();
      await guard.stop();
      pushWatcher.close();
      store.close();
    },
  };
}
