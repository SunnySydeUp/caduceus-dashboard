// Reading Hermes for Agents › Tools & MCP › Terminal and for every screen that labels a workspace as remote. Only GETs live here; every
// change goes through `terminal-actions.ts`. Every read names the profile (`?profile=`) and asks Hermes again (D1).
import { useProfileLoad, type LoadedView } from '../models/model-data.ts';
import { parseBackends, parseTerminalCwd, remoteWorkspace, type BackendView, type RemoteWorkspace } from './terminal-model.ts';

async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

const scoped = (route: string, profile: string) => `${route}?profile=${encodeURIComponent(profile)}`;

export interface TerminalData extends BackendView {
  /** The working directory in the profile's config; `undefined` when none is chosen. */
  cwd: string | undefined;
}

/** The backend choices with their readiness, the active one, and the profile's working directory. */
export const useTerminal = (profile: string | undefined): LoadedView<TerminalData> =>
  useProfileLoad(profile, async (name) => {
    const [backends, config] = await Promise.all([read(scoped('/api/tools/terminal/backends', name)), read(scoped('/api/config', name))]);
    return { ...parseBackends(backends), cwd: parseTerminalCwd(config) };
  });

/**
 * The remote backend this profile's agent works on, or `undefined` for the local one and until Hermes has answered or when it cannot be asked.
 * A workspace shown next to it is a path on that machine, so the screens that show one label it.
 */
export function useRemoteWorkspace(profile: string | undefined): RemoteWorkspace | undefined {
  const { value } = useProfileLoad(profile, async (name) => remoteWorkspace(parseBackends(await read(scoped('/api/tools/terminal/backends', name)))) ?? null);
  return value ?? undefined;
}
