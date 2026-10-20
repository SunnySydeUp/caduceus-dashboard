// Throwaway server for the M1 #05 browser checks (not part of `npm test`): Caduceus on 127.0.0.1:9241 in front of the real `hermes serve` in a
// temp HERMES_HOME whose only model is a stub LLM. The stub's next completions are a turn that reasons, calls todo_list, patch (a file
// diff), read_file (fails), memory and skill_manage (which raise toasts) and delegate_task (a subagent), then answers. Never touches
// ~/.hermes, :9119, :8787 or the gateway.
//
//   npm run build -w web && npx tsx .scratch/m1-chat/m1-05-smoke/serve.ts
//
// Writes the owner's cookie to /tmp/caduceus-m1-05-cookie (mode 600), prints `READY <url> <pid>`. SIGINT stops everything and deletes the temp dirs.
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
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-m1-05-work-')));
const target = path.join(work, 'notes.txt');
const scripts = () => {
  fs.writeFileSync(target, 'hello from the notes\nsecond line\n');
  llm.nextReply({
    chunks: ['Let me plan this and look around. '],
    reasoning: ['The owner wants a plan. ', 'First read the notes, then change one line, then check a file that may not exist.'],
    toolCalls: [
      { id: 'call_todo', name: 'todo_list', arguments: { todos: [{ id: 'a', content: 'Read the notes', status: 'completed' }, { id: 'b', content: 'Change the greeting', status: 'in_progress' }, { id: 'c', content: 'Check the missing file', status: 'pending' }] } },
      { id: 'call_patch', name: 'patch', arguments: { mode: 'replace', path: target, old_string: 'hello from the notes', new_string: 'hello from the plan' } },
      { id: 'call_read', name: 'read_file', arguments: { path: path.join(work, 'missing.txt') } },
      { id: 'call_mem', name: 'memory', arguments: { action: 'add', target: 'memory', content: 'The owner reads notes on a phone' } },
      { id: 'call_skill', name: 'skill_manage', arguments: { action: 'create', name: 'notes-habit', content: '---\nname: notes-habit\ndescription: How the owner keeps notes\n---\n\n# Notes\n\nKeep them short.\n' } },
      { id: 'call_delegate', name: 'delegate_task', arguments: { goal: 'Summarise the notes file in one sentence' } },
    ],
    usage: { prompt: 420, completion: 64 },
  });
  llm.nextReply({ chunks: ['I changed the greeting, ', 'saved two notes for later, ', 'and could not find the missing file.'], usage: { prompt: 610, completion: 40 } });
};
scripts();
// Every later prompt (and the helper) gets the default reply, but a second turn scripted the same way is there for a second run.
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: Number(process.env.PORT ?? 9241),
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m1-05-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  await server.close();
  await llm.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m1-05-cookie', { force: true });
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
});
