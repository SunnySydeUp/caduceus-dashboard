import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import type { NotePreview, NotesSearchAnswer, NotesSourceRow, NotesSources } from '@caduceus/contracts/hindsight-api';
import { approveRequest, markRequest, parsePreview, parseSearch, parseSources, previewNoteRequest, readiness, searchNotesRequest, sourcesPath } from '../../web/src/modules/memory/hindsight-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { startMcpHttpServer, type McpHttpServer } from './fixtures/mcp-http-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Agents › Memory › Notes (M4 #10): external notes through MCP servers of a profile's Hermes config, in front of the real Hermes in a throwaway HERMES_HOME.
// The stdio source is the MCP fixture of M4 #07 run as a notes server (`fixtures/mcp-server.mjs --notes`: search and read tools, and a create and a delete
// that must never be called, each call logged to a file); the HTTP source is `fixtures/mcp-http-server.ts`.
const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/mcp-server.mjs');
let hermes: TestHermes;
let server: CaduceusServer;
let tmp: string;
let log: string;
let http: McpHttpServer;
let owner: Owner;
let cookie: string;

interface Answer<T> {
  status: number;
  body: T;
  text: string;
}

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Answer<T>>;
  /** Sends a request the way the tiered dialog does for a T3: with a confirmation of the typed `target`. */
  confirmed<T = unknown>(method: string, route: string, target: string, body?: unknown): Promise<Answer<T>>;
}

async function call<T>(method: string, route: string, { body, headers }: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Answer<T>> {
  const res = await fetch(`${server.url}${route}`, {
    method,
    headers: { origin: server.url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as T };
}

/** Replaces the profile's MCP servers in Hermes (the config the owner would edit), each as the raw config entry. */
async function setServers(servers: Record<string, Record<string, unknown>>): Promise<void> {
  const res = await hermes.backend.fetch('/api/mcp/servers?profile=default', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ servers }) });
  if (!res.ok) throw new Error(`Setting the MCP servers: HTTP ${res.status} ${await res.text()}`);
}

const stdioNotes = (extra: Record<string, unknown> = {}) => ({ command: process.execPath, args: [FIXTURE, '--notes'], env: { NOTES_LOG: log }, ...extra });
const calledTools = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => (JSON.parse(line) as { name: string }).name) : []);
const sourcesOf = async () => (await owner.call<NotesSources>('GET', '/_caduceus/api/notes/sources?profile=default')).body.sources;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-notes-'));
  log = path.join(tmp, 'calls.log');
  http = await startMcpHttpServer();
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  cookie = await ownerCookie(server.url);
  await stepUp(server.url, cookie, await addPasskey(server.url, cookie));
  owner = {
    call,
    async confirmed(method, route, target, body) {
      const bodySha256 = body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation: `${method} ${route}`, target, typed: target, ...(bodySha256 ? { bodySha256 } : {}) } });
      return call(method, route, { body, headers: { 'x-caduceus-confirmation': minted.body.token } });
    },
  };
}, 90_000);
afterAll(async () => {
  try {
    await server.close();
  } finally {
    try {
      await http.close();
    } finally {
      try {
        await hermes.stop();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  }
});
afterEach(async () => {
  await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });
  // What the owner marked and approved is Caduceus's own, so each test starts from none of it.
  for (const row of await sourcesOf()) await mark(row.name, false);
  await setServers({});
  fs.rmSync(log, { force: true });
  http.calls.length = 0;
  http.headers.length = 0;
});

