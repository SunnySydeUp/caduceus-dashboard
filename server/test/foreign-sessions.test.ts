import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChat, transcriptOf } from '../../web/src/modules/chat/chat-session.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { importForeign, listForeign, previewForeign } from '../../web/src/modules/chat/foreign-sessions.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Claude Code and Codex sessions (M1 #16): the page lists the logs those tools left on the machine Hermes runs on, previews one and imports it
// into a profile, through `session.foreign.list`, `.preview` and `.import`, over a real Hermes. Hermes reads the logs from the stores the tools
// themselves relocate with `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, so the test points those at a directory of its own and writes two small logs
// there by hand: the owner's real logs are never read. Caduceus keeps nothing: what a test asserts is what Hermes answers.
let hermes: TestHermes;
let tools: string;
let workspace: string;
let server: CaduceusServer | undefined;
const pages: TestGatewayConnection[] = [];

const jsonl = (...lines: unknown[]) => `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
const at = (file: string, content: string, seconds: number) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.utimesSync(file, seconds, seconds);
};

beforeAll(async () => {
  tools = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-foreign-tools-'));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-foreign-workspace-'));
  // Claude Code: `<config>/projects/<project>/<session>.jsonl`, one JSON object a line.
  at(
    path.join(tools, 'claude', 'projects', '-work-api', 'c1.jsonl'),
    jsonl(
      { type: 'user', cwd: workspace, sessionId: 'claude-1', message: { role: 'user', content: 'Why does the login test flake?' } },
      { type: 'assistant', cwd: workspace, sessionId: 'claude-1', message: { role: 'assistant', content: [{ type: 'text', text: 'A race in the session fixture.' }] } },
      { type: 'user', cwd: workspace, sessionId: 'claude-1', message: { role: 'user', content: 'Fix it.' } },
      { type: 'assistant', cwd: workspace, sessionId: 'claude-1', message: { role: 'assistant', content: [{ type: 'text', text: 'Done: the fixture now awaits the cookie.' }] } },
    ),
    1_800_000_000,
  );
  // Codex: `<codex home>/sessions/<y>/<m>/<d>/rollout-*.jsonl`.
  at(
    path.join(tools, 'codex', 'sessions', '2026', '10', '01', 'rollout-2026-10-01-x1.jsonl'),
    jsonl(
      { type: 'session_meta', payload: { id: 'codex-1', cwd: '/nowhere/at/all' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Rename the helper' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Renamed it everywhere.' }] } },
    ),
    1_700_000_000,
  );
  hermes = await launchTestHermes({ env: { CLAUDE_CONFIG_DIR: path.join(tools, 'claude'), CODEX_HOME: path.join(tools, 'codex') } });
  await hermes.backend.ready();
}, 120_000);
afterAll(async () => {
  await hermes.stop();
  fs.rmSync(tools, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
});
afterEach(async () => {
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function openPage() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const cookie = await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  return page;
}

describe('listing the sessions of the other tools', () => {
  test('both tools\' logs are listed, newest first, with the tool, the title, the folder and the turns; a source filter keeps one tool', async () => {
    const page = await openPage();
    const all = await listForeign(page.connection.client, { profile: 'default' });
    expect(all.rows).toEqual([
      expect.objectContaining({ source: 'claude', label: 'Claude Code', title: 'Why does the login test flake?', cwd: workspace, mtime: 1_800_000_000, turnCount: 4 }),
      expect.objectContaining({ source: 'codex', title: 'Rename the helper', cwd: '/nowhere/at/all', mtime: 1_700_000_000, turnCount: 2 }),
    ]);
    expect(all.nextOffset).toBeUndefined();
    expect(all.unreadable).toBe(0);

    const codex = await listForeign(page.connection.client, { profile: 'default', source: 'codex' });
    expect(codex.rows.map((row) => row.source)).toEqual(['codex']);
  });

  test('a page ends where Hermes says the next one starts, and the last page says there is no more', async () => {
    const page = await openPage();
    const first = await listForeign(page.connection.client, { profile: 'default', limit: 1 });
    expect(first.rows.map((row) => row.source)).toEqual(['claude']);
    expect(first.nextOffset).toBe(1);
    const second = await listForeign(page.connection.client, { profile: 'default', limit: 1, offset: first.nextOffset });
    expect(second.rows.map((row) => row.source)).toEqual(['codex']);
    expect(second.nextOffset).toBeUndefined();
  });
});

describe('previewing a session', () => {
  test('the preview is the tail of the conversation in Hermes\'s words, with the total, the folder and no import yet', async () => {
    const page = await openPage();
    const { rows } = await listForeign(page.connection.client, { profile: 'default', source: 'claude' });
    const preview = await previewForeign(page.connection.client, { profile: 'default', id: rows[0]!.id });
    expect(preview).toEqual({
      messages: [
        { role: 'user', content: 'Why does the login test flake?' },
        { role: 'assistant', content: 'A race in the session fixture.' },
        { role: 'user', content: 'Fix it.' },
        { role: 'assistant', content: 'Done: the fixture now awaits the cookie.' },
      ],
      total: 4,
      truncated: false,
      alreadyImported: undefined,
      cwd: workspace,
    });
  });
});

describe('importing a session', () => {
  test('the import is a Hermes session of the profile: it is in the sessions list, its messages are Hermes\'s, and the chat opens it; the preview then says where it went', async () => {
    const page = await openPage();
    const { rows } = await listForeign(page.connection.client, { profile: 'default', source: 'claude' });
    const imported = await importForeign(page.connection.client, { profile: 'default', id: rows[0]!.id });
    expect(imported.alreadyImported).toBe(false);

    const list = (await page.rest('/api/sessions?profile=default&limit=50&min_messages=1')) as { sessions: { id: string; title: string; source: string }[] };
    expect(list.sessions).toEqual([expect.objectContaining({ id: imported.storedId, source: 'claude-code', title: 'Why does the login test flake?' })]);

    const history = (await page.rest(`/api/sessions/${imported.storedId}/messages`)) as { messages: { role: string; content: string }[] };
    expect(history.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Why does the login test flake?' },
      { role: 'assistant', content: 'A race in the session fixture.' },
      { role: 'user', content: 'Fix it.' },
      { role: 'assistant', content: 'Done: the fixture now awaits the cookie.' },
    ]);

    const chat = createChat(page.connection, { history: page.rest, storedId: imported.storedId });
    try {
      await chat.until((state) => !state.syncing && state.messages.length > 0);
      expect(transcriptOf(chat.state).map(({ role, text }) => ({ role, text }))).toEqual([
        { role: 'user', text: 'Why does the login test flake?' },
        { role: 'assistant', text: 'A race in the session fixture.' },
        { role: 'user', text: 'Fix it.' },
        { role: 'assistant', text: 'Done: the fixture now awaits the cookie.' },
      ]);
    } finally {
      chat.dispose();
    }

    expect((await previewForeign(page.connection.client, { profile: 'default', id: rows[0]!.id })).alreadyImported).toBe(imported.storedId);
  });

  test('importing the same log again changes nothing: the same session, said to be already imported', async () => {
    const page = await openPage();
    const { rows } = await listForeign(page.connection.client, { profile: 'default', source: 'claude' });
    const first = await importForeign(page.connection.client, { profile: 'default', id: rows[0]!.id });
    const again = await importForeign(page.connection.client, { profile: 'default', id: rows[0]!.id });
    expect(again).toEqual({ storedId: first.storedId, alreadyImported: true });
    const list = (await page.rest('/api/sessions?profile=default&limit=50&min_messages=1')) as { sessions: { id: string }[] };
    expect(list.sessions.map((row) => row.id).filter((id) => id === first.storedId)).toHaveLength(1);
  });
});

describe('what Hermes refuses', () => {
  test('a handle that is not one, and one that is no longer a log, are refused in Hermes\'s words, for the preview and the import alike', async () => {
    const page = await openPage();
    const { client } = page.connection;
    await expect(previewForeign(client, { profile: 'default', id: '../../etc/passwd' })).rejects.toThrow('Unknown session. Refresh the list and try again');
    await expect(importForeign(client, { profile: 'default', id: 'x' })).rejects.toThrow('Unknown session. Refresh the list and try again');
    const gone = 'f'.repeat(64);
    await expect(importForeign(client, { profile: 'default', id: gone })).rejects.toThrow('Session no longer available. Refresh the list and try again');
  });
});
