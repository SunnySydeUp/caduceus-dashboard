// Throwaway UX-audit server: a real `hermes serve` on a temp HERMES_HOME, the stub model, seeded profiles, sessions, Kanban
// tasks and schedules, and Caduceus serving a temp web build. Never touches ~/.hermes or web/dist.
// Run: npx tsx .scratch/m9-ux-audit/ux-server.ts   (UX_PORT, UX_WEB_ROOT). A control server on UX_PORT+1 scripts the stub model:
//   POST /approve  -> next completion asks to run `rm -rf <tmp dir>` (an approval)
//   POST /clarify  -> next completion asks a clarify question with choices
//   POST /hold     -> next completion streams one chunk and holds until POST /resume
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer } from '../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../server/test/fixtures/real-hermes.ts';
import { startStubLlm, type ScriptedReply } from '../../server/test/fixtures/stub-llm.ts';
import { ownerCookie } from '../../server/test/fixtures/owner.ts';
import { seedSession, seedSessions } from '../../server/test/fixtures/seed-session.ts';

const PORT = Number(process.env.UX_PORT ?? 9231);
const WEB_ROOT = process.env.UX_WEB_ROOT ?? '/tmp/cad-ux/web';
const json = { 'content-type': 'application/json' };

const hermes = await launchTestHermes();
await hermes.backend.ready();
const llm = await startStubLlm();
await llm.connect(hermes);
await hermes.cli('config', 'set', 'tools.tool_search.enabled', 'off');
for (const profile of ['research', 'finance']) {
  await hermes.cli('profile', 'create', profile, '--no-alias', '--no-skills');
  await llm.connect(hermes, profile);
  await hermes.cli('-p', profile, 'config', 'set', 'tools.tool_search.enabled', 'off');
}
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-ux-work-')));
fs.writeFileSync(path.join(work, 'README.md'), '# Sample project\n\nA workspace for the UX audit.\n');
fs.mkdirSync(path.join(work, 'src'));
fs.writeFileSync(path.join(work, 'src', 'index.ts'), 'export const answer = 42;\n');

// Sessions: a rich one with tool calls, and a list of older ones.
await seedSession(hermes.home, 'seed_rich', [
  { role: 'user', content: 'Summarise the README in this project.' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) } }] },
  { role: 'tool', content: '# Sample project\nA workspace for the UX audit.', tool_call_id: 'c1', tool_name: 'read_file' },
  { role: 'assistant', content: 'The README describes **a sample project** used for a UX audit.\n\n- One heading\n- One paragraph\n\n```ts\nexport const answer = 42;\n```' },
], { title: 'Summarise the README' });
await seedSessions(hermes.home, [
  { id: 'seed_old1', title: 'Plan the quarterly review', exchanges: 3, daysOld: 6, endReason: 'cli_close' },
  { id: 'seed_old2', title: 'Fix the flaky upload test', exchanges: 2, daysOld: 2, endReason: 'cli_close' },
  { id: 'seed_tg', title: 'Telegram: grocery list', source: 'telegram', exchanges: 1, daysOld: 1 },
]);
await seedSessions(path.join(hermes.home, 'profiles', 'research'), [
  { id: 'seed_r1', title: 'Compare vector databases', exchanges: 2, daysOld: 3, endReason: 'cli_close' },
]);

// Kanban: a second board, and tasks in many states.
await hermes.backend.fetch('/api/plugins/kanban/boards', { method: 'POST', headers: json, body: JSON.stringify({ slug: 'home', name: 'Home' }) });
async function task(board: string, title: string, assignee: string, ...steps: ((id: string) => string[])[]) {
  const r = await hermes.backend.fetch(`/api/plugins/kanban/tasks?board=${board}`, { method: 'POST', headers: json, body: JSON.stringify({ title, assignee }) });
  const { task: made }: { task: { id: string } } = await r.json();
  for (const step of steps) await hermes.cli('kanban', '--board', board, ...step(made.id));
}
await task('default', 'Draft the release notes', 'default');
await task('default', 'Review the onboarding copy', 'research', (id) => ['request-review', id]);
await task('default', 'Pick a database', 'default', (id) => ['block', id, 'Postgres or SQLite?', '--kind', 'needs_input']);
await task('default', 'Write the weekly summary', 'finance', (id) => ['complete', id, '--summary', 'Summary written and saved to notes.']);
await task('home', 'Book the plumber', 'default');

// Schedules.
for (const [name, schedule, profile] of [['Morning briefing', '0 8 * * *', 'default'], ['Weekly spend report', '0 9 * * 1', 'finance'], ['Paper digest', '0 18 * * 5', 'research']] as const) {
  await hermes.backend.fetch(`/api/cron/jobs?profile=${profile}`, { method: 'POST', headers: json, body: JSON.stringify({ name, schedule, prompt: `Run the ${name.toLowerCase()}`, deliver: 'local' }) });
}

const server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, port: PORT, webRoot: WEB_ROOT });
const [name, value] = (await ownerCookie(server.url)).split('=');
fs.mkdirSync('/tmp/cad-ux', { recursive: true, mode: 0o700 });
fs.writeFileSync('/tmp/cad-ux/cookie.json', JSON.stringify({ name, value, url: server.url, work }), { mode: 0o600 });

let held: ScriptedReply | undefined;
http
  .createServer((req, res) => {
    const route = req.url ?? '';
    if (route === '/approve') {
      const dir = fs.mkdtempSync(path.join(work, 'scratch-'));
      llm.nextReply({ chunks: [], toolCalls: [{ id: `call_rm_${Date.now()}`, name: 'terminal', arguments: { command: `rm -rf ${dir}` } }] });
      llm.nextReply({ chunks: ['Removed ', 'the scratch folder.'] });
    } else if (route === '/clarify') {
      llm.nextReply({ chunks: [], toolCalls: [{ id: `call_ask_${Date.now()}`, name: 'clarify', arguments: { questions: [{ question: 'Which colour should the chart use?', choices: ['Red', 'Blue'] }] } }] });
      llm.nextReply({ chunks: ['Got it, ', 'using that colour.'] });
    } else if (route === '/hold') held = llm.nextReply({ chunks: ['Working ', 'on it ', 'now.'], pauseAfter: 1 });
    else if (route === '/resume') held?.resume();
    res.end('ok');
  })
  .listen(PORT + 1, '127.0.0.1');

process.stdout.write(`ux server ready at ${server.url} (home ${hermes.home}, work ${work})\n`);
const stop = async () => {
  await server.close();
  await llm.close();
  await hermes.stop();
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
