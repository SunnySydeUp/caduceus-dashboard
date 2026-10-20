// The Caduceus server's own API (`/_caduceus/api/*`), shared by the server and the web app.
import type { Appearance } from './appearance.ts';
import type { ChipPreference } from './chat-chips.ts';
import type { OnboardingProgress } from './onboarding.ts';
import type { DeniedReason, Tier } from './policy/tiers.ts';

/** `GET /_caduceus/api/backend`: the private Hermes backend's lifecycle. */
export type BackendStatus =
  | { state: 'starting' }
  | { state: 'ready' }
  | { state: 'restarting'; attempt: number; retryInMs: number }
  | { state: 'stopped' };

export type BackendState = BackendStatus['state'];

/** The gateway's compatibility markers (architecture §6). */
export interface GatewayMarkers {
  /** `gateway.ready` carries a `replay_epoch` (resume after a Hermes restart). */
  replayEpoch: boolean;
  /** `gateway.ready.heartbeat`: the gateway answers `gateway.ping`. */
  heartbeat: boolean;
  /** `gateway.ready.change_events`: the gateway broadcasts `*.changed` events. */
  changeEvents: boolean;
  /** The `gateway.capabilities` result. */
  capabilities: Record<string, unknown>;
  /** `session.info.desktop_contract`; `null` until a session has been seen (Hermes reports it only per session). */
  desktopContract: number | null;
}

/** Contract entries that differ from the pin, named `METHOD /path` (REST) or `method|event|server request <name>` (gateway). */
export interface ContractChanges {
  added: string[];
  removed: string[];
  /** Entries whose shape changed, with the changed parts in brackets, e.g. `GET /api/status (parameters)`. */
  changed: string[];
}

/**
 * `GET /_caduceus/api/compatibility`: whether the running Hermes matches the contracts Caduceus was built against.
 * Additions never make Hermes incompatible; removals, changes and lost markers do.
 */
export type CompatibilityReport =
  | { state: 'checking' }
  | {
      state: 'compatible' | 'incompatible';
      pinnedVersion: string;
      /** The running Hermes's version, `null` if its REST contract could not be read. */
      hermesVersion: string | null;
      /** Why Hermes is incompatible; empty when compatible. */
      reasons: string[];
      rest: ContractChanges;
      gateway: ContractChanges;
      markers: { pinned: GatewayMarkers; live: GatewayMarkers | null };
    };

/** Why Caduceus turned read-only mode on by itself: Hermes no longer matches the contracts Caduceus was built for. */
export type ReadOnlyReason = 'contract-mismatch';

/** `GET /_caduceus/api/policy/read-only`: whether read-only mode is on, and, if Caduceus turned it on itself, why. */
export interface ReadOnlyState {
  readOnly: boolean;
  /** Present while read-only mode is on because Caduceus turned it on itself; the owner turning it on or off clears it. */
  automatic?: ReadOnlyReason;
}

/** The subsystems Health reports on, in the order it lists them. */
export type SubsystemId = 'caduceus' | 'backend' | 'gateway' | 'scheduler' | 'dispatcher' | 'activity' | 'providers' | 'egress' | 'host';

/**
 * How a subsystem is doing: `ok`; `degraded` (working, but something needs a look); `down` (not working);
 * `unknown` (Caduceus could not find out, because Hermes did not answer or has nothing to report yet).
 */
export type SubsystemState = 'ok' | 'degraded' | 'down' | 'unknown';

/** One subsystem in `GET /_caduceus/api/health`, as of the moment Caduceus asked. */
export interface Subsystem {
  id: SubsystemId;
  name: string;
  state: SubsystemState;
  /** In plain words, why it is in that state. */
  reason: string;
  /** What to do about it, in plain words. Present whenever the subsystem is not `ok`. */
  suggestion?: string;
  /** When Caduceus asked (ISO 8601). Nothing is cached: every report is a fresh question. */
  checkedAt: string;
  /** The readings behind the state, for the details. */
  facts: { label: string; value: string }[];
  /** Readings that are a share of a limit (host resources), 0 to 100. */
  meters?: { label: string; percent: number }[];
}

export type RepairSeverity = 'critical' | 'warning' | 'info';

/** A one-tap fix for a Repair: `POST /_caduceus/api/health/fixes/<id>`, which needs a step-up (tier T2). */
export interface RepairFix {
  id: 'restart-backend';
  label: string;
  tier: 'T2';
}

