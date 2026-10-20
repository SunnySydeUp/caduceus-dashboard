// Caduceus as an MCP client (R11, M4 #10): it connects to one of the MCP servers of a Hermes profile for the length of one call, lists its tools, calls one and
// disconnects. Two transports: a command it runs (newline-delimited JSON-RPC on the command's standard input and output) and a streamable HTTP endpoint (a JSON-RPC
// POST answered as JSON or as a server-sent event). Nothing stays open between calls. Which tool may be called is decided by `notes-tools.ts` before this module is
// asked; this module only speaks the protocol.
import { spawn } from 'node:child_process';
import { isRecord } from '@caduceus/contracts/policy/guards';
import os from 'node:os';
import readline from 'node:readline';

const PROTOCOL_VERSION = '2025-06-18';
/** The most a whole call (handshake, listing and the tool itself) may take. */
export const CALL_TIMEOUT_MS = 20_000;
/** The most text of a tool's answer that is kept. */
const MAX_ANSWER_CHARS = 200_000;

/** A server as Hermes's config describes it, reduced to what a connection needs. */
export type McpTarget =
  | { kind: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd: string | undefined }
  | { kind: 'http'; url: string; headers: Record<string, string> };

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] };
  annotations: Record<string, unknown>;
}

/** What a tool answered with: its text, any structured content, and whether it called the call a failure. */
export interface McpToolResult {
  text: string;
  structured: unknown;
  isError: boolean;
}

export class McpFailure extends Error {}

export interface McpConnection {
  tools(): Promise<McpTool[]>;
  call(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

interface Rpc {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
}

/** What the environment of a command holds besides what the server's config gives it: enough to find programs and a home, and none of Caduceus's own secrets. */
const BASE_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL'];

function toolOf(raw: unknown): McpTool[] {
  if (!isRecord(raw) || typeof raw.name !== 'string') return [];
  const schema = isRecord(raw.inputSchema) ? raw.inputSchema : {};
  const properties = isRecord(schema.properties) ? Object.fromEntries(Object.entries(schema.properties).map(([name, spec]) => [name, { type: isRecord(spec) && typeof spec.type === 'string' ? spec.type : undefined }])) : undefined;
  return [
    {
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : '',
      inputSchema: { properties, required: Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : undefined },
      annotations: isRecord(raw.annotations) ? raw.annotations : {},
    },
  ];
}

function resultOf(raw: unknown): McpToolResult {
  const record = isRecord(raw) ? raw : {};
  const blocks = Array.isArray(record.content) ? record.content : [];
  const text = blocks
    .flatMap((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
    .slice(0, MAX_ANSWER_CHARS);
  return { text, structured: record.structuredContent, isError: record.isError === true };
}

/** A connection over an `Rpc`: the handshake first, then the calls. */
async function handshake(rpc: Rpc): Promise<McpConnection> {
  await rpc.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'caduceus', version: '1.0.0' } });
  rpc.notify('notifications/initialized');
  return {
    async tools() {
      const listed = await rpc.request('tools/list');
      return isRecord(listed) && Array.isArray(listed.tools) ? listed.tools.flatMap(toolOf) : [];
    },
    async call(name, args) {
      return resultOf(await rpc.request('tools/call', { name, arguments: args }));
    },
  };
}

/** A server's JSON-RPC error as a failure, with a message that quotes none of `secrets`. */
function failure(error: unknown, secrets: string[]): McpFailure {
  const message = isRecord(error) && typeof error.message === 'string' ? error.message : 'The server reported an error.';
  return new McpFailure(secrets.reduce((text, secret) => (secret.length >= 6 ? text.split(secret).join('***') : text), message).slice(0, 300));
}

const secretsOf = (target: McpTarget): string[] => Object.values(target.kind === 'stdio' ? target.env : target.headers);

async function overStdio(target: Extract<McpTarget, { kind: 'stdio' }>, use: (connection: McpConnection) => Promise<unknown>, signal: AbortSignal): Promise<void> {
  const env: Record<string, string> = { ...Object.fromEntries(BASE_ENV.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]]))), ...target.env };
  const child = spawn(target.command, target.args, { env, cwd: target.cwd ?? os.homedir(), stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map<number, PromiseWithResolvers<unknown>>();
  const gone = Promise.withResolvers<never>();
  child.on('error', () => gone.reject(new McpFailure('The server’s command could not be started.')));
  child.on('exit', () => {
    const ended = new McpFailure('The server’s command ended before it answered.');
    gone.reject(ended);
    for (const answer of pending.values()) answer.reject(ended);
    pending.clear();
  });
  // A rejection nobody awaits (the command ended after the call was done) is not an error.
  gone.promise.catch(() => undefined);
  child.stdin.on('error', () => undefined);
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.id !== 'number') return;
    const answer = pending.get(message.id);
    if (!answer) return;
    pending.delete(message.id);
    if (message.error !== undefined) answer.reject(failure(message.error, secretsOf(target)));
    else answer.resolve(message.result);
  });
  let next = 0;
  const rpc: Rpc = {
    request(method, params) {
      const id = ++next;
      const answer = Promise.withResolvers<unknown>();
      pending.set(id, answer);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return Promise.race([answer.promise, gone.promise]);
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
  };
  const aborted = Promise.withResolvers<never>();
  aborted.promise.catch(() => undefined);
  const onAbort = () => aborted.reject(new McpFailure('The server did not answer in time.'));
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await Promise.race([handshake(rpc).then(use), aborted.promise, gone.promise]);
  } finally {
    signal.removeEventListener('abort', onAbort);
    child.stdin.destroy();
    child.kill('SIGKILL');
  }
}

