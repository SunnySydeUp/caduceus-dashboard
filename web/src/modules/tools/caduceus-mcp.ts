// Agents › Tools & MCP: the Caduceus MCP server's info card (M4 #11). Pure: what `GET /_caduceus/api/mcp-server` says becomes the command that
// registers the server with Hermes and the form of ticket 07's add flow, so the card's button and the command on the card are the same registration.
import type { McpServerInfo } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { commandLine, type McpServer, type ServerForm } from './mcp-model.ts';

/** The answer of `GET /_caduceus/api/mcp-server`, or `undefined` when it is not one. */
export function parseMcpServerInfo(body: unknown): McpServerInfo | undefined {
  if (!isRecord(body) || typeof body.name !== 'string' || typeof body.command !== 'string' || !Array.isArray(body.args) || !Array.isArray(body.tools)) return undefined;
  return {
    name: body.name,
    command: body.command,
    args: body.args.filter((arg): arg is string => typeof arg === 'string'),
    tools: body.tools.flatMap((tool) => (isRecord(tool) && typeof tool.name === 'string' ? [{ name: tool.name, title: typeof tool.title === 'string' ? tool.title : tool.name, description: typeof tool.description === 'string' ? tool.description : '', readOnly: tool.readOnly === true }] : [])),
  };
}

/**
 * The command that registers the server with Hermes for a profile: Hermes's own `mcp add` (`--args` takes everything after it). Nothing
 * secret is in it: the server reads its token from a file only the owner can read.
 */
export function registrationCommand(info: McpServerInfo, profile: string): string {
  const [firstArg = '', ...restArgs] = info.args;
  return `hermes -p ${profile} mcp add ${info.name} --command ${commandLine(info.command, [])} --args ${commandLine(firstArg, restArgs)}`;
}

/** The form of ticket 07's add flow that makes the same registration: a stdio server, so the flow asks for the typed name (T3). */
export function registrationForm(info: McpServerInfo): ServerForm {
  return { transport: 'stdio', name: info.name, url: '', command: info.command, args: info.args.join('\n'), env: [], auth: 'none', bearerToken: '' };
}

/** Whether the profile already has a server of the name the Caduceus server registers under, and so what the button says. */
export const isRegistered = (info: McpServerInfo, servers: readonly McpServer[]): boolean => servers.some((server) => server.name === info.name);
