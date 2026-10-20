// A local stand-in for Honcho's OAuth server, for tests of Hermes's memory-provider sign-in. Hermes is pointed at it with
// `HONCHO_OAUTH_AUTHORIZE_URL` and `HONCHO_OAUTH_TOKEN_URL` (its `env`). Its authorize page sends the browser straight back to the
// address Hermes gave with a code, and its token endpoint hands out a grant, so a sign-in completes with no human; with `refuse()` the
// token endpoint says no instead. A `BROWSER` script (`openerScript`) plays the browser Hermes opens on its own computer by fetching the
// page and following the redirect. Nothing leaves this machine.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

export interface HonchoOauthFixture {
  /** The environment Hermes needs to use this server and this "browser". */
  env: Record<string, string>;
  /** What the token endpoint was asked for, in order: the sign-in is over when `authorization_code` is here. */
  grants: string[];
  /** The authorize pages that were opened, in order. */
  authorizations: URL[];
  /** Makes the token endpoint refuse, or accept again. */
  refuse(refusing?: boolean): void;
  close(): Promise<void>;
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export async function startHonchoOauthFixture(): Promise<HonchoOauthFixture> {
  const grants: string[] = [];
  const authorizations: URL[] = [];
  let refusing = false;
  const origin = () => `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;

  const listener = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin());
    if (url.pathname === '/authorize') {
      authorizations.push(url);
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'fixture-code');
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: back.toString() });
      return void res.end();
    }
    if (url.pathname === '/oauth/token') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      grants.push(new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('grant_type') ?? '');
      if (refusing) return json(res, 400, { error: 'access_denied', error_description: 'The fixture refuses every sign-in.' });
      return json(res, 200, { access_token: 'hch-at-fixture-access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'hch-rt-fixture-refresh' });
    }
    return json(res, 404, { error: 'not found' });
  });
  const listening = Promise.withResolvers<void>();
  listener.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-honcho-oauth-'));
  const opener = path.join(dir, 'open-url.sh');
  fs.writeFileSync(opener, '#!/bin/sh\ncurl -sL --max-time 20 -o /dev/null "$1"\n', { mode: 0o755 });

  return {
    env: { HONCHO_OAUTH_AUTHORIZE_URL: `${origin()}/authorize`, HONCHO_OAUTH_TOKEN_URL: `${origin()}/oauth/token`, BROWSER: opener },
    grants,
    authorizations,
    refuse: (now = true) => void (refusing = now),
    async close() {
      const closed = Promise.withResolvers<void>();
      listener.close(() => closed.resolve());
      listener.closeAllConnections();
      await closed.promise;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