/** The JSON-RPC messages in a body that is either JSON or a stream of server-sent events. */
function messagesIn(contentType: string, text: string): unknown[] {
  if (!contentType.includes('text/event-stream')) {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }
  const messages: unknown[] = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data === '') continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // An event that is not JSON-RPC is not an answer.
    }
  }
  return messages;
}

async function overHttp(target: Extract<McpTarget, { kind: 'http' }>, use: (connection: McpConnection) => Promise<unknown>, signal: AbortSignal): Promise<void> {
  let session: string | undefined;
  let next = 0;
  const post = async (body: Record<string, unknown>): Promise<Response> => {
    const headers: Record<string, string> = { ...target.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL_VERSION };
    if (session) headers['mcp-session-id'] = session;
    try {
      return await fetch(target.url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal });
    } catch {
      throw new McpFailure(signal.aborted ? 'The server did not answer in time.' : 'The server did not answer.');
    }
  };
  const rpc: Rpc = {
    async request(method, params) {
      const id = ++next;
      const res = await post({ jsonrpc: '2.0', id, method, params });
      session = res.headers.get('mcp-session-id') ?? session;
      if (res.status === 401 || res.status === 403) throw new McpFailure('The server refused the headers Hermes holds for it.');
      if (!res.ok) throw new McpFailure(`The server answered HTTP ${res.status}.`);
      const messages = messagesIn(res.headers.get('content-type') ?? '', await res.text());
      const answer = messages.find((message) => isRecord(message) && message.id === id);
      if (!isRecord(answer)) throw new McpFailure('The server gave no answer to the request.');
      if (answer.error !== undefined) throw failure(answer.error, secretsOf(target));
      return answer.result;
    },
    notify(method, params) {
      void post({ jsonrpc: '2.0', method, params }).then((res) => res.body?.cancel(), () => undefined);
    },
  };
  try {
    await handshake(rpc).then(use);
  } finally {
    if (session) {
      // Ends the session, as a client does; whether the server cares is its own business.
      void fetch(target.url, { method: 'DELETE', headers: { ...target.headers, 'mcp-session-id': session }, signal: AbortSignal.timeout(2000) }).then((res) => res.body?.cancel(), () => undefined);
    }
  }
}

/** Connects to `target`, runs `use` on the connection and disconnects, within `CALL_TIMEOUT_MS`. A failure to connect or to answer is an `McpFailure` with a plain message. */
export async function withMcpServer<T>(target: McpTarget, use: (connection: McpConnection) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
  let result: { value: T } | undefined;
  const capture = async (connection: McpConnection) => {
    result = { value: await use(connection) };
  };
  try {
    if (target.kind === 'stdio') await overStdio(target, capture, signal);
    else await overHttp(target, capture, signal);
  } catch (error) {
    if (error instanceof McpFailure) throw error;
    throw new McpFailure(signal.aborted ? 'The server did not answer in time.' : 'The server could not be used.');
  }
  if (!result) throw new McpFailure('The server gave no answer.');
  return result.value;
}
