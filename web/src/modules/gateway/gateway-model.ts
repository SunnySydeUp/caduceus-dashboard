// What Connect › Gateway knows about each profile's messaging gateway, free of the DOM and of React. It is made only of what
// Hermes answers (the profile list, the status endpoints, the migration plan) and what Caduceus's server adds (a process's start
// time); nothing here is kept (D1: Hermes is the source of truth).
import type { RiskTier } from '../../module-registry.ts';
import type { StatusState } from '../../shell/StatusBadge.tsx';
import { gatewayView, type GatewayStatus, type ProfileCard } from '../profiles/profiles-model.ts';
import { plainDuration } from '../../plain-duration.ts';

export type GatewayActionId = 'start' | 'stop' | 'restart' | 'drain' | 'cancel-drain';

export interface GatewayAction {
  id: GatewayActionId;
  label: string;
  /** The tier of the Hermes route (the policy map is the authority: `contracts/policy/rest.ts`). */
  tier: Extract<RiskTier, 'T1' | 'T2'>;
}

/** The gateway process of one profile (or the one process that serves several), as `GET /api/status` lists them. */
export interface GatewayProcessEntry {
  profile: string;
  /** Platform name → the host port it listens on, for the platforms that take inbound connections. */
  ports?: Record<string, number>;
  /** Every profile the process serves, when it is a multiplexer. */
  served_profiles?: string[];
}

/** The part of `GET /api/status` (no profile) about every gateway on the host. */
export interface GatewayTopology {
  /** `none`, `single`, `multiple` (a gateway for each of several profiles) or `multiplex` (one for all). */
  gateway_mode?: string;
  gateways?: GatewayProcessEntry[];
}

export interface GatewayInputs {
  cards: readonly ProfileCard[];
  /** Each profile's `GET /api/status?profile=`; absent when Hermes did not answer for it. */
  statuses: Readonly<Record<string, GatewayStatus | undefined>>;
  topology: GatewayTopology | undefined;
  /** `GET /_caduceus/api/gateway`'s `startedAt`. */
  startedAt: Readonly<Record<string, string>>;
}

export interface GatewayRow {
  profile: string;
  /** Hermes's sticky default and its root profile: the drain route works on the root profile's gateway. */
  isRoot: boolean;
  badge: StatusState;
  statusLabel: string;
  running: boolean;
  pid: number | undefined;
  /** ISO time the serving process started. */
  startedAt: string | undefined;
  activeAgents: number;
  /** The platforms the gateway has connected, with the state Hermes gives each. */
  platforms: { name: string; state: string }[];
  /** The profile whose gateway process serves this one, when it has none of its own (a multiplexed gateway). */
  servedBy: string | undefined;
  /** The other profiles that the same process serves. */
  alsoServes: string[];
  /** Sentences about the gateway the owner should read: why it stopped, that it may be stuck. */
  notes: string[];
  actions: GatewayAction[];
}

const START: GatewayAction = { id: 'start', label: 'Start', tier: 'T1' };
const STOP: GatewayAction = { id: 'stop', label: 'Stop', tier: 'T2' };
const RESTART: GatewayAction = { id: 'restart', label: 'Restart', tier: 'T2' };
const DRAIN: GatewayAction = { id: 'drain', label: 'Drain', tier: 'T2' };
const CANCEL_DRAIN: GatewayAction = { id: 'cancel-drain', label: 'Cancel drain', tier: 'T2' };

export { plainDuration };

/** The two ways a host runs its gateways, named the same on every page. */
export const SHARED_GATEWAY = 'One shared gateway';
export const GATEWAY_PER_PROFILE = 'One gateway per profile';

/** The name of the way the host runs its gateways now, from Hermes's `gateway_mode`; `undefined` when no gateway is set up. */
export function gatewayModeLabel(mode: string | undefined): string | undefined {
  if (mode === 'multiplex') return SHARED_GATEWAY;
  return mode === 'multiple' || mode === 'single' ? GATEWAY_PER_PROFILE : undefined;
}

/** The other profiles a shared gateway serves, and the agents working now: what a stop or a restart touches. */
export interface GatewayImpact {
  alsoServes?: readonly string[];
  activeAgents?: number;
}

/** What a stop or a restart does to work in progress, in one statement: a restart waits for working agents, a stop ends their turns. */
export function gatewayImpactText(verb: 'stop' | 'restart', { alsoServes = [], activeAgents = 0 }: GatewayImpact): string {
  const names = alsoServes.length < 2 ? alsoServes.join('') : `${alsoServes.slice(0, -1).join(', ')} and ${alsoServes[alsoServes.length - 1]}`;
  const shared = alsoServes.length > 0 ? ` It also serves ${names}, which ${verb === 'stop' ? 'go down' : 'restart'} with it.` : '';
  const one = activeAgents === 1;
  if (verb === 'restart') {
    const busy = activeAgents > 0 ? ` ${one ? '1 agent is' : `${activeAgents} agents are`} working now: Hermes waits for ${one ? 'it' : 'them'} to finish first.` : ' Hermes waits for work in progress to finish first.';
    return `${shared}${busy}`;
  }
  const busy = activeAgents > 0 ? ` ${one ? '1 agent is' : `${activeAgents} agents are`} working now, and ${one ? 'its' : 'their'} turn ends.` : '';
  return `${shared}${busy}`;
}

