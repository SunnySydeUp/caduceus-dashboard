// Reading Hermes for Agents › Tools & MCP. Only GETs live here; every change goes through `tools-actions.ts`. Every read names the
// profile (`?profile=`) and asks Hermes again; nothing is kept beyond what the screen shows (D1). Hermes sends no stored key, only
// whether one is set.
import { parseChannels } from '../channels/channels-model.ts';
import { useProfileLoad, type LoadedView } from '../models/model-data.ts';
import { parseComputerUse, parsePortal, parseToolsetConfig, parseToolsetModels, parseToolsets, readPlatformToolsets, type ComputerUse, type PlatformSource, type Portal, type ToolsetConfig, type ToolsetModels, type Toolset } from './tools-model.ts';

async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

const scoped = (route: string, profile: string) => `${route}?profile=${encodeURIComponent(profile)}`;

/** Every toolset Hermes reports for the profile. */
export const useToolsets = (profile: string | undefined): LoadedView<Toolset[]> => useProfileLoad(profile, async (name) => parseToolsets(await read(scoped('/api/tools/toolsets', name))));

/** How Hermes routes the profile's tools (the Nous Portal's Tool gateway). */
export const usePortal = (profile: string | undefined): LoadedView<Portal> => useProfileLoad(profile, async (name) => parsePortal(await read(scoped('/api/portal', name))));

/** Computer use's status for the profile. */
export const useComputerUse = (profile: string | undefined): LoadedView<ComputerUse> => useProfileLoad(profile, async (name) => parseComputerUse(await read(scoped('/api/tools/computer-use/status', name))));

export interface PlatformsData {
  source: PlatformSource;
  toolsets: Toolset[];
  /** Every platform Hermes lists, for adding a row. */
  platforms: { id: string; name: string }[];
}

/** The saved `platform_toolsets` with the toolsets and platforms the grid is made of. */
export const usePlatformsData = (profile: string | undefined): LoadedView<PlatformsData> =>
  useProfileLoad(profile, async (name) => {
    const [config, toolsets, platforms] = await Promise.all([read(scoped('/api/config', name)), read(scoped('/api/tools/toolsets', name)), read(scoped('/api/messaging/platforms', name)).catch(() => undefined)]);
    return { source: readPlatformToolsets(config), toolsets: parseToolsets(toolsets), platforms: parseChannels(platforms).channels.map((channel) => ({ id: channel.id, name: channel.name })) };
  });

export interface ToolsetDetail {
  config: ToolsetConfig;
  models: ToolsetModels;
}

/** One toolset's providers, key state and model catalogue, as Hermes says now. The drawer mounts one per toolset (`key`). */
export const useToolsetDetail = (profile: string | undefined, name: string): LoadedView<ToolsetDetail> =>
  useProfileLoad(profile, async (profileName) => {
    const route = `/api/tools/toolsets/${encodeURIComponent(name)}`;
    const [config, models] = await Promise.all([read(scoped(`${route}/config`, profileName)), read(scoped(`${route}/models`, profileName)).catch(() => undefined)]);
    return { config: parseToolsetConfig(config), models: parseToolsetModels(models) };
  });
