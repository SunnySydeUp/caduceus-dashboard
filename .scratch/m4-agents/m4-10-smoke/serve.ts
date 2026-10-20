// Throwaway smoke server for M4 #10: Caduceus in front of a real Hermes in a temp HERMES_HOME, with Hindsight pointed at a local API stub (cloud-shaped, with a
// key) and two notes sources (the MCP fixture over stdio, and over HTTP). Run from the repo root: PORT=9210 npx tsx .scratch/m4-agents/m4-10-smoke/serve.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { startHindsightStub } from '../../../server/test/fixtures/hindsight-stub.ts';
import { startMcpHttpServer } from '../../../server/test/fixtures/mcp-http-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';

const port = Number(process.env.PORT ?? 9210);
const host = process.env.SMOKE_HOST ?? 'm4t10hindsight.localhost';
const stub = await startHindsightStub();
stub.requireKey('hsk_smoke_0123456789');
const bank = stub.bank('hermes');
bank.name = 'Hermes';
bank.memories.push(
  { id: 'm1', text: 'The owner prefers green tea with jasmine, and drinks it in the morning before the first meeting of the day.', fact_type: 'world', tags: ['drinks'], context: 'chat on Monday' },
  { id: 'm2', text: 'The owner ran the Sunday deploy and flipped the flag after the migrations.', fact_type: 'experience' },
  { id: 'm3', text: 'Deploys happen on Sundays.', fact_type: 'observation' },
);
bank.directives.push({ id: 'd1', name: 'Be brief', content: 'Answer in two sentences.', priority: 5, is_active: true, tags: [] });
bank.mentalModels.push({ id: 'mm1', name: 'Deploy habits', source_query: 'When does the owner deploy?', content: 'The owner deploys on Sundays, after the migrations, behind a flag.', tags: ['ops'] });
stub.bank('scratch').memories.push({ id: 's1', text: 'A scratch fact.', fact_type: 'world' });

const http = await startMcpHttpServer();
const hermes = await launchTestHermes();
await hermes.backend.ready();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-smoke-notes-'));
await hermes.backend.fetch('/api/memory/providers/hindsight/config?profile=default', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ values: { mode: 'local_external', api_url: stub.url, api_key: 'hsk_smoke_0123456789', bank_id: 'hermes' } }),
});
await hermes.cli('config', 'set', 'memory.provider', 'hindsight');
const fixture = fileURLToPath(new URL('../../../server/test/fixtures/mcp-server.mjs', import.meta.url));
const put = await hermes.backend.fetch('/api/mcp/servers?profile=default', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ servers: { 'notes-app': { command: process.execPath, args: [fixture, '--notes'], env: { NOTES_LOG: path.join(tmp, 'calls.log') } }, 'web-notes': { url: http.url }, 'sign-in-notes': { url: 'https://example.invalid/mcp', auth: 'oauth' } } }),
});
if (!put.ok) throw new Error(`MCP servers: ${put.status} ${await put.text()}`);

const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port,
  publicOrigin: `http://${host}:${port}`,
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m4-10-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} http://${host}:${port} pid=${process.pid}`);
process.once('SIGINT', async () => {
  await server.close();
  await hermes.stop();
  await http.close();
  await stub.close();
  fs.rmSync('/tmp/caduceus-m4-10-cookie', { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
});