/** A problem Caduceus found: how bad, what is wrong and why, and a fix where there is one. */
export interface Repair {
  /** Stable for a condition (`gateway-not-running`), so a screen can tell the same problem from a new one. */
  id: string;
  severity: RepairSeverity;
  subsystem: SubsystemId;
  title: string;
  cause: string;
  /** Present when the problem has come back: it went away and returned within the window Caduceus watches. `times` counts its separate appearances in the last `windowHours`. */
  recurring?: { times: number; windowHours: number };
  fix?: RepairFix;
  /** Where in Caduceus the owner can deal with it, when that is not a one-tap fix (the Gateway screen, for a gateway that is down). */
  link?: { label: string; to: string };
}

/** `GET /_caduceus/api/chat/limits`: how long Hermes waits for the owner (a clarify answer) in the profile asked about; 0 or less is for ever. */
export interface ChatLimits {
  clarifyTimeoutS: number;
}

/** `GET /_caduceus/api/health`: every subsystem, and the Repairs they add up to (critical first). */
export interface HealthReport {
  checkedAt: string;
  subsystems: Subsystem[];
  repairs: Repair[];
}

/** `GET /_caduceus/api/auth/session`: whether an owner exists and whether this browser is signed in. Public. */
export interface AuthState {
  ownerExists: boolean;
  /** No owner yet and this request came from this Mac itself (loopback, not through a forwarding proxy). */
  setupAllowed: boolean;
  signedIn: boolean;
  /** The owner has a password, so the sign-in screen offers it; a passkey-only owner has none. */
  passwordSignIn: boolean;
  /** Present only when sign-in with the owner's OIDC identity provider is on: the sign-in screen offers it, named by `provider` (the provider's host). */
  oidcSignIn?: { provider: string };
  /** Present only when Tailscale identity sign-in is on and this request came through Serve as the configured tailnet login. */
  tailscaleSignIn?: true;
}

/** What `GET /_caduceus/api/auth/methods` says about the extra sign-in methods (Settings › Security). Secrets are never in it. */
export interface AuthMethods {
  password: { enabled: boolean };
  passkeys: { count: number };
  oidc: {
    enabled: boolean;
    issuer: string | null;
    clientId: string | null;
    /** Whether a client secret is kept; its value never leaves Caduceus. */
    hasSecret: boolean;
    /** The one identity that may sign in: an email address or the provider's subject. */
    allowedUser: string | null;
    /** The address to register at the provider as the redirect URI of this Caduceus. */
    redirectUri: string;
  };
  tailscale: { enabled: boolean; login: string | null };
  /** The tailnet login this very request carries through Tailscale Serve; `null` from this Mac or any request that did not come through Serve. */
  tailnetIdentity: string | null;
}

/** One audit log entry (`GET /_caduceus/api/audit`, newest first). */
export interface AuditEntry {
  /** ISO 8601 time. */
  at: string;
  /** `owner`; `anonymous` for a request that is not (yet) the owner's; `caduceus` for what Caduceus did by itself (read-only mode on a mismatch). */
  actor: string;
  /**
   * What happened, e.g. `session.sign-in`, `session.sign-in-passkey`, `session.step-up`, `session.revoke`,
   * `passkey.register`; for a request through the policy proxy, the Hermes operation (`DELETE /api/profiles/{name}`) or
   * gateway method (`rpc session.delete`), or `policy.denied` for one that was refused.
   */
  action: string;
  /** What it happened to: `owner` (the account), `session:<id>`, `passkey:<credential id>` or, for a Hermes request, its path. */
  target: string;
  /** Where the request came from: `local` (this Mac), `tailnet:<login>` (Tailscale Serve) or `forwarded:<address>`. */
  source: string;
  /** The risk tier of the action; set for the actions that have one (T1 and above, and denied requests). */
  tier?: Tier;
  /** The Hermes profile the action worked on; absent when it names none (Hermes's default scope, or not a Hermes action). */
  profile?: string;
}

/** An entry of the audit log as the viewer reads it (`GET /_caduceus/api/audit/entries`): the entry with the number it has in the log, which is also its cursor. */
export interface AuditRow extends AuditEntry {
  id: number;
}

/** `GET /_caduceus/api/audit/entries`: a page of the entries that match the filters, newest first. */
export interface AuditPage {
  entries: AuditRow[];
  /** How many entries match the filters in all, not only on this page. */
  total: number;
  /** Pass as `before` to read the next (older) page; absent on the last. */
  nextBefore?: number;
}