describe('the notes sources', () => {
  test('are the MCP servers of the profile’s Hermes config, with their kind, the command line to read, and whether the owner marked or approved them', async () => {
    await setServers({
      notes: stdioNotes(),
      web: { url: http.url, headers: { Authorization: 'Bearer abc-123456' } },
      login: { url: 'https://example.invalid/mcp', auth: 'oauth' },
      vars: { command: 'node', args: ['${HOME}/x.js'] },
      off: stdioNotes({ enabled: false }),
    });

    const listed = await sourcesOf();

    expect(listed.map((row) => row.name)).toEqual(['login', 'notes', 'off', 'vars', 'web']);
    expect(listed.find((row) => row.name === 'notes')).toEqual({ name: 'notes', transport: 'stdio', source: false, disabled: false, approved: false, command: `${process.execPath} ${FIXTURE} --notes` });
    expect(listed.find((row) => row.name === 'web')).toEqual({ name: 'web', transport: 'http', source: false, disabled: false, approved: true });
    expect(listed.find((row) => row.name === 'off')).toMatchObject({ disabled: true });
    expect(listed.find((row) => row.name === 'login')).toMatchObject({ transport: 'unsupported', note: expect.stringMatching(/OAuth/) });
    expect(listed.find((row) => row.name === 'vars')).toMatchObject({ transport: 'unsupported', note: expect.stringMatching(/variables/) });
    expect(JSON.stringify(listed)).not.toContain('NOTES_LOG');
    expect(JSON.stringify(listed)).not.toContain('abc-123456');
    expect(calledTools()).toEqual([]);
  });
});

