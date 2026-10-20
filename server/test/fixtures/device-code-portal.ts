// A local stand-in for MiniMax's OAuth portal, for tests of Hermes's device-code sign-in (M5 #10). Hermes reads the portal's address from
// `MINIMAX_PORTAL_BASE_URL`, so a test starts this before it launches Hermes and passes the address in the launch environment: the
// sign-in then never leaves this machine. The portal gives out a user code and a verification page; Hermes polls the token endpoint,
// which answers `pending` until the test says what the person did on the page: `approve()` or `deny()`. It checks the PKCE verifier
// against the challenge it was given, as the real portal does.
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const PORTAL_USER_CODE = 'WDJB-MJHT';
/** The token the portal issues. Never in a log, an audit row or any answer the browser gets. */
export const PORTAL_ACCESS_TOKEN = 'portal-access-token-0123456789';
export const PORTAL_REFRESH_TOKEN = 'portal-refresh-token-0123456789';

export interface DevicePortal {
  /** The portal's address: the value of `MINIMAX_PORTAL_BASE_URL`. */
  url: string;
  /** What the portal has been asked, in order: `code` for each sign-in started, `token` for each poll. */
  requests: string[];
  /** The person approves the sign-in on the verification page: Hermes's next poll is given a token. */
  approve(): void;
  /** The person declines it: Hermes's next poll is told so. */
  deny(): void;
  /** Sets how long the codes the portal gives out from now on live, in seconds, and puts the portal back to waiting for the person. */
  next(expiresIn: number): void;
  close(): Promise<void>;
}

export interface DevicePortalOptions {
  /** How long the code lives, in seconds, as the portal says it. Short, and Hermes stops waiting for the person. */
  expiresIn?: number;
  /** The port to listen on; any free one when not given. */
  port?: number;
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export async function startDevicePortal({ expiresIn: lifetime = 600, port = 0 }: DevicePortalOptions = {}): Promise<DevicePortal> {
  const requests: string[] = [];
  let expiresIn = lifetime;
  let verdict: 'pending' | 'approved' | 'denied' = 'pending';
  let challenge = '';
  let state = '';
  const origin = () => `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;

  const listener = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin());
    if (req.method === 'POST' && url.pathname === '/oauth/code') {
      const form = await readForm(req);
      requests.push('code');
      challenge = form.get('code_challenge') ?? '';
      state = form.get('state') ?? '';
      return json(res, 200, { user_code: PORTAL_USER_CODE, verification_uri: `${origin()}/device`, expired_in: expiresIn, interval: 2000, state });
    }
    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      const form = await readForm(req);
      requests.push('token');
      const verifier = form.get('code_verifier') ?? '';
      const matches = crypto.createHash('sha256').update(verifier).digest('base64url') === challenge;
      if (!matches || form.get('user_code') !== PORTAL_USER_CODE) return json(res, 400, { base_resp: { status_msg: 'The code or its verifier does not match.' } });
      if (verdict === 'denied') return json(res, 200, { status: 'error' });
      if (verdict === 'pending') return json(res, 200, { status: 'pending' });
      return json(res, 200, { status: 'success', access_token: PORTAL_ACCESS_TOKEN, refresh_token: PORTAL_REFRESH_TOKEN, expired_in: 3600 });
    }
    return json(res, 404, { error: 'not found' });
  });
  const listening = Promise.withResolvers<void>();
  listener.listen(port, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  return {
    url: origin(),
    requests,
    approve: () => void (verdict = 'approved'),
    deny: () => void (verdict = 'denied'),
    next(seconds) {
      expiresIn = seconds;
      verdict = 'pending';
    },
    async close() {
      const closed = Promise.withResolvers<void>();
      listener.close(() => closed.resolve());
      listener.closeAllConnections();
      await closed.promise;
    },
  };
}
