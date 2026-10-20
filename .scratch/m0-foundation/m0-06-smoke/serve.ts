// Throwaway server for the M0 #06 browser checks (not part of `npm test`): Caduceus on 127.0.0.1:9160 in front of the real
// `hermes serve` in a temp HERMES_HOME, with the owner already set up. Never touches ~/.hermes, :9119, :8787 or the gateway.
//
//   npm run build -w web && npx tsx .scratch/m0-foundation/m0-06-smoke/serve.ts
//
// It writes the signed-in session cookie (a throwaway owner of a throwaway home) to /tmp/caduceus-m0-06-cookie, mode 600, and
// prints `READY <url>`. SIGINT stops everything and deletes the temp home.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';

const hermes = await launchTestHermes();
await new Promise<void>((resolve) => (hermes.backend.status.state === 'ready' ? resolve() : hermes.backend.once('ready', () => resolve())));
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: 9160,
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m0-06-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url}`);

process.once('SIGINT', async () => {
  await server.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m0-06-cookie', { force: true });
  process.exit(0);
});