const search = (server: string, query: string, extra: Record<string, unknown> = {}) => owner.call<NotesSearchAnswer & { error?: string; message?: string; command?: string }>('POST', '/_caduceus/api/notes/search?profile=default', { body: { server, query, ...extra } });
const preview = (server: string, ref: string, extra: Record<string, unknown> = {}) => owner.call<NotePreview & { error?: string; message?: string }>('POST', '/_caduceus/api/notes/preview?profile=default', { body: { server, ref, ...extra } });
const mark = (server: string, source = true) => owner.call<NotesSourceRow>('PUT', `/_caduceus/api/notes/sources/${server}?profile=default`, { body: { source } });
const approve = (server: string) => owner.confirmed<NotesSourceRow & { error?: string }>('POST', `/_caduceus/api/notes/sources/${server}/approve?profile=default`, server);
const auditOf = async () => (await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body.entries;

describe('a stdio notes source', () => {
  test('is searched only once it is marked and its command approved (T3, the server’s name typed): until then its command is never run', async () => {
    await setServers({ notes: stdioNotes() });

    const unmarked = await search('notes', 'deploy');
    const marked = await mark('notes');
    const unapproved = await search('notes', 'deploy');

    expect(unmarked).toMatchObject({ status: 409, body: { error: 'not-a-source' } });
    expect(marked).toMatchObject({ status: 200, body: { name: 'notes', source: true, approved: false } });
    expect(unapproved).toMatchObject({ status: 409, body: { error: 'approval-required', command: `${process.execPath} ${FIXTURE} --notes` } });
    expect(fs.existsSync(log)).toBe(false);

    const withoutConfirmation = await owner.call('POST', '/_caduceus/api/notes/sources/notes/approve?profile=default');
    expect(withoutConfirmation).toMatchObject({ status: 403, body: { error: 'confirmation-required', tier: 'T3' } });
    expect((await sourcesOf()).find((row) => row.name === 'notes')).toMatchObject({ source: true, approved: false });

    const approved = await approve('notes');
    expect(approved).toMatchObject({ status: 200, body: { approved: true } });
    expect((await auditOf()).find((entry) => entry.action === 'POST /_caduceus/api/notes/sources/{server}/approve')).toMatchObject({ tier: 'T3', target: '/_caduceus/api/notes/sources/notes/approve', profile: 'default' });
  });
});

describe('an approved notes source', () => {
  /** A stdio source that is marked and approved, as the owner leaves it. */
  async function readySource(name = 'notes', extra: Record<string, unknown> = {}) {
    await setServers({ [name]: stdioNotes(extra) });
    await mark(name);
    await approve(name);
  }

  test('searches to snippets and opens one note read-only, through the server’s own search and read tools, each call audited by server and tool and never by what was asked', async () => {
    await readySource();

    const found = await search('notes', 'deploy');
    const opened = await preview('notes', 'deploy-checklist');
    const missing = await preview('notes', 'no-such-note');

    expect(found.status).toBe(200);
    expect(found.body).toEqual({
      tool: 'search_notes',
      hits: [
        { ref: 'deploy-checklist', title: 'Deploy checklist', snippet: 'Run the migrations, then flip the flag. Deploys happen on Su' },
        { ref: 'boat-upkeep', title: 'Boat upkeep', snippet: 'The Zanzibar boat needs a new sail before the deploy season.' },
      ],
    });
    expect(opened.body).toEqual({ tool: 'read_note', title: 'Deploy checklist', text: '# Deploy checklist\n\nRun the migrations, then flip the flag. Deploys happen on Sundays.', truncated: false });
    expect(missing).toMatchObject({ status: 502, body: { error: 'source-failed', message: 'No note with id no-such-note.' } });
    expect(calledTools()).toEqual(['search_notes', 'read_note', 'read_note']);
    const entries = (await auditOf()).filter((entry) => entry.action.startsWith('notes.'));
    expect(entries.map((entry) => `${entry.action} ${entry.target} ${entry.tier}`).sort()).toEqual(['notes.preview notes:read_note T0', 'notes.preview notes:read_note T0', 'notes.search notes:search_notes T0']);
    expect(JSON.stringify(entries)).not.toMatch(/deploy|checklist/);
  });

  test('refuses every tool that is not a read or search tool, by any name the page gives, before the server is asked to run it', async () => {
    await readySource();

    const refusals = await Promise.all([
      search('notes', 'deploy', { tool: 'delete_note' }),
      search('notes', 'deploy', { tool: 'create_note' }),
      search('notes', 'deploy', { tool: 'read_note' }),
      preview('notes', 'deploy-checklist', { tool: 'search_notes' }),
      preview('notes', 'deploy-checklist', { tool: 'delete_note' }),
      preview('notes', 'deploy-checklist', { tool: 'not_a_tool_at_all' }),
    ]);

    for (const refusal of refusals) expect(refusal).toMatchObject({ status: 403, body: { error: 'tool-not-allowed' } });
    expect(calledTools()).toEqual([]);
    // The tools it does allow can be named.
    expect((await search('notes', 'tea', { tool: 'search_notes' })).status).toBe(200);
    expect(calledTools()).toEqual(['search_notes']);
  });

  test('asks for approval again when the server’s command changes in Hermes’s config, and not before', async () => {
    await readySource();
    expect((await search('notes', 'tea')).status).toBe(200);

    await setServers({ notes: stdioNotes({ args: [FIXTURE, '--notes', '--extra'] }) });
    const changed = await search('notes', 'tea');
    expect(changed).toMatchObject({ status: 409, body: { error: 'approval-required' } });
    expect((await sourcesOf()).find((row) => row.name === 'notes')).toMatchObject({ source: true, approved: false });
    expect(calledTools()).toEqual(['search_notes']);

    await approve('notes');
    expect((await search('notes', 'tea')).status).toBe(200);
  });

  test('forgets the approval when the source is unmarked, so marking it again asks again', async () => {
    await readySource();
    expect((await search('notes', 'tea')).status).toBe(200);

    await mark('notes', false);
    expect((await sourcesOf()).find((row) => row.name === 'notes')).toMatchObject({ source: false, approved: false });
    await mark('notes');

    expect(await search('notes', 'tea')).toMatchObject({ status: 409, body: { error: 'approval-required' } });
  });

  test('answers in words when the command cannot be run or ends early, and when it is turned off or unsupported', async () => {
    await setServers({ missing: { command: '/no/such/program' }, quits: { command: process.execPath, args: ['-e', 'process.exit(0)'] }, off: stdioNotes({ enabled: false }), login: { url: 'https://example.invalid/mcp', auth: 'oauth' } });
    for (const name of ['missing', 'quits', 'off', 'login']) await mark(name);
    for (const name of ['missing', 'quits']) await approve(name);

    expect(await search('missing', 'x')).toMatchObject({ status: 502, body: { error: 'source-failed', message: 'The server’s command could not be started.' } });
    expect(await search('quits', 'x')).toMatchObject({ status: 502, body: { error: 'source-failed', message: 'The server’s command ended before it answered.' } });
    expect(await search('off', 'x')).toMatchObject({ status: 409, body: { error: 'disabled' } });
    expect(await search('login', 'x')).toMatchObject({ status: 409, body: { error: 'unsupported' } });
    expect(await search('ghost', 'x')).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect(await search('missing', '')).toMatchObject({ status: 400 });
  });

  test('works while read-only mode is on for the reads (search and preview), and not for marking a source or approving a command', async () => {
    await readySource();
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });

    expect((await search('notes', 'tea')).status).toBe(200);
    expect((await preview('notes', 'tea-blends')).status).toBe(200);
    expect((await mark('notes', false)).status).toBe(403);
    expect((await approve('notes')).status).toBe(403);
  });
});