/** A passkey the owner can sign in and step up with (`GET /_caduceus/api/auth/passkeys`). */
export interface Passkey {
  /** The WebAuthn credential ID (base64url). */
  id: string;
  /** The owner's name for it, e.g. "iPhone" (1–64 characters). */
  name: string;
  /** ISO 8601 times. */
  createdAt: string;
  /** `null` until the passkey is first used to sign in or step up. */
  lastUsedAt: string | null;
}

/** A signed-in session, as Settings › Security lists it (`GET /_caduceus/api/auth/sessions`, newest first). */
export interface SessionInfo {
  id: string;
  /** The browser's User-Agent at sign-in: what the device list names the device by. */
  userAgent: string;
  /** ISO 8601 times. `lastSeenAt` is kept to the minute. */
  createdAt: string;
  lastSeenAt: string;
  /** The session making this request. */
  current: boolean;
}

/**
 * Why the policy proxy refused a request (a 403, or a 413 for a body over the limit), for the web app to show. `denied`
 * requests never reach Hermes; the others can be retried once the owner has done what the code asks.
 */
export interface PolicyRefusal {
  error:
    | 'denied'
    | 'read-only'
    | 'confirmation-required'
    | 'confirmation-invalid'
    | 'confirmation-expired'
    /** A destructive session call named no profile (status 400): Hermes serves every profile, so the call would act on whichever home it holds. */
    | 'profile-required'
    | 'payload-too-large'
    /** Made by the web app, never the server: a T2 or T3 is not sent while the device is offline. */
    | 'offline'
    /** A turn was started while Caduceus drains for an update or a restart (M5 #12): try again when it is over. */
    | 'draining';
  /** The tier the request was classified into. */
  tier?: Tier;
  /** The Hermes operation (`METHOD /path` as the contract names it) or gateway method. */
  operation?: string;
  /** Set when `error` is `denied`. */
  reason?: DeniedReason;
  /** What the owner is told, in English until the message catalogues arrive (M1 #01). */
  message: string;
  /** Set when `error` is `payload-too-large`: the most bytes the request may carry. */
  maxBytes?: number;
}

/**
 * The 403 body of a request that needs a fresh passkey confirmation (T2/T3 actions, architecture §5): the web app
 * runs a step-up (`POST /_caduceus/api/auth/step-up/options`, then `POST /_caduceus/api/auth/step-up`) and retries.
 */
export interface StepUpRequired {
  error: 'step-up-required';
  /** Set by the policy proxy: the tier and operation that asked. */
  tier?: Tier;
  operation?: string;
}

/** `POST /_caduceus/api/auth/step-up`: the step-up grant this session now holds. */
export interface StepUpGrant {
  /** ISO 8601; about 5 minutes after the step-up. */
  expiresAt: string;
}

/**
 * `GET` / `PUT /_caduceus/api/preferences/appearance`: this device's appearance (a device is the browser profile the
 * `caduceus_device` cookie identifies). `GET` answers `null` until the device has saved one; `PUT` takes the same body and
 * answers `{ appearance }` with what it stored.
 */
export interface DeviceAppearance {
  appearance: Appearance | null;
}

/**
 * `GET` / `PUT /_caduceus/api/preferences/profiles/:profile`: what Caduceus keeps about one Hermes profile that Hermes does not
 * (the assistant display name chat headers show). `PUT` takes the same body; text that is blank clears it. `DELETE` removes
 * every preference of the profile (204). The name is never written to Hermes.
 */
export interface ProfilePreferences {
  assistantName: string | null;
}

/**
 * One snapshot of a profile's behaviour file (M4 #02, R1): the text a write replaced, kept by Caduceus so it can be restored.
 * `GET /_caduceus/api/file-snapshots?kind=soul|config&profile=` or `?kind=file&path=` lists a file's snapshots, newest first;
 * `GET /_caduceus/api/file-snapshots/:id` gives one with its text. Restoring is a normal save of that text.
 */
export interface FileSnapshot {
  id: number;
  /** ISO 8601 time the replaced text was snapshotted (just before the write). */
  at: string;
  /** Size of the text in bytes. */
  bytes: number;
}

/** A change somewhere in Caduceus that a gateway restart has to apply, and has not yet (M5 #01, the restart-to-apply banner). */
export interface PendingGatewayRestart {
  profile: string;
  /** What changed, in words for the owner (`Channel settings saved`), one entry for each distinct reason raised since the gateway last started. */
  reasons: string[];
  /** When the latest of these changes was made (the Caduceus server's clock). */
  raisedAt: string;
}

