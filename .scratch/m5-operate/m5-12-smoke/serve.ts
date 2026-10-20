// Throwaway smoke server for M5 #12: Caduceus in front of the FAKE Hermes (a stand-in whose `hermes update` is driven by hand; nothing is ever updated) with a
// throwaway git checkout as its own deployment and a restart hook that only logs. Writes /tmp/caduceus-m5-12.json with the owner's cookie.
// Run from the repo root: PORT=9250 npx tsx .scratch/m5-operate/m5-12-smoke/serve.ts   (stop it with SIGINT)
// Control on PORT+1:  /stepup  (a passkey step-up for the browser's session)  /line?text=…  /finish?ok=1  /check?behind=3  /publish  /ready (is the log running)
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { createDeploymentRepo } from '../../../server/test/fixtures/deployment-repo.ts';
import { fakeHermesInstall, fakeStateDir, launchFakeHermes, scriptFakeHermes } from '../../../server/test/fixtures/fake-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import fsx from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.env.PORT ?? 9250);
const host = `http://agents.localhost:${port}`;
const state = fakeStateDir();
const install = fakeHermesInstall();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
const repo = createDeploymentRepo();
const backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: state } });
let restarts = 0;
const server = await startCaduceusServer({
  backend,
  hermesRoot: root,
  port,
  publicOrigin: host,
  rpId: 'agents.localhost',
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: install,
  deployment: repo.deployment,
  restart: () => void console.log(`RESTART requested (${++restarts})`),
  updatePollMs: 300,
  drainTimeoutMs: 3000,
});
await backend.ready();
const cookie = await ownerCookie(server.url);
fs.writeFileSync('/tmp/caduceus-m5-12.json', JSON.stringify({ cookie, host }), { mode: 0o600 });
const check = (behind: number) =>
  scriptFakeHermes(backend, {
    '/api/hermes/update/check': {
      install_method: 'git', current_version: '0.21.4', behind, update_available: behind > 0, can_apply: true, update_command: 'hermes update', message: behind > 0 ? null : "You're on the latest version.",
      ...(behind > 0 ? { commits: [{ sha: 'a'.repeat(40), summary: 'Add dark mode to the TUI', author: 'Ada', at: '2026-10-18T00:00:00Z' }, { sha: 'b'.repeat(40), summary: 'Fix a race in the cron ticker that dropped a job', author: 'Grace', at: '2026-10-17T00:00:00Z' }] } : {}),
    },
  });
await check(2);
await scriptFakeHermes(backend, { '/api/profiles/active': { active: 'default' } });
let published = 0;
const control = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/line') await backend.fetch('/api/__fake/update', { method: 'POST', body: JSON.stringify({ line: url.searchParams.get('text') }) });
  if (url.pathname === '/finish') {
    const ok = url.searchParams.get('ok') !== '0';
    await backend.fetch('/api/__fake/update', { method: 'POST', body: JSON.stringify({ finish: ok ? { exit_code: 0, receipt: { outcome: 'success', post_update: { sha: 'bbbb', version: '0.22.0' } }, ...(url.searchParams.get('drift') ? { dropRoutes: ['/api/gateway/drain'] } : {}) } : { exit_code: 1 } }) });
  }
  if (url.pathname === '/check') await check(Number(url.searchParams.get('behind') ?? 0));
  if (url.pathname === '/publish') repo.publish(`Change number ${++published}`, { [`change-${published}.txt`]: 'x' });
  res.end('ok');
});
control.listen(port + 1, '127.0.0.1');
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  control.close();
  await server.close();
  await backend.stop();
  repo.remove();
  for (const dir of [state, install, root]) fs.rmSync(dir, { recursive: true, force: true });
  fsx.rmSync('/tmp/caduceus-m5-12.json', { force: true });
  process.exit(0);
});
