// Throwaway server for the M0 #11 browser checks (not part of `npm test`): Caduceus on 127.0.0.1:9191 in front of the real
// `hermes serve` in a temp HERMES_HOME, with the owner already set up. Never touches ~/.hermes, :9119, :8787 or the gateway.
//
//   npm run build -w web && npx tsx .scratch/m0-foundation/m0-11-smoke/serve.ts          (MISMATCH=1 pins a contract Hermes lacks)
//
// Open it at http://localhost:9191. It writes the signed-in session cookie (a throwaway owner of a throwaway home) to
// /tmp/caduceus-m0-11-cookie, mode 600, and prints `READY <url> <pid>`. Signals drive the faults Health has to show:
//   SIGUSR1  kill the private Hermes outright (a crash: Health counts it; three in an hour are a Repair)
//   SIGUSR2  put the scheduler in trouble (a job, and a ticker heartbeat three hours old); again: it ticks again
// SIGINT stops everything and deletes the temp home.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { loadPinnedContracts } from '../../../server/src/hermes-contract.ts';
import { killHermes, launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';

const hermes = await launchTestHermes({ restartDelaysMs: [2_000] });
await hermes.backend.ready();
const pin = await loadPinnedContracts();
const pinned = process.env.MISMATCH ? { ...pin, rest: { ...pin.rest, paths: { ...pin.rest.paths, '/api/retired': { get: { responses: {} } } } } } : pin;
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: 9191,
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
  pinned,
});
fs.writeFileSync('/tmp/caduceus-m0-11-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid}`);

process.on('SIGUSR1', () => {
  killHermes(hermes);
  console.log('KILLED hermes');
});
let stale = false;
process.on('SIGUSR2', async () => {
  const heartbeat = path.join(hermes.home, 'cron', 'ticker_heartbeat');
  if (!fs.existsSync(heartbeat)) {
    await hermes.backend.fetch('/api/cron/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'say hello', schedule: 'every 1h', name: 'Smoke test job' }) });
    fs.mkdirSync(path.dirname(heartbeat), { recursive: true });
  }
  stale = !stale;
  fs.writeFileSync(heartbeat, String(Date.now() / 1000 - (stale ? 3 * 3600 : 0)));
  console.log(stale ? 'SCHEDULER STALE' : 'SCHEDULER TICKING');
});
process.once('SIGINT', async () => {
  await server.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m0-11-cookie', { force: true });
  process.exit(0);
});
