// What the owner's page says about the Caduceus MCP server (M4 #11): the program Hermes starts for it. Pure: the paths and the address are given.
import path from 'node:path';
import type { McpServerInfo } from '@caduceus/contracts/caduceus-api';
import { MCP_TOOLS } from './mcp-tools.ts';

/** The name the server is registered under in Hermes: its tools are then `mcp_caduceus_*` to the agent. */
export const MCP_SERVER_NAME = 'caduceus';

export interface McpInfoInputs {
  /** The `node` that runs Caduceus (the one that will run the MCP server). */
  nodePath: string;
  /** The Caduceus checkout (`server/src/mcp-main.ts` and `node_modules/tsx` are in it). */
  projectRoot: string;
  /** Where Caduceus listens, on this computer. */
  url: string;
  /** The Hermes root home, whose `caduceus/` directory holds the scoped token. */
  hermesRoot: string;
}

export function mcpServerInfo({ nodePath, projectRoot, url, hermesRoot }: McpInfoInputs): McpServerInfo {
  return {
    name: MCP_SERVER_NAME,
    command: nodePath,
    args: ['--import', path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs'), path.join(projectRoot, 'server', 'src', 'mcp-main.ts'), '--url', url, '--root', hermesRoot],
    tools: MCP_TOOLS.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, readOnly: tool.annotations.readOnlyHint })),
  };
}
