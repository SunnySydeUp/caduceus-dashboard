// The Caduceus MCP server, as an agent runs it: `node --import tsx/loader mcp-main.ts --url <Caduceus> --root <Hermes root home>`, an MCP
// server over stdio that Hermes starts when a session uses it (Agents › Tools & MCP shows the exact registration command). It holds
// nothing: every tool call goes to Caduceus (`/_caduceus/mcp/tools/<name>`) with the scoped token, and so through the policy proxy.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { MCP_CLIENT_HEADER, MCP_TOOL_ROUTE } from './mcp-tools.ts';
import { serveMcpStdio, type McpBridge, type ToolAnswer } from './mcp-stdio.ts';
import { mcpTokenPath } from './mcp-token.ts';

const { values } = parseArgs({ options: { url: { type: 'string' }, root: { type: 'string' } } });
if (!values.url || !values.root) {
  process.stderr.write('Usage: mcp-main.ts --url <Caduceus address> --root <Hermes root home>\n');
  process.exit(2);
}
const { url, root } = values;

const unreachable = (message: string): ToolAnswer => ({ ok: false, error: { error: 'caduceus-unreachable', message } });

const bridge: McpBridge = {
  async callTool(name, args, client) {
    // Read on every call: Caduceus makes the token when it first runs, which may be after Hermes started this server.
    let token: string;
    try {
      token = fs.readFileSync(mcpTokenPath(root), 'utf8').trim();
    } catch {
      return unreachable('Caduceus has not made its MCP token yet. Start Caduceus, then try again.');
    }
    let res: Response;
    try {
      res = await fetch(new URL(`${MCP_TOOL_ROUTE}/${encodeURIComponent(name)}`, url), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', [MCP_CLIENT_HEADER]: client },
        body: JSON.stringify({ arguments: args }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      return unreachable(`Caduceus did not answer at ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const body: unknown = await res.json().catch(() => undefined);
    if (res.ok && isRecord(body) && isRecord(body.result)) return { ok: true, result: body.result };
    return { ok: false, error: isRecord(body) && typeof body.error === 'string' ? body : { error: 'bad-answer', message: `Caduceus answered HTTP ${res.status}.` } };
  },
};

await serveMcpStdio({ input: process.stdin, output: process.stdout, bridge });
