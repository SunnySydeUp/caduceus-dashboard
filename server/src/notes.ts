// External notes (R11, M4 #10). The sources are the MCP servers of a profile's Hermes config (`mcp_servers`); the owner marks which ones are notes sources, and Caduceus,
// as an MCP client (`notes-mcp.ts`), calls only their read and search tools (`notes-tools.ts`): search returns snippets, preview opens one note read-only. Hermes has no
// route that calls an MCP tool, so this is Caduceus's own work, and it is the one place Caduceus runs a command a config names. Therefore the first time for each stdio
// server (and again whenever its command, arguments, environment or folder change) the owner approves it with a typed confirmation (T3), recorded against a hash of the
// command line. A call is a fresh connection that ends with the call, and nothing a source said is kept: only which servers are marked and which commands are approved.
import crypto from 'node:crypto';
import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { NotePreview, NotesSearchAnswer, NotesSources, NotesSourceRow } from '@caduceus/contracts/hindsight-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuditLog } from './audit-log.ts';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import { parseRawConfig } from './config-raw.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { McpFailure, withMcpServer, type McpTarget, type McpTool, type McpToolResult } from './notes-mcp.ts';
import { hitsOf, notesTools, readArguments, searchArguments, toolRole, type ToolRole } from './notes-tools.ts';
import { judgeOwned } from './owned-request.ts';
import type { RestPolicy } from './policy.ts';

export interface NotesRoutesDeps {
  backend: HermesBackend;
  policy: RestPolicy;
  audit: AuditLog;
  store: CaduceusStore;
  now: () => number;
}

const MAX_QUERY_CHARS = 500;
const MAX_REF_CHARS = 1000;
/** A note's text is shown whole up to this many characters. */
const MAX_PREVIEW_CHARS = 100_000;
const SERVER_NAME = /^[\w.@-]{1,100}$/;

/** A server of the config and what Caduceus can do with it. */
interface Source {
  name: string;
  target: McpTarget | undefined;
  disabled: boolean;
  note: string | undefined;
  /** A hash of what running the server runs: changes when the command, its arguments, its environment or its folder do. */
  fingerprint: string;
  command: string | undefined;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const stringMap = (value: unknown): Record<string, string> => (isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)])) : {});

