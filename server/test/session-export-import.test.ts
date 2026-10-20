import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { exportFile, readExport, EXPORT_TOKENS, type ExportedSession } from '../../web/src/modules/chat/session-export.ts';
import { importSessions, parseImport, type ImportOutcome, type ImportSession } from '../../web/src/modules/chat/session-import.ts';
import type { ConfirmRequest } from '../../web/src/palette.ts';
import { createTieredFetch } from '../../web/src/tiered-fetch.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedSession } from './fixtures/seed-session.ts';

// Exporting and importing sessions (M1 #17), over a real Hermes in a throwaway HERMES_HOME: the export JSON Hermes answers becomes the three files in
// the browser, and the JSON file, read back, imports into another profile through Hermes's own import, where the messages are readable. The screen
// is checked in a browser; the confirmation dialog is the web app's, so its answer here is a stand-in for the owner's.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const pages: TestGatewayConnection[] = [];

beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  await hermes.cli('profile', 'create', 'work');
  await hermes.cli('profile', 'create', 'archive');
  await seedSession(
    hermes.home,
    'trip-1',
    [
      { role: 'user', content: 'Where do we start?' },
      { role: 'assistant', content: 'Search first.', reasoning: 'A plan needs facts.', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{"q":"flights"}' } }] },
      { role: 'tool', content: 'three results', tool_call_id: 'call-1', tool_name: 'web_search' },
      { role: 'assistant', content: 'Book the first one.' },
    ],
    { title: 'Plan the trip' },
  );
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

const TOKENS = Object.fromEntries(EXPORT_TOKENS.map((name) => [name, 'x']));

async function openOwner() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const url = server.url;
  const cookie = await ownerCookie(url);
  const page = openGatewayConnection(url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const dialogs: ConfirmRequest[] = [];
  const answer = { confirm: true };
  const send = createTieredFetch({
    fetch: (route, init) => fetch(`${url}${route}`, { ...init, headers: { origin: url, cookie, ...Object.fromEntries(new Headers(init.headers)) } }),
    confirmer: () => async (request) => {
      dialogs.push(request);
      return answer.confirm ? { typed: request.object ?? request.label } : undefined;
    },
    withStepUp: (request) => request(),
    online: () => true,
    readOnly: () => false,
    sha256: async (text) => crypto.createHash('sha256').update(text).digest('hex'),
  });
  return {
    dialogs,
    answer,
    /** What the web app does for Export: Hermes's export JSON, read as a session. */
    async exported(id: string, profile = 'default'): Promise<ExportedSession> {
      return readExport(await page.rest(`/api/sessions/${id}/export?profile=${profile}`));
    },
    import: (profile: string, sessions: readonly ImportSession[]): Promise<ImportOutcome> => importSessions({ send, profile, sessions }),
    /** The messages Hermes holds for a session of a profile, read around Caduceus; none for a session it does not have. */
    async held(id: string, profile: string) {
      const response = await hermes.backend.fetch(`/api/sessions/${id}/messages?profile=${profile}`);
      // Hermes answers 404 for a session the profile does not have, and 503 for a profile that has no session store yet (browsing never creates one).
      if (response.status === 404 || response.status === 503) return [];
      const body = (await response.json()) as { messages: { role: string; content: string }[] };
      return body.messages.map((message) => `${message.role}: ${message.content}`);
    },
  };
}

const parsed = (content: string, name?: string): ImportSession[] => {
  const result = parseImport(content, name);
  if (!result.ok) throw new Error(result.problems.map((problem) => problem.message).join('; '));
  return result.sessions;
};

describe('exporting a seeded session', () => {
  test('reads Hermes’s export, and the three files carry its title and every visible message', async () => {
    const owner = await openOwner();
    const session = await owner.exported('trip-1');
    expect(session).toMatchObject({ id: 'trip-1', title: 'Plan the trip', source: 'cli' });
    expect(session.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

    const markdown = exportFile(session, 'markdown', { tokens: TOKENS }).content;
    expect(markdown).toContain('# Plan the trip');
    expect(markdown).toContain('Where do we start?');
    expect(markdown).toContain('**Tool call: web_search**');
    expect(markdown).toContain('three results');
    const html = exportFile(session, 'html', { tokens: TOKENS }).content;
    expect(html).toContain('<title>Plan the trip</title>');
    expect(html).toContain('Book the first one.');
    expect(JSON.parse(exportFile(session, 'json', { tokens: TOKENS }).content)).toMatchObject({ id: 'trip-1', messages: [{}, {}, {}, {}] });
  });
});

describe('importing the exported JSON', () => {
  test('is checked, confirmed with the profile it goes into, and then imported, where its messages are readable', async () => {
    const owner = await openOwner();
    const file = exportFile(await owner.exported('trip-1'), 'json', { tokens: TOKENS });
    const sessions = parsed(file.content, file.filename);
    expect(sessions).toMatchObject([{ id: 'trip-1', title: 'Plan the trip', messageCount: 4 }]);

    const outcome = await owner.import('work', sessions);

    expect(outcome).toMatchObject({ kind: 'imported', imported: 1, skipped: 0 });
    expect(owner.dialogs).toHaveLength(1);
    expect(owner.dialogs[0]).toMatchObject({ tier: 'T1', profile: 'work', label: 'Import 1 session into work?', confirmLabel: 'Import' });
    expect(await owner.held('trip-1', 'work')).toEqual(['user: Where do we start?', 'assistant: Search first.', 'tool: three results', 'assistant: Book the first one.']);
    const again = await owner.exported('trip-1', 'work');
    expect(again).toMatchObject({ title: 'Plan the trip' });
    expect(again.messages[1]).toMatchObject({ reasoning: 'A plan needs facts.', toolCalls: [{ name: 'web_search' }] });
  });

  test('skips a session the profile already has, and says so', async () => {
    const owner = await openOwner();
    const sessions = parsed(exportFile(await owner.exported('trip-1'), 'json', { tokens: TOKENS }).content);
    const outcome = await owner.import('default', sessions);
    expect(outcome).toEqual({ kind: 'imported', imported: 0, skipped: 1, message: 'Imported 0 sessions into default. 1 session was already there and skipped.' });
  });

  test('sends nothing when the owner declines the confirmation', async () => {
    const owner = await openOwner();
    owner.answer.confirm = false;
    const sessions = parsed(exportFile(await owner.exported('trip-1'), 'json', { tokens: TOKENS }).content);
    expect(await owner.import('archive', sessions)).toEqual({ kind: 'cancelled' });
    expect(await owner.held('trip-1', 'archive')).toEqual([]);
  });
});

describe('importing JSONL', () => {
  test('a file of a session a line imports them all, and the file’s own messages are what Hermes holds', async () => {
    const owner = await openOwner();
    const one = (await owner.exported('trip-1')).record;
    const jsonl = [one, { ...one, id: 'trip-2', title: 'A second trip', messages: (one.messages as { id: number }[]).slice(0, 2) }].map((row) => JSON.stringify(row)).join('\n');
    const sessions = parsed(jsonl, 'export.jsonl');
    expect(sessions.map((session) => [session.id, session.messageCount])).toEqual([['trip-1', 4], ['trip-2', 2]]);

    expect(await owner.import('archive', sessions)).toMatchObject({ kind: 'imported', imported: 2, skipped: 0 });

    expect(await owner.held('trip-2', 'archive')).toEqual(['user: Where do we start?', 'assistant: Search first.']);
  });
});

describe('a session Hermes refuses', () => {
  test('is reported in Hermes’s words, with nothing imported', async () => {
    const owner = await openOwner();
    // Passes the file check (an id and messages with roles) but not Hermes’s: over the size it takes for one session. The file check knows that limit too, so this goes straight to Hermes.
    const bad: ImportSession = { id: 'oversize', title: '', messageCount: 1, record: { id: 'oversize', messages: [{ role: 'user', content: 'x'.repeat(6 * 1024 * 1024) }] } };
    const outcome = await owner.import('work', [bad]);
    expect(outcome).toEqual({ kind: 'failed', message: 'Session 1 (oversize): session exceeds the import size limit.' });
    expect(await owner.held('oversize', 'work')).toEqual([]);
  });
});
