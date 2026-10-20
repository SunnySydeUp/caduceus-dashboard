// A local OpenID Connect identity provider for tests (the system boundary of OIDC sign-in): discovery, an authorize endpoint that approves at once for whoever
// `identity` says is signing in, a token endpoint that checks the code, the PKCE verifier, the redirect URI and the client's secret, and the signing keys. What the
// ID token claims can be bent per test (`claims`): a wrong issuer, audience or user, an expired token, a wrong nonce.
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubOidc {
  /** The issuer a client configures. */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Who signs in at the provider next, and what else the ID token claims (merged over the usual claims). */
  identity: { sub: string; email: string; email_verified: boolean };
  claims: Record<string, unknown>;
  /** What the discovery document says the issuer is; the real issuer by default. */
  discoveryIssuer: string | undefined;
  /** Signs the next ID tokens with a key the provider does not publish. */
  signWithUnpublishedKey: boolean;
  /** The token requests the provider received, as the form fields they carried. */
  readonly tokenRequests: Record<string, string>[];
  close(): Promise<void>;
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

export async function startStubOidc(): Promise<StubOidc> {
  const signing = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...signing.publicKey.export({ format: 'jwk' }), kid: 'stub-key', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string; identity: StubOidc['identity'] }>();
  const stub: StubOidc = {
    issuer: '',
    clientId: 'caduceus-test',
    clientSecret: 'a client secret',
    identity: { sub: 'user-1', email: 'owner@example.com', email_verified: true },
    claims: {},
    discoveryIssuer: undefined,
    signWithUnpublishedKey: false,
    tokenRequests: [],
    close: () => Promise.resolve(),
  };

  const idToken = (nonce: string, identity: StubOidc['identity']) => {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'stub-key' };
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: stub.issuer, aud: stub.clientId, iat: now, exp: now + 300, nonce, ...identity, ...stub.claims };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = crypto.sign('sha256', Buffer.from(input), stub.signWithUnpublishedKey ? other.privateKey : signing.privateKey);
    return `${input}.${b64url(signature)}`;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, stub.issuer);
    const json = (body: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: stub.discoveryIssuer ?? stub.issuer,
        authorization_endpoint: `${stub.issuer}/authorize`,
        token_endpoint: `${stub.issuer}/token`,
        jwks_uri: `${stub.issuer}/jwks`,
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      if (q.get('client_id') !== stub.clientId || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state') || !q.get('nonce') || !q.get('redirect_uri')) {
        return json({ error: 'invalid_request' }, 400);
      }
      const code = crypto.randomBytes(12).toString('hex');
      codes.set(code, { nonce: q.get('nonce')!, challenge: q.get('code_challenge')!, redirectUri: q.get('redirect_uri')!, identity: { ...stub.identity } });
      const back = new URL(q.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state')!);
      return void res.writeHead(302, { location: back.toString() }).end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const form = Object.fromEntries(new URLSearchParams(raw));
        const basic = req.headers.authorization?.startsWith('Basic ') ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString() : undefined;
        const secret = form.client_secret ?? basic?.split(':').slice(1).join(':');
        stub.tokenRequests.push(form);
        const issued = codes.get(form.code);
        codes.delete(form.code);
        const verifier = form.code_verifier ? b64url(crypto.createHash('sha256').update(form.code_verifier).digest()) : undefined;
        if (!issued || form.grant_type !== 'authorization_code' || form.redirect_uri !== issued.redirectUri || verifier !== issued.challenge || secret !== stub.clientSecret) {
          return json({ error: 'invalid_grant' }, 400);
        }
        json({ access_token: 'unused', token_type: 'Bearer', id_token: idToken(issued.nonce, issued.identity) });
      });
      return;
    }
    json({ error: 'not_found' }, 404);
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  Object.assign(stub, { issuer: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  stub.close = () => {
    const closed = Promise.withResolvers<void>();
    server.closeAllConnections();
    server.close(() => closed.resolve());
    return closed.promise;
  };
  return stub;
}