/**
 * `GET /_caduceus/api/gateway`: what only Caduceus can add to Hermes's own gateway answers. The gateway's state, its profiles
 * and its processes are read from Hermes (`/api/profiles`, `/api/status`) and are never copied here.
 */
export interface GatewayFacts {
  /**
   * When the process serving each profile started, as the operating system says (to the second), keyed by profile name. A profile
   * with no gateway, or whose process is not found, is absent. Profiles that one multiplexed gateway serves share a start time.
   */
  startedAt: Record<string, string>;
  /** The restarts still waiting. One is dropped the moment its profile's gateway has started after the change. */
  pending: PendingGatewayRestart[];
}

/**
 * `GET` / `PUT /_caduceus/api/preferences/chat-chips`: which chips the chat composer shows and in what order (M1 #08). The owner's, so every device
 * shows the same. `chips` is `null` until the owner saves one (then Caduceus's own order stands); `PUT` takes the same body, and `null` puts the
 * order back. A list that is not every chip once is a 400.
 */
export interface ChatChipsPreference {
  chips: ChipPreference | null;
}

/**
 * `GET` / `PUT /_caduceus/api/preferences/onboarding`: how far the owner is through the first-sign-in wizard (M5 #16). The owner's, so every device
 * resumes at the same step. A new owner reads `{ state: 'new', step: 'checks' }`; `PUT` takes `{ onboarding: { state, step } }` with a state of
 * `in-progress`, `skipped` or `finished` and one of the wizard's steps, and answers what it stored. Anything else is a 400.
 */
export interface OnboardingPreference {
  onboarding: OnboardingProgress;
}

/**
 * One entry of the workspace registry (M3 #10): a named directory on the Mac that runs Hermes, offered in the composer's workspace chip and the Brief
 * editor. `path` is absolute, as Hermes resolves it. `GET /_caduceus/api/work/workspaces` answers `{ workspaces }` in the owner's order.
 */
export interface Workspace {
  id: string;
  name: string;
  path: string;
}

/**
 * The `source` of every session Caduceus creates or resumes (`session.create`, `session.resume`). Hermes keys a session's tools
 * on it: this one gets Hermes's normal toolset, where `"desktop"` would add the Desktop GUI bridges that need a Desktop window
 * to answer (architecture §3, verified in M0 #10). It is also what the session list's source filter shows. Never change it.
 */
export const CADUCEUS_SESSION_SOURCE = 'caduceus';

/**
 * How Caduceus closes the browser's gateway connection (`/api/ws`) when it is the one ending it, so the page can say why.
 * The reason is plain text for the owner. A handshake Caduceus refuses never opens, so it has no close code.
 */
export const GATEWAY_CLOSE = {
  /** The private Hermes backend closed its side: it restarted or died. The page reconnects. */
  hermesClosed: { code: 1012, reason: 'Hermes closed the connection.' },
  /** The owner's session ended (signed out, revoked or expired). 4401 is also the code Hermes's own auth gate closes with. Signing in again is the way back. */
  sessionEnded: { code: 4401, reason: 'Your session ended. Sign in again.' },
  /** Caduceus itself is stopping. 1001 is the standard "going away"; the page reconnects once it is back. */
  serverStopping: { code: 1001, reason: 'Caduceus is stopping.' },
} as const;

/** What a viewer sends the terminal shell (`/_caduceus/api/terminal`, M7 #05): keystrokes, and the size of its window. Each is a JSON text frame. */
export type TerminalClientFrame = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };

/**
 * What the terminal shell (`/_caduceus/api/terminal`, M7 #05) and the Hermes TUI relay (`/api/pty`, M1 #19) send a viewer. `attached` comes first (and says
 * whether a shell is running there; `cwd` is the shell's folder, which the TUI has none of), then the scrollback it has kept as one `output`, then the live
 * output. `ended` says the shell is over (the owner typed `exit`, it sat idle, or nobody watched it for the grace period); the viewer of a shell stays
 * connected and Restart starts a new one, where the TUI relay closes the connection after it. `restarted` says a viewer's Restart replaced the shell. `notice`
 * is a sentence for the owner (the TUI relay says that the terminal it kept was closed after the grace period and this one is new).
 */
export type TerminalServerFrame =
  | { type: 'attached'; cwd?: string; running: boolean; cols: number; rows: number }
  | { type: 'output'; data: string }
  | { type: 'ended'; reason: 'exited' | 'idle' | 'abandoned' | 'stopping'; code?: number }
  | { type: 'restarted' }
  | { type: 'notice'; text: string };

