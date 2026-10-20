// Throwaway server for the M0 #09 browser checks (not part of `npm test`): Caduceus on 127.0.0.1:9190 in front of the real
// `hermes serve` in a temp HERMES_HOME, with the owner already set up. Never touches ~/.hermes, :9119, :8787 or the gateway.
//
//   npm run build -w web && npx tsx .scratch/m0-foundation/m0-09-smoke/serve.ts
//
// Open it at http://localhost:9190. It writes the signed-in session cookie (a throwaway owner of a throwaway home) to
// /tmp/caduceus-m0-09-cookie, mode 600, and prints `READY <url>`. Hermes restarts after 10 s here, so the page stays in
// `reconnecting` long enough to be looked at. Signals drive the faults the page has to show:
//   SIGUSR1  kill the private Hermes outright (the page goes reconnecting, then connected after the restart)
//   SIGUSR2  stop Caduceus; again, start it anew on the same port (the page goes offline, then connected)
// SIGINT stops everything and deletes the temp home.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer, type CaduceusServer } from '../../../server/src/caduceus-server.ts';
import { killHermes, launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';

const hermes = await launchTestHermes({ restartDelaysMs: [10_000] });
await new Promise<void>((resolve) => (hermes.backend.status.state === 'ready' ? resolve() : hermes.backend.once('ready', () => resolve())));
const start = () =>
  startCaduceusServer({
    backend: hermes.backend,
    hermesRoot: hermes.home,
    port: 9190,
    webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
    hermesInstallDir: hermes.install.dir,
  });
let server: CaduceusServer | undefined = await start();
fs.writeFileSync('/tmp/caduceus-m0-09-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url}`);

process.on('SIGUSR1', () => {
  killHermes(hermes);
  console.log('KILLED hermes');
});
process.on('SIGUSR2', async () => {
  if (server) {
    const stopping = server;
    server = undefined;
    await stopping.close();
    console.log('CADUCEUS STOPPED');
  } else {
    server = await start();
    console.log('CADUCEUS STARTED');
  }
});
process.once('SIGINT', async () => {
  await server?.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m0-09-cookie', { force: true });
  process.exit(0);
});
