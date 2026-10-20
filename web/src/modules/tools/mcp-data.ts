// Reading Hermes for Agents › Tools & MCP › MCP servers and the catalogue. Only reads live here; every change goes through
// `mcp-actions.ts`. Every read names the profile and asks Hermes again; nothing is kept beyond what the screen shows (D1).
import { gatewayConnection } from '../../gateway.ts';
import { useProfileLoad, type LoadedView } from '../models/model-data.ts';
import type { McpServerInfo } from '@caduceus/contracts/caduceus-api';
import { parseMcpServerInfo } from './caduceus-mcp.ts';
import { parseCatalog, parseRuntime, parseServers, serverDefinitions, type Catalog, type McpServer, type RuntimeState } from './mcp-model.ts';

/** A plain Hermes read through Caduceus: a path, answered as JSON. */
export async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

const scoped = (route: string, profile: string) => `${route}?profile=${encodeURIComponent(profile)}`;

export interface McpData {
  servers: McpServer[];
  /** Each server's definition in the profile's config: what an edit starts from. */
  definitions: Record<string, Record<string, unknown>>;
  /** What Hermes has of each server at runtime, when the gateway answers; its absence is not an error (the list is Hermes's REST answer). */
  runtime: Map<string, RuntimeState> | undefined;
}

/** The gateway's `mcp.servers.status`, or nothing while the connection is down. */
async function runtimeOf(profile: string): Promise<McpData['runtime']> {
  const gateway = gatewayConnection();
  if (gateway.status.state !== 'connected') return undefined;
  return gateway.client.request('mcp.servers.status', { profile }).then(parseRuntime, () => undefined);
}

/** The profile's MCP servers, with their definitions and runtime state. */
export const useMcpServers = (profile: string | undefined): LoadedView<McpData> =>
  useProfileLoad(profile, async (name) => {
    const [list, config, runtime] = await Promise.all([read(scoped('/api/mcp/servers', name)), read(scoped('/api/config', name)), runtimeOf(name)]);
    return { servers: parseServers(list, config), definitions: serverDefinitions(config), runtime };
  });

/** Hermes's MCP catalogue with what is installed in the profile. */
export const useMcpCatalog = (profile: string | undefined): LoadedView<Catalog> => useProfileLoad(profile, async (name) => parseCatalog(await read(scoped('/api/mcp/catalog', name))));

/** The Caduceus MCP server's registration (`GET /_caduceus/api/mcp-server`): what the info card shows. Not read from Hermes, so it asks Caduceus again for each profile only because the screen does. */
export const useMcpServerInfo = (profile: string | undefined): LoadedView<McpServerInfo | undefined> => useProfileLoad(profile, async () => parseMcpServerInfo(await read('/_caduceus/api/mcp-server')));
