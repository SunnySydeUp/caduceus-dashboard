// A minimal MCP client over stdio (newline-delimited JSON-RPC), the way an inspector or an agent runs a server: it starts the program,
// speaks the protocol's handshake, and lists and calls tools. It is the system-boundary stand-in for the agent that registers the server.
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

/** What an MCP tool answers with: text content, the same data as structured content, and whether the call failed. */
export interface ToolResult {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolInfo {
  name: string;
  title?: string;
  description: string;
  inputSchema: { type: string; properties?: Record<string, { type?: string }>; required?: string[] };
  annotations?: Record<string, unknown>;
}

export interface McpClient {
  /** What the server said about itself in the handshake. */
  readonly server: { name: string; version: string };
  readonly protocolVersion: string;
  tools(): Promise<ToolInfo[]>;
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  /** The raw request: for the checks of the protocol itself (an unknown method, a call before the handshake). */
  request(method: string, params?: unknown): Promise<{ result?: unknown; error?: { code: number; message: string } }>;
  /** Ends the server by closing its standard input, as a client does, and waits for it to exit. */
  close(): Promise<void>;
}

const ROOT = path.resolve(import.meta.dirname, '../../..');
/** The command line that runs the Caduceus MCP server (what the registration command in Hermes holds). */
export const MCP_MAIN = path.join(ROOT, 'server/src/mcp-main.ts');
export const TSX_LOADER = path.join(ROOT, 'node_modules/tsx/dist/loader.mjs');

export interface StartOptions {
  url: string;
  root: string;
  /** What the client calls itself in the handshake (`clientInfo.name`), which Caduceus audits calls under. */
  name?: string;
  /** Skip the handshake, to check a server that has not been initialised. */
  handshake?: boolean;
}

export async function startMcpClient({ url, root, name = 'test-agent', handshake = true }: StartOptions): Promise<McpClient> {
  const child: ChildProcessByStdio<Writable, Readable, null> = spawn(process.execPath, ['--import', TSX_LOADER, MCP_MAIN, '--url', url, '--root', root], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map<number, PromiseWithResolvers<{ result?: unknown; error?: { code: number; message: string } }>>();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { code: number; message: string } };
    if (message.id === undefined) return;
    pending.get(message.id)?.resolve(message);
    pending.delete(message.id);
  });
  const exited = Promise.withResolvers<void>();
  child.on('exit', (code) => {
    exited.resolve();
    for (const answer of pending.values()) answer.reject(new Error(`The MCP server exited (${code}) before it answered`));
    pending.clear();
  });
  let next = 0;
  const request: McpClient['request'] = (method, params) => {
    const id = ++next;
    const answer = Promise.withResolvers<{ result?: unknown; error?: { code: number; message: string } }>();
    pending.set(id, answer);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return answer.promise;
  };
  let server = { name: '', version: '' };
  let protocolVersion = '';
  if (handshake) {
    const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1.0.0' } });
    const result = init.result as { protocolVersion: string; serverInfo: { name: string; version: string } };
    server = result.serverInfo;
    protocolVersion = result.protocolVersion;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }
  return {
    server,
    protocolVersion,
    request,
    async tools() {
      return ((await request('tools/list')).result as { tools: ToolInfo[] }).tools;
    },
    async call(toolName, args = {}) {
      const answer = await request('tools/call', { name: toolName, arguments: args });
      if (answer.error) throw new Error(`${answer.error.code}: ${answer.error.message}`);
      return answer.result as ToolResult;
    },
    async close() {
      child.stdin.end();
      await exited.promise;
    },
  };
}
