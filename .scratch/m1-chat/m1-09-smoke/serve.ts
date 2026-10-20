// Throwaway server for the M1 #09 browser checks: Caduceus in front of a real `hermes serve` in a temp HERMES_HOME whose model is a stub LLM,
// with personalities, quick commands, a workspace of files and a few stored sessions. Writes the owner's cookie to /tmp/caduceus-m1-09-cookie.
// SIGINT stops everything and removes the temp dirs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { seedSession, seedSessions } from '../../../server/test/fixtures/seed-session.ts';
import { startStubLlm } from '../../../server/test/fixtures/stub-llm.ts';

const hermes = await launchTestHermes();
await hermes.backend.ready();
const llm = await startStubLlm();
llm.connect(hermes);
const env = { ...process.env, HERMES_HOME: hermes.home };
const set = (key: string, value: string) => execFileSync('hermes', ['config', 'set', key, value], { env, stdio: 'pipe' });
set('tools.tool_search.enabled', 'off');
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-m1-09-work-')));
fs.mkdirSync(path.join(work, 'src'));
fs.writeFileSync(path.join(work, 'README.md'), '# Work\n');
fs.writeFileSync(path.join(work, 'src', 'index.ts'), 'export {};\n');
fs.writeFileSync(path.join(work, 'src', 'notes.md'), 'notes\n');
set('terminal.cwd', work);
set('quick_commands.shout.type', 'exec');
set('quick_commands.shout.command', 'echo hi');
set('quick_commands.shout.description', 'Say hi from the shell');
set('quick_commands.hi.type', 'alias');
set('quick_commands.hi.target', '/title Hello title');
set('personalities.pirate', 'You are a pirate.');
const code = ['Here is code:', '', '```ts', 'export const answer = 42;', '```', '', 'And a second paragraph with some words to select and refine for the owner.'].join('\n');
seedSession(hermes.home, 'smoke-code', [
  { role: 'user', content: 'Show me code' },
  { role: 'assistant', content: code },
]);
seedSessions(hermes.home, Array.from({ length: 6 }, (_, n) => ({ id: `smoke-${n}`, title: `Session ${n}`, exchanges: 1 })));
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: Number(process.env.PORT ?? 9201),
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m1-09-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid} ${work} ${hermes.home}`);
process.once('SIGINT', async () => {
  await server.close();
  await llm.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m1-09-cookie', { force: true });
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
});
