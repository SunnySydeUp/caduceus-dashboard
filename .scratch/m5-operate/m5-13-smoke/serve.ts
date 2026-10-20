// Throwaway smoke server for M5 #13: Caduceus in front of a real Hermes in a temp HERMES_HOME that cannot reach the internet (OFFLINE_ENV), with a restart hook
// that only logs. Writes /tmp/caduceus-m5-13.json with the owner's cookie. Never click "Upload debug report" through to the end: it would try to reach a paste service.
// Run from the repo root: PORT=9250 npx tsx .scratch/m5-operate/m5-13-smoke/serve.ts   (stop it with SIGINT)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { OFFLINE_ENV } from '../../../server/test/fixtures/plugin-repo.ts';

const port = Number(process.env.PORT ?? 9250);
const host = `http://agents.localhost:${port}`;
const hermes = await launchTestHermes({ env: OFFLINE_ENV });
await hermes.backend.ready();
let restarts = 0;
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port,
  publicOrigin: host,
  rpId: 'agents.localhost',
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
  restart: () => void console.log(`RESTART requested (${++restarts})`),
  drainTimeoutMs: 3000,
});
const cookie = await ownerCookie(server.url);
fs.writeFileSync('/tmp/caduceus-m5-13.json', JSON.stringify({ cookie, host }), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  await server.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m5-13.json', { force: true });
  process.exit(0);
});
