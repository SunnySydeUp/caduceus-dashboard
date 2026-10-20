// Throwaway smoke server for M4 #12: Caduceus in front of a real Hermes in a temp HERMES_HOME with a local skills hub.
// Run from the repo root: PORT=9252 npx tsx .scratch/m4-agents/m4-12-smoke/serve.ts
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { createHubFixture } from '../../../server/test/fixtures/hub-fixture.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';

const hub = createHubFixture();
hub.put({ category: 'writing', name: 'press-release', description: 'Draft a press release from a list of facts.', tags: ['writing'] });
hub.put({ category: 'devops', name: 'deploy-check', description: 'Check a deploy before it goes out.' });
const hermes = await launchTestHermes({ env: hub.env });
await hermes.backend.ready();
await hermes.cli('profile', 'create', 'coder');
const server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, port: Number(process.env.PORT ?? 9252), webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)), hermesInstallDir: hermes.install.dir });
fs.writeFileSync('/tmp/caduceus-m4-12-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid} ${hermes.home}`);
const stop = async () => {
  await server.close();
  await hermes.stop();
  hub.remove();
  fs.rmSync('/tmp/caduceus-m4-12-cookie', { force: true });
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