describe('an HTTP notes source', () => {
  test('needs no approval, is sent the headers of its Hermes config, and its server-sent and JSON answers both read', async () => {
    await setServers({ web: { url: http.url, headers: { Authorization: 'Bearer abc-123456' } } });
    await mark('web');

    const found = await search('web', 'rust');
    const opened = await preview('web', 'inbox/ideas.md');

    expect(found.body).toEqual({ tool: 'search_notes', hits: [{ ref: 'inbox/ideas.md', title: 'Ideas', snippet: 'An idea about rust.' }] });
    expect(opened.body).toMatchObject({ tool: 'read_note', title: 'Ideas', text: '# Ideas\n\nRead inbox/ideas.md.' });
    expect(http.calls).toEqual(['search_notes', 'read_note']);
    expect(http.headers.every((request) => request.authorization === 'Bearer abc-123456')).toBe(true);
    expect(http.headers.some((request) => request.session === 'session-1')).toBe(true);
    expect(JSON.stringify([found.body, opened.body])).not.toContain('abc-123456');
    expect((await search('web', 'rust', { tool: 'create_note' })).status).toBe(403);
    expect(http.calls).toEqual(['search_notes', 'read_note']);
  });

  test('says when the server refuses the headers or is not there', async () => {
    const guarded = await startMcpHttpServer({ key: 'right-key-123' });
    try {
      await setServers({ guarded: { url: guarded.url, headers: { Authorization: 'Bearer wrong-key-123' } }, gone: { url: 'http://127.0.0.1:9/mcp' } });
      await mark('guarded');
      await mark('gone');

      const refused = await search('guarded', 'x');
      const absent = await search('gone', 'x');

      expect(refused).toMatchObject({ status: 502, body: { error: 'source-failed', message: 'The server refused the headers Hermes holds for it.' } });
      expect(refused.text).not.toContain('wrong-key-123');
      expect(absent).toMatchObject({ status: 502, body: { error: 'source-failed', message: 'The server did not answer.' } });
    } finally {
      await guarded.close();
    }
  });
});

describe('the page’s own code (hindsight-model.ts) for notes', () => {
  test('reads the sources, says what each can do, and builds the requests that mark, approve, search and open', async () => {
    await setServers({ notes: stdioNotes(), web: { url: http.url }, login: { url: 'https://example.invalid/mcp', auth: 'oauth' }, off: stdioNotes({ enabled: false }) });
    const send = async (request: { method: string; path: string; body?: Record<string, unknown> }) => owner.call(request.method, request.path, { body: request.body });
    const readinessOf = async () => Object.fromEntries(parseSources((await owner.call('GET', sourcesPath('default'))).body).map((row) => [row.name, readiness(row)]));

    expect(await readinessOf()).toEqual({ login: 'unsupported', notes: 'not-source', off: 'disabled', web: 'not-source' });
    await send(markRequest('notes', 'default', true));
    await send(markRequest('web', 'default', true));
    expect(await readinessOf()).toMatchObject({ notes: 'needs-approval', web: 'ready' });
    const approval = approveRequest('notes', 'default');
    expect((await owner.confirmed(approval.method, approval.path, 'notes')).status).toBe(200);
    expect(await readinessOf()).toMatchObject({ notes: 'ready' });

    const found = parseSearch((await send(searchNotesRequest('notes', 'default', ' tea '))).body);
    const opened = parsePreview((await send(previewNoteRequest('notes', 'default', found.hits[0].ref))).body);
    expect(found.hits.map((hit) => hit.title)).toEqual(['Tea blends']);
    expect(opened).toEqual({ tool: 'read_note', title: 'Tea blends', text: '# Tea blends\n\nGreen tea with jasmine in the morning. Oolong in the afternoon.', truncated: false });
    expect(calledTools()).toEqual(['search_notes', 'read_note']);
  });
});
