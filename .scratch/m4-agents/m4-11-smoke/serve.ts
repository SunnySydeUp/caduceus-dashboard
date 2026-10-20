// Throwaway smoke server for M4 #11: Caduceus in front of a real Hermes in a temp HERMES_HOME. Run from the repo root: PORT=9250 npx tsx .scratch/m4-agents/m4-11-smoke/serve.ts
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';

const hermes = await launchTestHermes();
await hermes.backend.ready();
const server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, port: Number(process.env.PORT ?? 9250), webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)), hermesInstallDir: hermes.install.dir });
fs.writeFileSync('/tmp/caduceus-m4-11-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid} ${hermes.home}`);
process.once('SIGINT', async () => {
  await server.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m4-11-cookie', { force: true });
  process.exit(0);
});
