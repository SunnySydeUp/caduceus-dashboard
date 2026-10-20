// Throwaway smoke server for M5 #10 gaps: Caduceus in front of a real Hermes in a temp HERMES_HOME, a local MiniMax device-code portal,
// a stub LLM, some made-up keys and one custom endpoint, and a software passkey that renews the owner's step-up grant every minute.
// Run from the repo root: PORT=9300 npx tsx .scratch/m5-operate/m5-10-smoke/serve.ts   (stop it with SIGINT)
// The portal's approve/deny is on PORTAL_PORT (default PORT+1): GET /approve, /deny, or /next (back to waiting).
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { addPasskey, stepUp } from '../../../server/test/fixtures/step-up.ts';
import { startDevicePortal } from '../../../server/test/fixtures/device-code-portal.ts';
import { startStubLlm } from '../../../server/test/fixtures/stub-llm.ts';

const port = Number(process.env.PORT ?? 9300);
const portal = await startDevicePortal();
const hermes = await launchTestHermes({ env: { MINIMAX_PORTAL_BASE_URL: portal.url } });
await hermes.backend.ready();
const llm = await startStubLlm();
llm.connect(hermes);
const call = async (method: string, path: string, body?: unknown) => {
  const res = await hermes.backend.fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
};
await call('PUT', '/api/env', { key: 'FIREWORKS_API_KEY', value: 'fw-FAKE-0123456789-abcdefghij' });
await call('PUT', '/api/env', { key: 'OPENROUTER_API_KEY', value: 'sk-or-FAKE-0123456789-abcdefghij' });
await call('POST', '/api/providers/custom-endpoints', { name: 'Local vLLM', base_url: llm.baseUrl, model: 'stub-model', api_mode: '', discover_models: false, api_key: 'ep-SECRET-5566778899', context_length: 32000 });
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port,
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
const cookie = await ownerCookie(server.url);
fs.writeFileSync('/tmp/caduceus-m5-10-cookie', cookie, { mode: 0o600 });
const authenticator = await addPasskey(server.url, cookie);
await stepUp(server.url, cookie, authenticator);
const renew = setInterval(() => void stepUp(server.url, cookie, authenticator), 60_000);
const control = http.createServer((req, res) => {
  if (req.url === '/approve') portal.approve();
  if (req.url === '/deny') portal.deny();
  if (req.url === '/next') portal.next(600);
  res.end('ok');
});
control.listen(Number(process.env.PORTAL_PORT ?? port + 1), '127.0.0.1');
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  clearInterval(renew);
  control.close();
  await server.close();
  await llm.close();
  await hermes.stop();
  await portal.close();
  fs.rmSync('/tmp/caduceus-m5-10-cookie', { force: true });
  process.exit(0);
});
