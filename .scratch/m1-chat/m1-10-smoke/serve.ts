// Throwaway server for the M1 #10 browser checks: Caduceus in front of a real `hermes serve` in a temp HERMES_HOME whose model is a stub LLM, with a
// stand-in `pdftoppm` on Hermes's PATH (this Mac has none) and a workspace of files. Writes the owner's cookie to /tmp/caduceus-m1-10-cookie.
// SIGINT stops everything and removes the temp dirs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { startStubLlm } from '../../../server/test/fixtures/stub-llm.ts';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-m1-10-tools-'));
fs.writeFileSync(path.join(tools, 'pdftoppm'), `#!/bin/sh\nfor last; do :; done\nfor page in 1 2; do echo ${PIXEL} | base64 -d > "$last-$page.png"; done\n`, { mode: 0o755 });
const hermes = await launchTestHermes({ env: { PATH: `${tools}:${process.env.PATH}` } });
await hermes.backend.ready();
const llm = await startStubLlm();
llm.connect(hermes);
const env = { ...process.env, HERMES_HOME: hermes.home };
execFileSync('hermes', ['config', 'set', 'tools.tool_search.enabled', 'off'], { env, stdio: 'pipe' });
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-m1-10-work-')));
fs.mkdirSync(path.join(work, 'src'));
fs.writeFileSync(path.join(work, 'README.md'), '# Work\n');
fs.writeFileSync(path.join(work, 'src', 'index.ts'), 'export {};\n');
execFileSync('hermes', ['config', 'set', 'terminal.cwd', work], { env, stdio: 'pipe' });
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: Number(process.env.PORT ?? 9210),
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m1-10-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid} ${work} ${hermes.home}`);
process.once('SIGINT', async () => {
  await server.close();
  await llm.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m1-10-cookie', { force: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(tools, { recursive: true, force: true });
  process.exit(0);
});
