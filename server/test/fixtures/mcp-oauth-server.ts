// A local HTTP MCP server that wants OAuth, for tests of Hermes's MCP sign-in. It plays the resource server and the authorization
// server of the standard flow (protected-resource and authorization-server metadata, dynamic client registration, an authorize
// endpoint that redirects straight back with a code, a token endpoint) on 127.0.0.1, and serves one tool once a request carries
// the token it issued. With `refuse`, its token endpoint says no, so the sign-in fails with a reason. It never leaves this machine.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const ISSUED_TOKEN = 'fixture-access-token';

export interface McpOauthFixture {
  /** The server's MCP endpoint: put this URL in an `auth: oauth` server. */
  url: string;
  /** What the token endpoint was asked for, in order: the sign-in is over when `authorization_code` is here. */
  grants: string[];
  /** Makes the token endpoint refuse from now on. */
  refuse(): void;
  close(): Promise<void>;
}

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startMcpOauthFixture(): Promise<McpOauthFixture> {
  const grants: string[] = [];
  let refusing = false;
  const origin = () => `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;

  const listener = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin());
    const base = origin();
    if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (url.pathname.startsWith('/.well-known/oauth-authorization-server'))
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    if (url.pathname === '/register') {
      const request = JSON.parse((await readBody(req)) || '{}') as { redirect_uris?: string[] };
      return json(res, 201, { client_id: 'fixture-client', redirect_uris: request.redirect_uris ?? [], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    }
    if (url.pathname === '/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'fixture-code');
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: back.toString() });
      return void res.end();
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(await readBody(req));
      grants.push(form.get('grant_type') ?? '');
      if (refusing) return json(res, 400, { error: 'access_denied', error_description: 'The fixture refuses every sign-in.' });
      return json(res, 200, { access_token: ISSUED_TOKEN, token_type: 'Bearer', expires_in: 3600, refresh_token: 'fixture-refresh' });
    }
    if (url.pathname !== '/mcp') return json(res, 404, { error: 'not found' });

    const body = await readBody(req);
    if (req.headers.authorization !== `Bearer ${ISSUED_TOKEN}`) return json(res, 401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` });
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const message = JSON.parse(body) as { id?: number; method: string; params?: { protocolVersion?: string } };
    if (message.id === undefined) {
      res.writeHead(202);
      return void res.end();
    }
    if (message.method === 'initialize') return json(res, 200, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'caduceus-oauth-fixture', version: '1.0.0' } } });
    if (message.method === 'tools/list') return json(res, 200, { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'whoami', description: 'Say who is signed in.', inputSchema: { type: 'object', properties: {} } }] } });
    return json(res, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  });
  const listening = Promise.withResolvers<void>();
  listener.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  return {
    url: `${origin()}/mcp`,
    grants,
    refuse: () => void (refusing = true),
    async close() {
      const closed = Promise.withResolvers<void>();
      listener.close(() => closed.resolve());
      listener.closeAllConnections();
      await closed.promise;
    },
  };
}
