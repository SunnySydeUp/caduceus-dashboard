// Throwaway smoke server for M4 #01: Caduceus in front of a real Hermes in a temp HERMES_HOME that has several profiles.
// Run from the repo root: PORT=9250 npx tsx .scratch/m4-agents/m4-01-smoke/serve.ts   (stop it with SIGINT)
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
// Hermes 0.21.4: the first model call must come before the first profile-scoped read (see M4 #01 comments).
await call('POST', '/api/profiles', { name: 'scratch' });
await call('POST', '/api/profiles/scratch/describe-auto', { overwrite: true });
for (const name of ['coder', 'writer', 'long-profile-name-to-check-that-it-wraps-or-truncates-in-a-card']) await call('POST', '/api/profiles', { name });
await call('PUT', '/api/profiles/coder/description', { description: 'Careful senior engineer: reads the code first, writes tests, keeps commits small and never pushes to main.' });
await call('PUT', '/api/profiles/writer/description', { description: 'Drafts and edits posts.' });
for (const [title, status] of [['Draft the post', 'done'], ['Edit the post', 'done'], ['Stuck on a source', 'blocked'], ['Next week', undefined]] as const) {
  const made = await call('POST', '/api/plugins/kanban/tasks', { title, assignee: 'writer' });
  if (status) await call('PATCH', `/api/plugins/kanban/tasks/${made.task.id}`, { status, ...(status === 'done' ? { summary: 'Finished' } : {}) });
}
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: Number(process.env.PORT ?? 9250),
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m4-01-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  await server.close();
  await llm.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m4-01-cookie', { force: true });
  process.exit(0);
});
