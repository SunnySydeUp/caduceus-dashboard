// Throwaway smoke server for M4 #02 (and #09): Caduceus in front of a real Hermes in a temp HERMES_HOME with a profile that has
// behaviour files. Run from the repo root: PORT=9250 npx tsx .scratch/m4-agents/m4-02-smoke/serve.ts   (stop it with SIGINT)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { startStubLlm } from '../../../server/test/fixtures/stub-llm.ts';

const hermes = await launchTestHermes();
await hermes.backend.ready();
const llm = await startStubLlm();
llm.connect(hermes);
const call = async (method: string, path: string, body?: unknown) => {
  const res = await hermes.backend.fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return JSON.parse(text);
};
await call('POST', '/api/profiles', { name: 'scratch' });
await call('POST', '/api/profiles/scratch/describe-auto', { overwrite: true });
await call('POST', '/api/profiles', { name: 'coder' });
const home = (await call('GET', '/api/profiles')).profiles.find((p: { name: string }) => p.name === 'coder').path as string;
await call('PUT', '/api/profiles/coder/soul', { content: '# Coder\n\nYou are a careful senior engineer.\n\n- Read the code first.\n- Write the test before the fix.\n' });
await call('POST', '/api/fs/write-text', { path: `${home}/AGENTS.md`, content: '# Rules\n\n1. Small commits.\n2. Never push to main.\n' });
await call('POST', '/api/fs/write-text', { path: `${home}/memories/MEMORY.md`, content: 'Uses pnpm, not npm.\n§\nRuns tests with vitest.\n' });
await call('POST', '/api/fs/write-text', { path: `${home}/memories/USER.md`, content: 'Name: Sam. Prefers short answers.\n' });
const raw = (await call('GET', '/api/config/raw?profile=coder')).yaml as string;
await call('PUT', '/api/config/raw?profile=coder', { yaml_text: `${raw}\nauxiliary:\n  vision:\n    api_key: sk-smoke-secret-0123456789\n    model: small\n` });
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: Number(process.env.PORT ?? 9250),
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m4-02-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  await server.close();
  await llm.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m4-02-cookie', { force: true });
  process.exit(0);
});
