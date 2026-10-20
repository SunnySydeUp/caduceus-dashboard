// A stand-in for the Telegram setup service Hermes's QR onboarding talks to (`TELEGRAM_ONBOARDING_URL`): it makes a pairing, says `waiting` until a test says the
// person scanned the QR (`scan`) and then hands over a bot token, or says the pairing expired (`expire`). Real Hermes runs against it; no Telegram is contacted.
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubTelegramSetup {
  readonly url: string;
  /** The person scanned the QR and Telegram made the bot. */
  scan(bot: { username: string; ownerUserId: string }): void;
  /** The pairing ran out. */
  expire(): void;
  /** What the service was asked, by method and path (the token a poll carries is never kept). */
  readonly requests: string[];
  close(): Promise<void>;
}

export async function startStubTelegramSetup(): Promise<StubTelegramSetup> {
  const pairings = new Map<string, { pollToken: string; state: 'waiting' | 'ready' | 'expired'; bot?: { username: string; ownerUserId: string } }>();
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const json = (body: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.method === 'POST' && req.url === '/v1/telegram/pairings') {
      const id = crypto.randomBytes(6).toString('hex');
      pairings.set(id, { pollToken: crypto.randomBytes(8).toString('hex'), state: 'waiting' });
      const link = `https://t.me/newbot/hermes_manager/hermes_${id}`;
      return json({ pairing_id: id, poll_token: pairings.get(id)!.pollToken, expires_at: new Date(Date.now() + 600_000).toISOString(), deep_link: link, qr_payload: link, suggested_username: `hermes_${id}_bot` });
    }
    const id = req.url?.split('/').pop() ?? '';
    const pairing = pairings.get(id);
    if (req.method === 'GET' && pairing && req.headers.authorization === `Bearer ${pairing.pollToken}`) {
      if (pairing.state === 'expired') return json({ error: 'expired' }, 410);
      if (pairing.state === 'ready') return json({ status: 'ready', token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789', bot_username: pairing.bot!.username, owner_user_id: pairing.bot!.ownerUserId });
      return json({ status: 'waiting' });
    }
    json({ error: 'not_found' }, 404);
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  const each = (change: (pairing: { state: 'waiting' | 'ready' | 'expired'; bot?: { username: string; ownerUserId: string } }) => void) => pairings.forEach(change);
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    scan: (bot) => each((pairing) => Object.assign(pairing, { state: 'ready', bot })),
    expire: () => each((pairing) => (pairing.state = 'expired')),
    requests,
    close() {
      const closed = Promise.withResolvers<void>();
      server.closeAllConnections();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
}
