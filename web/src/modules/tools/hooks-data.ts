// Reading Hermes for Agents › Tools & MCP › Hooks. Only GETs live here; every change goes through `hooks-actions.ts`. The read names the
// profile (`?profile=`) and asks Hermes again; nothing is kept beyond what the screen shows (D1).
import { useProfileLoad, type LoadedView } from '../models/model-data.ts';
import { parseHooks, type HookList } from './hooks-model.ts';

/** The shell hooks in the profile's config, as Hermes lists them now, and the events a hook can run on. */
export const useHooks = (profile: string | undefined): LoadedView<HookList> =>
  useProfileLoad(profile, async (name) => {
    const path = `/api/ops/hooks?profile=${encodeURIComponent(name)}`;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    return parseHooks(await res.json(), name);
  });
