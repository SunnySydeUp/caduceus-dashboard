import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanCommitMessage, commitMessageRequest, parseCommitContext } from '../../web/src/modules/git/git-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { openGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { startStubLlm, STUB_TITLE, type StubLlm } from './fixtures/stub-llm.ts';

// The AI commit message of Workspace › Git (M7 #03): Hermes's `review/commit-context` over REST, then `llm.oneshot` over the page's gateway connection
// through Caduceus, in front of the real Hermes whose provider is the stub LLM. The message only fills the field: nothing is committed.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let repo: string;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();

describe('the AI commit message', () => {
  test('is drafted by Hermes’s model from the commit context and is only text: the repository is not committed to', async () => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-gitmsg-')));
    git('init', '-b', 'main');
    git('config', 'user.email', 'o@example.com');
    git('config', 'user.name', 'O');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-m', 'first');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, fileRoots: [path.dirname(repo)] });
    const cookie = await ownerCookie(server.url);
    const page = openGatewayConnection(server.url, cookie);
    await page.until((status) => status.state === 'connected');
    try {
      const context = parseCommitContext(await (await fetch(`${server.url}/api/git/review/commit-context?path=${encodeURIComponent(repo)}`, { headers: { cookie } })).json());
      expect(context).toMatchObject({ recent: 'first' });
      expect(context.diff).toContain('+two');

      const answer = await page.connection.client.request<{ text: string }>('llm.oneshot', commitMessageRequest(context, 'default'));

      expect(cleanCommitMessage(answer.text)).toBe(STUB_TITLE);
      expect(llm.requests).toContain('POST /v1/chat/completions');
      expect(git('log', '--pretty=%s')).toBe('first');
    } finally {
      page.connection.close();
    }
  });
});
