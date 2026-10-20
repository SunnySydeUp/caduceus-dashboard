// A notes source over MCP's streamable HTTP transport for tests (M4 #10): one POST endpoint for JSON-RPC, which answers `initialize` with a session id, a
// notification with 202, `tools/list` as a server-sent event and `tools/call` as plain JSON, so both answer forms are read. Its tools are the notes tools of
// `mcp-server.mjs --notes` (search and read, a create that must never be called). It records every request's headers and every tool it was asked to call.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface McpHttpServer {
  readonly url: string;
  /** The tools called, in order. */
  readonly calls: string[];
  /** The `authorization` and `mcp-session-id` headers of every POST. */
  readonly headers: { authorization: string | undefined; session: string | undefined }[];
  close(): Promise<void>;
}

const TOOLS = [
  { name: 'search_notes', description: 'Search the notes.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'read_note', description: 'Read a note.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_note', description: 'Create a note.', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
];

export async function startMcpHttpServer({ key }: { key?: string } = {}): Promise<McpHttpServer> {
  const calls: string[] = [];
  const headers: McpHttpServer['headers'] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (req.method === 'DELETE') return void res.writeHead(204).end();
    if (req.method !== 'POST') return void res.writeHead(405).end();
    headers.push({ authorization: req.headers.authorization, session: req.headers['mcp-session-id'] as string | undefined });
    if (key !== undefined && req.headers.authorization !== `Bearer ${key}`) return void res.writeHead(401).end();
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    if (message.id === undefined) return void res.writeHead(202).end();
    const json = (result: unknown, extra: Record<string, string> = {}) => {
      res.writeHead(200, { 'content-type': 'application/json', ...extra });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    };
    switch (message.method) {
      case 'initialize':
        return json({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-notes', version: '1.0.0' } }, { 'mcp-session-id': 'session-1' });
      case 'tools/list':
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return void res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } })}\n\n`);
      case 'tools/call': {
        calls.push(message.params?.name ?? '');
        if (message.params?.name === 'search_notes') {
          return json({ content: [{ type: 'text', text: JSON.stringify([{ path: 'inbox/ideas.md', name: 'Ideas', content: `An idea about ${String(message.params.arguments?.query)}.` }]) }] });
        }
        if (message.params?.name === 'read_note') return json({ content: [{ type: 'text', text: `# Ideas\n\nRead ${String(message.params.arguments?.id)}.` }] });
        return json({ content: [{ type: 'text', text: 'done' }] });
      }
      default:
        res.writeHead(200, { 'content-type': 'application/json' });
        return void res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    calls,
    headers,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