/** "a", "a and b", "a, b and c". */
const joinNames = (names: readonly string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export function gatewayRows({ cards, statuses, topology, startedAt }: GatewayInputs): GatewayRow[] {
  const entries = topology?.gateways ?? [];
  return cards.map((card) => {
    const status = statuses[card.name];
    const view = gatewayView(status ?? { gateway_running: card.gatewayRunning });
    const running = status?.gateway_running ?? card.gatewayRunning;
    const draining = status?.gateway_state === 'draining';
    // A profile a multiplexed gateway serves has no gateway of its own: Hermes refuses to start or stop one for it.
    const shared = status?.gateway_shared_with ?? entries.find((entry) => entry.profile === card.name)?.served_profiles ?? [];
    const servedBy = entries.find((entry) => entry.profile !== card.name && entry.served_profiles?.includes(card.name))?.profile ?? (card.name !== 'default' && shared.includes('default') ? 'default' : undefined);
    const alsoServes = shared.filter((name) => name !== card.name);
    const notes: string[] = [];
    if (!running && status?.gateway_exit_reason) notes.push(`Stopped with: ${status.gateway_exit_reason}`);
    if (running && typeof status?.gateway_heartbeat_stale_s === 'number') notes.push(`It is running, but has not reported in for ${plainDuration(status.gateway_heartbeat_stale_s)}: it may be stuck.`);
    if (servedBy) notes.push(`Served by the gateway of ${servedBy}, which it shares with ${joinNames(alsoServes)}. Restarting it restarts them all.`);
    const actions: GatewayAction[] = !running ? [START] : servedBy ? [RESTART] : [RESTART, STOP, ...(draining ? [CANCEL_DRAIN] : card.isRoot && status?.gateway_drainable ? [DRAIN] : [])];
    return {
      profile: card.name,
      isRoot: card.isRoot,
      badge: view.badge,
      statusLabel: view.label,
      running,
      pid: typeof status?.gateway_pid === 'number' ? status.gateway_pid : undefined,
      startedAt: startedAt[card.name],
      activeAgents: status?.active_agents ?? 0,
      platforms: Object.entries(status?.gateway_platforms ?? {}).map(([name, platform]) => ({ name, state: platform?.state ?? 'unknown' })),
      servedBy,
      alsoServes,
      notes,
      actions,
    };
  });
}

/** One running gateway process: whose it is, and which profiles it serves. */
export interface GatewayProcess {
  owner: string;
  pid: number | undefined;
  startedAt: string | undefined;
  ports: { platform: string; port: number }[];
  serves: string[];
}

/** The gateway processes Hermes lists (`gateways` in its status), with the pid and start time of each. Nothing is kept. */
export function gatewayProcesses({ statuses, topology, startedAt }: GatewayInputs): GatewayProcess[] {
  return (topology?.gateways ?? []).map((entry) => {
    const pid = statuses[entry.profile]?.gateway_pid;
    return {
      owner: entry.profile,
      pid: typeof pid === 'number' ? pid : undefined,
      startedAt: startedAt[entry.profile],
      ports: Object.entries(entry.ports ?? {}).map(([platform, port]) => ({ platform, port })),
      serves: entry.served_profiles ?? [entry.profile],
    };
  });
}

export type MigrationState =
  /** Nothing blocks it: it can be run. */
  | 'ready'
  /** Something blocks it, and the blockers say what. */
  | 'blocked'
  /** One gateway already serves every profile. */
  | 'done'
  /** An earlier run stopped half way, and may be run again to finish. */
  | 'resume'
  /** There is only one profile, so there is nothing to merge. */
  | 'nothing'
  /** Hermes did not give a plan that can be read. */
  | 'unknown';

export interface MigrationView {
  state: MigrationState;
  /** The run button is enabled only when this is true: while any blocker remains, it is not (the migration is a T2). */
  canRun: boolean;
  blockers: string[];
  notices: string[];
  /** Each profile's own gateway footprint today: the process and the service manager that keeps it. */
  gateways: { profile: string; pid: number | undefined; service: string | undefined }[];
  /** The command Hermes runs, for the owner who would rather run it themselves. */
  command: string | undefined;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/**
 * Reads Hermes's migration plan (`GET /api/gateway/migrate/plan`, the same JSON as the command line's plan). The migration may be
 * run only when the plan has no blockers (Hermes runs the preflight again and refuses, but the owner is not asked for a passkey
 * for what cannot happen), and not when there is nothing to merge or it is already done.
 */
export function migrationView(plan: unknown): MigrationView {
  const body = record(plan);
  if (!Array.isArray(body.profiles) || !Array.isArray(body.blockers)) return { state: 'unknown', canRun: false, blockers: [], notices: [], gateways: [], command: undefined };
  const blockers = strings(body.blockers);
  const profiles = body.profiles.map(record);
  const state: MigrationState =
    blockers.length > 0 ? 'blocked' : body.already_multiplexed === true ? 'done' : profiles.length < 2 ? 'nothing' : body.interrupted === true ? 'resume' : 'ready';
  return {
    state,
    canRun: state === 'ready' || state === 'resume',
    blockers,
    notices: strings(body.notices),
    gateways: profiles.map((profile) => {
      const service = record(profile.service).kind;
      return { profile: String(profile.profile), pid: typeof profile.pid === 'number' ? profile.pid : undefined, service: typeof service === 'string' ? service : undefined };
    }),
    command: typeof body.command === 'string' ? body.command : undefined,
  };
}

/** How many channels (messaging platforms) Hermes says are set up, from `GET /api/messaging/platforms`; `undefined` when it gave no list. */
export function configuredChannels(platforms: unknown): number | undefined {
  const list = record(platforms).platforms;
  return Array.isArray(list) ? list.filter((platform) => record(platform).configured === true).length : undefined;
}

/** No gateway running anywhere and no channel for one to serve: the page offers to start one, or to set a channel up. */
export function isUnconfigured(rows: readonly GatewayRow[], channels: number | undefined): boolean {
  return channels === 0 && rows.every((row) => !row.running);
}
