// Throwaway server for the M1 #08 browser checks: Caduceus in front of a real `hermes serve` in a temp HERMES_HOME whose model is a stub LLM, with a second
// profile. Writes the owner's cookie to /tmp/caduceus-m1-08-cookie. SIGINT stops everything and removes the temp dirs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { startStubLlm } from '../../../server/test/fixtures/stub-llm.ts';

const hermes = await launchTestHermes();
await hermes.backend.ready();
const llm = await startStubLlm();
llm.connect(hermes);
execFileSync('hermes', ['config', 'set', 'tools.tool_search.enabled', 'off'], { env: { ...process.env, HERMES_HOME: hermes.home }, stdio: 'pipe' });
await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'coder' }) });
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-m1-08-work-')));
const filler = 'A long answer about nothing in particular. '.repeat(40);
for (let turn = 1; turn <= 6; turn += 1) llm.nextReply({ chunks: [filler], usage: { prompt: 20000 * turn, completion: 50 } });
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: Number(process.env.PORT ?? 9241),
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m1-08-cookie', await ownerCookie(server.url), { mode: 0o600 });
fs.writeFileSync('/tmp/caduceus-m1-08-work', work);
console.log(`READY ${server.url} ${process.pid} ${work}`);
process.once('SIGINT', async () => {
  await server.close();
  await llm.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m1-08-cookie', { force: true });
  fs.rmSync('/tmp/caduceus-m1-08-work', { force: true });
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
});
