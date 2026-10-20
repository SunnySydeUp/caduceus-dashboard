// The MCP protocol over stdio (newline-delimited JSON-RPC 2.0), for the Caduceus MCP server: the handshake, `tools/list` from the tool
// list and `tools/call` handed to a bridge that carries it to Caduceus. This is only the protocol; who may do what is decided by
// Caduceus's policy, which every call passes. Hand-written because the server needs three methods and no dependency.
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { argumentProblem, MCP_TOOLS, toolNamed } from './mcp-tools.ts';

export const SERVER_INFO = { name: 'caduceus', title: 'Caduceus Dashboard', version: '1.0.0' } as const;

/** The protocol versions this server speaks, newest first; a client that asks for another gets the newest. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** The JSON-RPC error codes the server uses. */
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const NOT_INITIALIZED = -32002;

/** What Caduceus answered a tool call with: the tool's result, or a refusal or failure the agent can act on. */
export type ToolAnswer = { ok: true; result: Record<string, unknown> } | { ok: false; error: Record<string, unknown> };

export interface McpBridge {
  /** Carries one tool call to Caduceus on behalf of the MCP client named `client`. */
  callTool(name: string, args: Record<string, unknown>, client: string): Promise<ToolAnswer>;
}

/** A tool's answer as MCP carries it: the data as text and as structured content, and `isError` for a refusal or a failure. */
function toolResult(answer: ToolAnswer) {
  const data = answer.ok ? answer.result : answer.error;
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data, ...(answer.ok ? {} : { isError: true }) };
}

/** Serves one MCP client on `input` and `output` until `input` ends. */
export async function serveMcpStdio({ input, output, bridge }: { input: Readable; output: Writable; bridge: McpBridge }): Promise<void> {
  const send = (message: Record<string, unknown>): void => {
    output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  let client = 'unknown';
  let initialized = false;
  const inFlight = new Set<Promise<void>>();

  async function answer(id: string | number, method: string, params: Record<string, unknown>): Promise<void> {
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'initialize') {
      const wanted = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const clientInfo = isRecord(params.clientInfo) ? params.clientInfo : {};
      if (typeof clientInfo.name === 'string' && clientInfo.name !== '') client = clientInfo.name;
      initialized = true;
      return send({ id, result: { protocolVersion: PROTOCOL_VERSIONS.includes(wanted) ? wanted : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO } });
    }
    if (method !== 'tools/list' && method !== 'tools/call') return send({ id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } });
    if (!initialized) return send({ id, error: { code: NOT_INITIALIZED, message: 'Send initialize first.' } });
    if (method === 'tools/list') {
      return send({ id, result: { tools: MCP_TOOLS.map(({ run: _run, ...tool }) => tool) } });
    }
    const tool = typeof params.name === 'string' ? toolNamed(params.name) : undefined;
    if (!tool) return send({ id, error: { code: INVALID_PARAMS, message: `Unknown tool: ${String(params.name)}` } });
    const args = params.arguments ?? {};
    const problem = argumentProblem(tool, args);
    if (problem) return send({ id, result: toolResult({ ok: false, error: { error: 'bad-arguments', message: problem } }) });
    return send({ id, result: toolResult(await bridge.callTool(tool.name, args as Record<string, unknown>, client)) });
  }

  const lines = readline.createInterface({ input });
  lines.on('line', (line) => {
    if (line.trim() === '') return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: 'Parse error' } });
    }
    if (!isRecord(message) || typeof message.method !== 'string') return send({ id: null, error: { code: INVALID_REQUEST, message: 'Invalid request' } });
    // A notification (`notifications/initialized`, `notifications/cancelled`) has no id and gets no answer.
    if (typeof message.id !== 'string' && typeof message.id !== 'number') return;
    const running = answer(message.id, message.method, isRecord(message.params) ? message.params : {}).catch((error: unknown) =>
      send({ id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }),
    );
    const tracked = running.finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
  });
  const { promise: ended, resolve } = Promise.withResolvers<void>();
  lines.on('close', resolve);
  await ended;
  await Promise.all(inFlight);
}
