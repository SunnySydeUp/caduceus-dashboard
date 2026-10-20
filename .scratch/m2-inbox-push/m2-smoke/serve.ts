// Throwaway smoke server for M2 (Inbox, Home): Caduceus in front of a real Hermes in a temp HERMES_HOME, two profiles (default, work) whose
// provider is a stub LLM, and a control server that makes agents ask for things so the Inbox has something in it.
// Run from the repo root: PORT=9340 npx tsx .scratch/m2-inbox-push/m2-smoke/serve.ts   (stop it with SIGINT)
// Writes /tmp/caduceus-m2.json with the owner's cookie. Control (PORT+1):
//   GET /approval?profile=work&command=rm%20-rf%20/tmp/x   an agent in that profile asks to run a command
//   GET /question?profile=default&q=Which%20colour&choices=Red,Blue   an agent asks a question
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { createChat, type Chat } from '../../../web/src/modules/chat/chat-session.ts';
import { openGatewayConnection, type TestGatewayConnection } from '../../../server/test/fixtures/gateway-client.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { startStubLlm } from '../../../server/test/fixtures/stub-llm.ts';

// `launchTestHermes` names its temp dirs after the running test; outside vitest there is none.
expect.getState = () => ({}) as ReturnType<typeof expect.getState>;
const port = Number(process.env.PORT ?? 9340);
const hermes = await launchTestHermes();
await hermes.backend.ready();
const llm = await startStubLlm();
await llm.connect(hermes);
await hermes.cli('profile', 'create', 'work');
await llm.connect(hermes, 'work');
for (const profile of ['default', 'work']) await hermes.cli('-p', profile, 'config', 'set', 'tools.tool_search.enabled', 'off');
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port,
  // A host name of this smoke check's own, so that no other check's cookie is the same one.
  publicOrigin: `http://m2-inbox.localhost:${port}`,
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
const cookie = await ownerCookie(server.url);
fs.writeFileSync('/tmp/caduceus-m2.json', JSON.stringify({ cookie, url: `http://m2-inbox.localhost:${port}` }), { mode: 0o600 });

const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
async function ask(profile: string, toolCall: { id: string; name: string; arguments: Record<string, unknown> }, prompt: string) {
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const chat = createChat(page.connection, { history: page.rest, cwd: os.tmpdir(), ...(profile === 'default' ? {} : { profile }) });
  chats.push(chat);
  llm.nextReply({ chunks: [], toolCalls: [toolCall] });
  await chat.send(prompt);
}
let counter = 0;
const control = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const profile = url.searchParams.get('profile') ?? 'default';
  const id = `call_${++counter}`;
  const done = (async () => {
    if (url.pathname === '/approval') await ask(profile, { id, name: 'terminal', arguments: { command: url.searchParams.get('command') ?? `rm -rf ${path.join(os.tmpdir(), 'caduceus-smoke-doomed')}` } }, 'Clean up');
    if (url.pathname === '/question') {
      const choices = url.searchParams.get('choices')?.split(',').filter(Boolean);
      await ask(profile, { id, name: 'clarify', arguments: { question: url.searchParams.get('q') ?? 'Which colour?', ...(choices ? { choices } : {}) } }, 'Ask me something');
    }
  })();
  done.then(() => res.end('ok'), (error) => res.end(String(error)));
});
control.listen(port + 1, '127.0.0.1');
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  control.close();
  for (const chat of chats) chat.dispose();
  for (const page of pages) page.connection.close();
  await server.close();
  await llm.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m2.json', { force: true });
  process.exit(0);
});