/**
 * `GET /_caduceus/api/mcp-server` (M4 #11): the Caduceus MCP server an agent registers in Hermes: the name it is registered under, the
 * program Hermes starts for it (`command` and `args`: absolute paths on this computer, which hold no secret) and the tools it offers.
 */
export interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  tools: { name: string; title: string; description: string; readOnly: boolean }[];
}

/** Whether Caduceus is draining (M5 #12): taking no new turns while an update or a restart is under way, so that work in progress can settle first. */
export interface DrainState {
  active: boolean;
  /** What it is draining for, in words for the owner; `null` when it is not draining. */
  reason: string | null;
  /** When it began (milliseconds since the epoch); `null` when it is not draining. */
  since: number | null;
}

/** The event the page hears on its gateway connection whenever the drain begins or ends: `{ type: 'caduceus.drain', payload: DrainState }`. */
export const DRAIN_EVENT = 'caduceus.drain';

/** What gets updated (M5 #12): the Hermes install, or Caduceus's own deployment. */
export type UpdateTarget = 'hermes' | 'caduceus';

/** Where an update is, in order: new turns paused and work settling, the update running, Hermes or Caduceus starting afresh, the result checked, new turns allowed again. */
export type UpdatePhase = 'draining' | 'updating' | 'restarting' | 'verifying' | 'resuming';

/** One change an update brings: a commit. */
export interface UpdateCommit {
  sha: string;
  summary: string;
  author?: string;
  /** When it was made, as Hermes or git says it. */
  at?: string;
}

/**
 * What an update check found, for Hermes (Hermes's own `GET /api/hermes/update/check`, read by the page) and for Caduceus
 * (`GET /_caduceus/api/updates/caduceus`): the same fields, so one card shows either.
 */
export interface UpdateCheck {
  current_version: string;
  /** Commits behind; `null` when the check could not run, `-1` when it could not count. */
  behind: number | null;
  update_available: boolean;
  /** Whether Caduceus can apply it in place. */
  can_apply: boolean;
  message: string | null;
  commits?: UpdateCommit[];
  install_method?: string;
  update_command?: string;
}

/** How an update ended, in a sentence for the owner. */
export interface UpdateEnd {
  ok: boolean;
  message: string;
}

/** What's New: the record of one update. Kept by Caduceus (Hermes's own receipt says only the latest), so every update's changes can be read later. */
export interface WhatsNewEntry {
  id: string;
  target: UpdateTarget;
  /** When it ended (milliseconds since the epoch). */
  at: number;
  ok: boolean;
  message: string;
  fromVersion: string | null;
  toVersion: string | null;
  changes: UpdateCommit[];
}

/** `GET /_caduceus/api/updates`: what is going on, and what has been done. */
export interface UpdatesState {
  drain: DrainState;
  operation: { id: string; target: UpdateTarget; phase: UpdatePhase; startedAt: number; end?: UpdateEnd } | null;
  history: WhatsNewEntry[];
  /** Whether this Caduceus can restart itself (it runs as the background service), which its own update needs. */
  restartable: boolean;
}

/** One REST operation or gateway method in the API reference (M5 #13), with the risk tier Caduceus gives it (`denied` when it is not allowed through at all). */
export interface ApiReferenceEntry {
  kind: 'rest' | 'gateway';
  /** `GET`, `POST`… for REST, `RPC` for the gateway. */
  method: string;
  /** The path (`/api/sessions/{id}`) or the gateway method name (`session.list`). */
  name: string;
  /** What it is listed under: the operation's tag, or a gateway method's namespace. */
  group: string;
  summary: string;
  tier: 'T0' | 'T1' | 'T2' | 'T3' | 'denied';
  /** Whether it only reads (read-only mode lets it through). */
  read: boolean;
  /** A gateway method's parameter names. */
  params?: string[];
}

/** `GET /_caduceus/api/maintenance/api-reference`: the contracts Caduceus pins, as a reference. */
export interface ApiReference {
  /** The Hermes version the contracts were pinned from. */
  version: string;
  rest: ApiReferenceEntry[];
  gateway: ApiReferenceEntry[];
}

/** `GET /_caduceus/api/maintenance/facts` (M5 #13): what a bug report needs to say about this install. Nothing in it is a secret, a path or a name of the owner's. */
export interface InstallFacts {
  caduceus: { version: string; node: string; platform: string; arch: string };
  hermes: { version: string | null; state: string };
  contracts: { pinned: string; hermes: string | null; state: 'compatible' | 'incompatible' | 'checking'; differences: string[] };
  host: { role: string | null; protocolVersion: number | null; servesSpa: boolean | null };
}
