// Throwaway server for the M0 #08 browser checks (not part of `npm test`): Caduceus on 127.0.0.1:9180 in front of the real
// `hermes serve` in a temp HERMES_HOME, with the owner already set up. Never touches ~/.hermes, :9119, :8787 or the gateway.
//
//   npm run build -w web && npx tsx .scratch/m0-foundation/m0-08-smoke/serve.ts
//
// Open it at http://localhost:9180 (not 127.0.0.1): passkeys are bound to the `localhost` relying party. It writes the
// signed-in session cookie (a throwaway owner of a throwaway home) to /tmp/caduceus-m0-08-cookie, mode 600, and prints
// `READY <url>`. File writes are allowed only in /tmp/caduceus-m0-08-work. SIGINT stops everything and deletes the temp homes.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';

const hermes = await launchTestHermes();
await new Promise<void>((resolve) => (hermes.backend.status.state === 'ready' ? resolve() : hermes.backend.once('ready', () => resolve())));
const work = '/tmp/caduceus-m0-08-work';
fs.mkdirSync(work, { recursive: true });
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: 9180,
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
  fileRoots: [work],
});
fs.writeFileSync('/tmp/caduceus-m0-08-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url}`);

process.once('SIGINT', async () => {
  await server.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m0-08-cookie', { force: true });
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
});
