// What Agents › Profiles knows about a Hermes profile, free of the DOM and of React: the card, what may be deleted, the CLI
// command. Everything comes from Hermes's answers (D1: Hermes is the source of truth); nothing here is stored.

/** A Hermes profile as its card and detail show it. */
export interface ProfileCard {
  name: string;
  /** Hermes's presentation-only name (the one a rename of the root profile sets); empty when none. */
  displayName: string;
  description: string;
  /** The description was written by Auto-describe rather than by the owner. */
  descriptionAuto: boolean;
  model: string | null;
  provider: string | null;
  skillCount: number;
  /** The gateway process of this profile, as the list reports it. */
  gatewayRunning: boolean;
  /** Its home is the Hermes installation root (`default`): it can be neither deleted nor renamed. */
  isRoot: boolean;
  /** Hermes's sticky default (`hermes profile use`), the one "Make default" writes. */
  isDefault: boolean;
  /** The profile's folder, where its behaviour files are (the editors of M4 #02 build their paths from it). */
  path: string;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * Reads `GET /api/profiles` and `GET /api/profiles/active`. Hermes declares no response schema for either (the pin types
 * them `unknown`), so the bodies are read defensively; anything that is not a named profile is left out.
 */
export function parseProfiles(list: unknown, active: unknown): ProfileCard[] {
  const listed = record(list).profiles;
  const named = record(active).active;
  const sticky = typeof named === 'string' && named !== '' ? named : 'default';
  return (Array.isArray(listed) ? listed : []).flatMap((item): ProfileCard[] => {
    const profile = record(item);
    if (typeof profile.name !== 'string') return [];
    const skillCount = profile.skill_count;
    return [
      {
        name: profile.name,
        displayName: text(profile.display_name),
        description: text(profile.description),
        descriptionAuto: profile.description_auto === true,
        model: textOrNull(profile.model),
        provider: textOrNull(profile.provider),
        skillCount: typeof skillCount === 'number' ? skillCount : 0,
        gatewayRunning: profile.gateway_running === true,
        isRoot: profile.is_default === true,
        isDefault: profile.name === sticky,
        path: text(profile.path),
      },
    ];
  });
}

/** The command that starts Hermes on this profile: what Copy CLI command copies. A profile name is shell-safe (`[a-z0-9_-]`). */
export function cliCommand(name: string): string {
  return `hermes -p ${name}`;
}

/** Why a profile cannot be deleted, in words for the owner; `undefined` when it can. The same refusals Hermes makes, said before asking. */
export function deleteRefusal(profile: ProfileCard, all: readonly ProfileCard[]): string | undefined {
  if (profile.isRoot) return 'This is the root profile (the Hermes installation itself): it cannot be deleted.';
  if (all.length <= 1) return 'This is the only profile Hermes has: it cannot be deleted.';
  if (profile.isDefault) return 'This is the default profile. Make another profile the default first, then delete this one.';
  return undefined;
}

/** The numbers on a profile's Overview. */
export interface OverviewMetrics {
  sessions: number;
  /** Input plus output tokens over the analytics window (30 days). */
  tokens: number;
  skills: number;
  mcpServers: number;
  /** Kanban tasks assigned to the profile that have started: running, blocked, in review or done. */
  runs: number;
  /** Of the runs that finished (done or blocked), the share that are done; 0 when none has finished. */
  successRate: number;
  /** Tasks assigned to it that have not started yet: triage, todo, scheduled, ready. */
  queued: number;
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const STARTED = ['running', 'blocked', 'review', 'done'] as const;
const WAITING = ['triage', 'todo', 'scheduled', 'ready'] as const;

export interface OverviewSources {
  /** `GET /api/analytics/usage?profile=<name>`. */
  usage: unknown;
  /** `GET /api/plugins/kanban/stats`. */
  stats: unknown;
  /** `GET /api/plugins/kanban/assignees`; the profile's entry, when it has one, is read before the stats. */
  assignees: unknown;
  profile: string;
  /** `GET /api/mcp/servers?profile=<name>`. */
  mcpServers: unknown;
  skillCount: number;
}

/**
 * The Overview numbers of one profile, from what Hermes answers: its usage analytics, the Kanban stats and assignees, its MCP
 * servers. A profile that has done nothing, or a route that did not answer, reads as zeros: an empty history is not an error.
 */
export function overviewMetrics({ usage, stats, assignees, profile, mcpServers, skillCount }: OverviewSources): OverviewMetrics {
  const totals = record(record(usage).totals);
  const listed = record(assignees).assignees;
  const named = (Array.isArray(listed) ? listed : []).map(record).find((entry) => entry.name === profile);
  const counts = record(named ? named.counts : record(record(stats).by_assignee)[profile]);
  const sum = (statuses: readonly string[]) => statuses.reduce((total, status) => total + count(counts[status]), 0);
  const finished = count(counts.done) + count(counts.blocked);
  const servers = record(mcpServers).servers;
  return {
    sessions: count(totals.total_sessions),
    tokens: count(totals.total_input) + count(totals.total_output),
    skills: skillCount,
    mcpServers: Array.isArray(servers) ? servers.length : 0,
    runs: sum(STARTED),
    successRate: finished === 0 ? 0 : count(counts.done) / finished,
    queued: sum(WAITING),
  };
}

export type GatewayBadge = 'online' | 'degraded' | 'offline' | 'failed' | 'stale';

/** The part of Hermes's `GET /api/status?profile=` that tells a gateway's state. */
export interface GatewayStatus {
  gateway_running?: boolean;
  gateway_state?: string | null;
  /** The process serving the profile (Hermes gives it on a loopback bind, which is the only one Caduceus uses). */
  gateway_pid?: number | null;
  gateway_exit_reason?: string | null;
  /** Seconds since the gateway last reported in, only when its process is alive but quiet for too long. */
  gateway_heartbeat_stale_s?: number | null;
  /** Every profile the one gateway process serves, when it is a multiplexer; `null` for a gateway of its own. */
  gateway_shared_with?: string[] | null;
  /** Running and serving: a drain may begin. */
  gateway_drainable?: boolean;
  active_agents?: number;
  gateway_platforms?: Record<string, { state?: string | null } | undefined>;
}

/** How a gateway's state reads: the status ladder's rung and a word for it. `undefined` is a status Hermes did not give. */
export function gatewayView(status: GatewayStatus | undefined): { badge: GatewayBadge; label: string } {
  if (!status) return { badge: 'stale', label: 'Status unknown' };
  const state = status.gateway_state ?? undefined;
  if (status.gateway_running) {
    if (state === undefined || state === 'running') return { badge: 'online', label: 'Running' };
    return { badge: 'degraded', label: state.charAt(0).toUpperCase() + state.slice(1).replaceAll('_', ' ') };
  }
  return state === 'startup_failed' ? { badge: 'failed', label: 'Failed to start' } : { badge: 'offline', label: 'Stopped' };
}

/** Names Hermes keeps for itself. It refuses more of them (command names); its own message is shown for those. */
const RESERVED = ['hermes', 'default', 'test', 'tmp', 'root', 'sudo'];
const NAME_RULE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * What is wrong with a new name for a profile, in words for the owner, or `undefined`. Hermes normalises to lowercase and has
 * the last word: this only saves a round trip for the common mistakes. The root profile ("default") is not renamed: Hermes
 * keeps its id and stores the new name beside it as a display name, which may be any text.
 */
export function renameProblem(from: string, to: string, taken: readonly string[], { root = false }: { root?: boolean } = {}): string | undefined {
  const name = to.trim();
  if (name === '') return 'Enter a name.';
  if (root) return undefined;
  const id = name.toLowerCase();
  if (id === from) return 'Choose a different name.';
  if (RESERVED.includes(id)) return `“${id}” is reserved.`;
  // `/agents/profiles/new` is the profile builder, so a profile of that name could not be opened (M4 #12).
  if (id === 'new') return '“new” cannot be used: Caduceus uses it for the address of the profile builder.';
  if (taken.includes(id)) return `A profile called “${id}” already exists.`;
  if (id.length > 64) return 'Use up to 64 characters.';
  if (!/^[a-z0-9]/.test(id)) return 'Use a name starting with a letter or number.';
  if (!NAME_RULE.test(id)) return 'Use lowercase letters, numbers, - or _.';
  return undefined;
}

/** "1 skill", "58 skills": the count with its noun. */
export function skillCountWords(count: number): string {
  return `${count} ${count === 1 ? 'skill' : 'skills'}`;
}
