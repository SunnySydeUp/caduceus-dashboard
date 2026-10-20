// Agents › Tools & MCP › Terminal: the terminal backends Hermes lists, the choice and the working directory turned into the requests Hermes
// takes. Pure: no DOM, no React, no fetch. Hermes is the source of truth (D1): the choices, their readiness and the active one are what
// Hermes says now. Only `local` runs commands on the Mac that runs Hermes; every other backend (ssh, docker, a cloud sandbox) runs them somewhere else.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** A request to Hermes: the route's tier is the policy map's, not decided here. */
export interface TerminalRequest {
  method: 'PUT';
  /** The Hermes path with its query, exactly as it is sent. */
  path: string;
  body: Record<string, unknown>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Whether a backend runs commands somewhere other than the Mac that runs Hermes, so the paths the agent uses are not paths on that Mac. */
export const isRemoteBackend = (name: string | undefined): boolean => name !== undefined && name !== '' && name !== 'local';

/** Hermes's verdict on one backend's setup: usable now, needs something set, or its check could not run. */
export type BackendStatus = 'ready' | 'needs-setup' | 'unavailable';

export interface TerminalBackend {
  name: string;
  label: string;
  description: string;
  active: boolean;
  status: BackendStatus;
  /** Hermes's words about what the backend still needs; empty when it is ready. */
  detail: string;
  remote: boolean;
}

export interface BackendView {
  /** The backend the profile's config names now. */
  active: string;
  backends: TerminalBackend[];
}

/** `GET /api/tools/terminal/backends`: the backends in Hermes's order. */
export function parseBackends(body: unknown): BackendView {
  const record = isRecord(body) ? body : {};
  const listed = Array.isArray(record.backends) ? record.backends : [];
  const backends = listed.flatMap((entry): TerminalBackend[] => {
    if (!isRecord(entry) || typeof entry.name !== 'string') return [];
    const status: BackendStatus = entry.status === 'ready' ? 'ready' : entry.status === 'needs_setup' ? 'needs-setup' : 'unavailable';
    return [{ name: entry.name, label: text(entry.label) || entry.name, description: text(entry.description), active: entry.active === true, status, detail: text(entry.detail), remote: isRemoteBackend(entry.name) }];
  });
  const active = text(record.active) || backends.find((backend) => backend.active)?.name || 'local';
  return { active, backends };
}

/** `PUT /api/tools/terminal/backend` (Tier 3): Hermes saves `terminal.backend` in the profile's config. A backend that still needs setup can be chosen; Hermes then says what is missing. */
export function backendSelect(name: string, profile: string): TerminalRequest {
  return { method: 'PUT', path: '/api/tools/terminal/backend', body: { backend: name, profile } };
}

/** What Hermes answered to a switch: the backend it saved, and its note when it says the change needs a restart (`restart_required`, with `message` or `restart_message` for the words). */
export function readBackendAnswer(body: unknown): { backend: string | undefined; restartNote: string | undefined } {
  const record = isRecord(body) ? body : {};
  const asked = record.restart_required === true || record.requires_restart === true;
  const words = text(record.restart_message) || text(record.message);
  return { backend: text(record.backend) || undefined, restartNote: asked ? words || 'Hermes says this needs a restart to take effect.' : undefined };
}

/** `GET /api/config`: the working directory the profile's terminal starts in (`terminal.cwd`). Hermes keeps `.` or nothing when none is chosen: that is no folder. */
export function parseTerminalCwd(config: unknown): string | undefined {
  const terminal = isRecord(config) && isRecord(config.terminal) ? config.terminal : {};
  const cwd = text(terminal.cwd).trim();
  return cwd === '' || cwd === '.' || cwd === 'auto' || cwd === 'cwd' ? undefined : cwd;
}

/** `PUT /api/config` (Tier 3) with only `terminal.cwd`: Hermes merges it over the profile's config. */
export function terminalCwdUpdate(cwd: string, profile: string): TerminalRequest {
  return { method: 'PUT', path: `/api/config?profile=${encodeURIComponent(profile)}`, body: { config: { terminal: { cwd: cwd.trim() } } } };
}

/** The backend that makes workspaces remote: `undefined` for the local one, and while Hermes has not said. */
export interface RemoteWorkspace {
  backend: string;
  label: string;
}

export function remoteWorkspace(view: BackendView | undefined): RemoteWorkspace | undefined {
  if (!view || !isRemoteBackend(view.active)) return undefined;
  return { backend: view.active, label: view.backends.find((backend) => backend.name === view.active)?.label ?? view.active };
}