function sourceOf(name: string, config: unknown): Source {
  const cfg = isRecord(config) ? config : {};
  const disabled = cfg.enabled === false;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([cfg.command, cfg.args, cfg.env, cfg.cwd])).digest('hex');
  const unsupported = (note: string, command?: string): Source => ({ name, target: undefined, disabled, note, fingerprint, command });
  if (JSON.stringify(cfg).includes('${')) return unsupported('This server’s settings use ${NAME} variables, which Caduceus does not fill in.');
  if (typeof cfg.url === 'string' && cfg.url !== '') {
    if (cfg.auth === 'oauth') return unsupported('This server signs in with OAuth, which only Hermes holds the tokens for.');
    let url: URL;
    try {
      url = new URL(cfg.url);
    } catch {
      return unsupported('This server’s address is not a web address.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return unsupported('This server’s address is not a web address.');
    return { name, target: { kind: 'http', url: url.href, headers: stringMap(cfg.headers) }, disabled, note: undefined, fingerprint, command: undefined };
  }
  if (typeof cfg.command === 'string' && cfg.command !== '') {
    const args = strings(cfg.args);
    const command = [cfg.command, ...args].join(' ');
    return { name, target: { kind: 'stdio', command: cfg.command, args, env: stringMap(cfg.env), cwd: typeof cfg.cwd === 'string' && cfg.cwd !== '' ? cfg.cwd : undefined }, disabled, note: undefined, fingerprint, command };
  }
  return unsupported('This server has neither a command nor an address.');
}

export function mountNotesRoutes(app: Hono<AuthEnv>, { backend, policy, audit, store, now }: NotesRoutesDeps): void {
  const { db } = store;

  /** The MCP servers of a profile's config, read from Hermes each time. */
  async function sourcesOf(profile: string): Promise<Source[] | undefined> {
    const res = await backend.fetch(`/api/config/raw?profile=${encodeURIComponent(profile)}`);
    const file: unknown = await res.json().catch(() => undefined);
    if (!res.ok || !isRecord(file) || typeof file.yaml !== 'string') return undefined;
    const config = parseRawConfig(file.yaml);
    const servers = isRecord(config) && isRecord(config.mcp_servers) ? config.mcp_servers : {};
    return Object.entries(servers)
      .filter(([name]) => SERVER_NAME.test(name))
      .map(([name, server]) => sourceOf(name, server))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const isMarked = (profile: string, server: string) => db.prepare('SELECT 1 FROM notes_sources WHERE profile = ? AND server = ?').get(profile, server) !== undefined;
  const isApproved = (profile: string, source: Source) => (db.prepare('SELECT fingerprint FROM notes_commands WHERE profile = ? AND server = ?').get(profile, source.name) as { fingerprint: string } | undefined)?.fingerprint === source.fingerprint;

  const row = (profile: string, source: Source): NotesSourceRow => ({
    name: source.name,
    transport: source.target?.kind ?? 'unsupported',
    source: isMarked(profile, source.name),
    disabled: source.disabled,
    approved: source.target?.kind === 'http' || (source.target?.kind === 'stdio' && isApproved(profile, source)),
    ...(source.command ? { command: source.command } : {}),
    ...(source.note ? { note: source.note } : {}),
  });

  const profileOf = (c: Context<AuthEnv>) => new URL(c.req.url).searchParams.get('profile') || 'default';

  app.get('/_caduceus/api/notes/sources', async (c) => {
    const judged = await judgeOwned(c, policy);
    if (!judged.ok) return judged.response;
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);
    const profile = profileOf(c);
    const sources = await sourcesOf(profile);
    if (!sources) return c.json({ error: 'upstream', message: 'Hermes did not give its MCP servers.' }, 502);
    return c.json<NotesSources>({ sources: sources.map((source) => row(profile, source)) });
  });

  app.put('/_caduceus/api/notes/sources/:server', async (c) => {
    const judged = await judgeOwned(c, policy);
    if (!judged.ok) return judged.response;
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);
    const profile = profileOf(c);
    const server = c.req.param('server');
    if (!isRecord(judged.body) || typeof judged.body.source !== 'boolean') return c.json({ error: 'bad-request', message: 'Say whether it is a notes source.' }, 400);
    const sources = await sourcesOf(profile);
    const found = sources?.find((source) => source.name === server);
    if (!sources) return c.json({ error: 'upstream', message: 'Hermes did not give its MCP servers.' }, 502);
    if (!found) return c.json({ error: 'not-found', message: `${server} is not one of this profile’s MCP servers.` }, 404);
    if (judged.body.source) db.prepare('INSERT OR IGNORE INTO notes_sources (profile, server) VALUES (?, ?)').run(profile, server);
    else {
      // Unmarking takes the approval with it: marking the server again asks again.
      db.prepare('DELETE FROM notes_sources WHERE profile = ? AND server = ?').run(profile, server);
      db.prepare('DELETE FROM notes_commands WHERE profile = ? AND server = ?').run(profile, server);
    }
    return c.json<NotesSourceRow>(row(profile, found));
  });

  // The first run of a stdio server's command: the typed name was checked by the policy (T3), and this records which command line it was for.
  app.post('/_caduceus/api/notes/sources/:server/approve', async (c) => {
    const judged = await judgeOwned(c, policy);
    if (!judged.ok) return judged.response;
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);
    const profile = profileOf(c);
    const server = c.req.param('server');
    const found = (await sourcesOf(profile))?.find((source) => source.name === server);
    if (!found || found.target?.kind !== 'stdio') return c.json({ error: 'not-found', message: `${server} is not an MCP server that runs a command.` }, 404);
    db.prepare('INSERT INTO notes_commands (profile, server, fingerprint, approved_at) VALUES (?, ?, ?, ?) ON CONFLICT (profile, server) DO UPDATE SET fingerprint = excluded.fingerprint, approved_at = excluded.approved_at').run(profile, server, found.fingerprint, now());
    return c.json<NotesSourceRow>(row(profile, found));
  });

  /**
   * A call of a notes source's tool. `role` is what the call is for: the tool is the one the request names or the one the server offers for the role, and a tool whose role is
   * not `role` is refused before anything is called. `problemWith` says in words what is wrong with a request before any connection is made, and `plan` builds the tool's arguments. The call is recorded in the
   * audit log, by server and tool and never by what was asked, once it is known to go out.
   */
  async function callSource(c: Context<AuthEnv>, role: ToolRole, action: 'search' | 'preview', problemWith: (body: Record<string, unknown>) => string | undefined, plan: (tool: McpTool, body: Record<string, unknown>) => Record<string, unknown> | string): Promise<{ tool: string; result: McpToolResult } | Response> {
    const judged = await judgeOwned(c, policy);
    if (!judged.ok) return judged.response;
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);
    const profile = profileOf(c);
    const body = isRecord(judged.body) ? judged.body : {};
    const server = typeof body.server === 'string' ? body.server : '';
    const problem = problemWith(body);
    if (problem) return c.json({ error: 'bad-request', message: problem }, 400);
    const sources = await sourcesOf(profile);
    if (!sources) return c.json({ error: 'upstream', message: 'Hermes did not give its MCP servers.' }, 502);
    const source = sources.find((candidate) => candidate.name === server);
    if (!source) return c.json({ error: 'not-found', message: `${server || 'That'} is not one of this profile’s MCP servers.` }, 404);
    if (!isMarked(profile, server)) return c.json({ error: 'not-a-source', message: `${server} is not marked as a notes source.` }, 409);
    if (source.disabled) return c.json({ error: 'disabled', message: `${server} is turned off in Hermes.` }, 409);
    if (!source.target) return c.json({ error: 'unsupported', message: source.note ?? 'Caduceus cannot use this server.' }, 409);
    if (source.target.kind === 'stdio' && !isApproved(profile, source)) {
      return c.json({ error: 'approval-required', message: `${server} runs a command on this Mac. Approve it once before Caduceus runs it.`, command: source.command }, 409);
    }
    try {
      return await withMcpServer(source.target, async (connection): Promise<{ tool: string; result: McpToolResult } | Response> => {
        const tools = await connection.tools();
        const requested = typeof body.tool === 'string' ? body.tool : undefined;
        const tool = requested === undefined ? tools.find((candidate) => candidate.name === notesTools(tools)[role]) : tools.find((candidate) => candidate.name === requested);
        if (requested !== undefined && (!tool || toolRole(tool) !== role)) return c.json({ error: 'tool-not-allowed', message: `${requested} is not a ${role} tool Caduceus may call.` }, 403);
        if (!tool) return c.json({ error: 'no-tool', message: `${server} has no tool for ${role === 'search' ? 'searching' : 'reading'} notes.` }, 409);
        const args = plan(tool, body);
        if (typeof args === 'string') return c.json({ error: 'bad-request', message: args }, 400);
        audit.record({ actor: 'owner', action: `notes.${action}`, target: `${server}:${tool.name}`, source: judged.requester.source, tier: 'T0', profile });
        return { tool: tool.name, result: await connection.call(tool.name, args) };
      });
    } catch (error) {
      if (error instanceof McpFailure) return c.json({ error: 'source-failed', message: error.message }, 502);
      throw error;
    }
  }

  app.post('/_caduceus/api/notes/search', async (c) => {
    const queryOf = (body: Record<string, unknown>) => (typeof body.query === 'string' ? body.query.trim() : '');
    const called = await callSource(
      c,
      'search',
      'search',
      (body) => (queryOf(body) === '' || queryOf(body).length > MAX_QUERY_CHARS ? `Search for 1 to ${MAX_QUERY_CHARS} characters.` : undefined),
      (tool, body) => searchArguments(tool, queryOf(body)) ?? `${tool.name} takes no text to search for.`,
    );
    if (called instanceof Response) return called;
    if (called.result.isError) return c.json({ error: 'source-failed', message: called.result.text.slice(0, 300) || 'The server could not search.' }, 502);
    const hits = hitsOf(called.result);
    return c.json<NotesSearchAnswer>({ tool: called.tool, hits: hits ?? [], ...(hits ? {} : { text: called.result.text.slice(0, MAX_PREVIEW_CHARS) }) });
  });

  app.post('/_caduceus/api/notes/preview', async (c) => {
    const refOf = (body: Record<string, unknown>) => (typeof body.ref === 'string' ? body.ref : '');
    const called = await callSource(
      c,
      'read',
      'preview',
      (body) => (refOf(body) === '' || refOf(body).length > MAX_REF_CHARS ? 'Name the note to open.' : undefined),
      (tool, body) => readArguments(tool, refOf(body)) ?? `${tool.name} takes no note to open.`,
    );
    if (called instanceof Response) return called;
    if (called.result.isError) return c.json({ error: 'source-failed', message: called.result.text.slice(0, 300) || 'The server could not open that note.' }, 502);
    const text = called.result.text;
    const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
    return c.json<NotePreview>({ tool: called.tool, title: heading ?? '', text: text.slice(0, MAX_PREVIEW_CHARS), truncated: text.length > MAX_PREVIEW_CHARS });
  });
}
