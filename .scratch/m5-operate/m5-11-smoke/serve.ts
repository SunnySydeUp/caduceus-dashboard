// Throwaway smoke server for M5 #11: Caduceus in front of a real Hermes in a temp HERMES_HOME that cannot reach the internet (OFFLINE_ENV),
// with two plugins that live in local git repositories. Writes /tmp/caduceus-m5-11.json with the owner's cookie and the repositories' addresses.
// Run from the repo root: PORT=9310 npx tsx .scratch/m5-operate/m5-11-smoke/serve.ts   (stop it with SIGINT)
// GET http://127.0.0.1:<PORT+1>/commit/<name> commits to a repository, so an installed plugin has an update.
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { createPluginRepo, OFFLINE_ENV } from '../../../server/test/fixtures/plugin-repo.ts';

const port = Number(process.env.PORT ?? 9310);
const repos = {
  notes: createPluginRepo({ name: 'fixture-notes', description: 'Keeps notes for the agent. Made for the smoke test.', requiresEnv: ['NOTES_API_KEY'] }),
  tools: createPluginRepo({ name: 'fixture-tools', version: '0.3.1', description: 'A second plugin, to see more than one card.' }),
};
const hermes = await launchTestHermes({ env: OFFLINE_ENV });
await hermes.backend.ready();
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port,
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
const cookie = await ownerCookie(server.url);
fs.writeFileSync('/tmp/caduceus-m5-11.json', JSON.stringify({ cookie, notes: repos.notes.url, tools: repos.tools.url }), { mode: 0o600 });
let commits = 0;
const control = http.createServer((req, res) => {
  const name = req.url?.replace('/commit/', '');
  if (name === 'notes' || name === 'tools') repos[name].commit(`change-${++commits}.txt`, `change ${commits}\n`, `Change number ${commits}`);
  res.end('ok');
});
control.listen(port + 1, '127.0.0.1');
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  control.close();
  await server.close();
  await hermes.stop();
  for (const repo of Object.values(repos)) repo.remove();
  fs.rmSync('/tmp/caduceus-m5-11.json', { force: true });
  process.exit(0);
});
