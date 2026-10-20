import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mcpTokenPath } from '../src/mcp-token.ts';
import crypto from 'node:crypto';
import { isRegistered, parseMcpServerInfo, registrationForm } from '../../web/src/modules/tools/caduceus-mcp.ts';
import { parseProbe, parseServers, serverCreate, serverTest, type McpRequest } from '../../web/src/modules/tools/mcp-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import { ownerCookie } from './fixtures/owner.ts';
import { seedSessions } from './fixtures/seed-session.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { startMcpClient, type McpClient } from './fixtures/mcp-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

// Caduceus as an MCP server (M4 #11): the stdio server an agent registers in Hermes, run the way an MCP client runs it, in front of a
// Caduceus server and a real Hermes in a throwaway HERMES_HOME. What the tools answer is checked against Hermes asked around Caduceus.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const clients: McpClient[] = [];

interface HermesProject {
  id: string;
  name: string;
  primary_path: string | null;
}
/** Hermes's projects, asked around Caduceus. */
const projectsOf = async () => (await around<{ projects: HermesProject[] }>('projects.list', { profile: 'default' })).projects;
/** Hermes's own row of a session, read around Caduceus. */
const sessionRow = async (id: string) => (await (await hermes.backend.fetch(`/api/sessions/${id}?profile=default`)).json()) as { title?: string; cwd?: string | null };
/** What the owner's page reads from the audit log. */
async function auditEntries(): Promise<AuditEntry[]> {
  const cookie = await ownerCookie(server!.url);
  return ((await (await fetch(`${server!.url}/_caduceus/api/audit`, { headers: { cookie } })).json()) as { entries: AuditEntry[] }).entries;
}

beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const project of (await around<{ projects: { id: string }[] }>('projects.list', { profile: 'default' })).projects) await around('projects.delete', { profile: 'default', id: project.id });
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

const folders: string[] = [];
const newFolder = (): string => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-mcp-')));
  folders.push(folder);
  return folder;
};

/** A gateway call made straight to Hermes, around Caduceus: what the tests seed with and check by. */
async function around<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
  const socket = await hermes.backend.openGateway();
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  socket.on('message', (data) => {
    const frame = JSON.parse(String(data)) as { method?: string; params?: { type?: string }; id?: number; result?: T; error?: { message: string } };
    if (frame.method === 'event' && frame.params?.type === 'gateway.ready') socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
    if (frame.id !== 1) return;
    if (frame.error) reject(new Error(frame.error.message));
    else resolve(frame.result as T);
  });
  try {
    return await promise;
  } finally {
    socket.close();
  }
}

async function connect(name?: string): Promise<McpClient> {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const client = await startMcpClient({ url: server.url, root: hermes.home, name });
  clients.push(client);
  return client;
}

describe('the stdio server', () => {
  test('introduces itself and lists its tools, each with a schema, over the MCP handshake', async () => {
    const client = await connect();

    const tools = await client.tools();

    expect(client.server.name).toBe('caduceus');
    expect(tools.map((tool) => tool.name).sort()).toEqual(['create_project', 'delete_project', 'list_projects', 'list_sessions', 'move_session', 'rename_project', 'rename_session']);
    for (const tool of tools) {
      expect(tool.description).not.toBe('');
      expect(tool.inputSchema.type).toBe('object');
    }
    expect(tools.find((tool) => tool.name === 'move_session')?.inputSchema.required).toEqual(['session_id', 'project_id']);
    expect(tools.find((tool) => tool.name === 'list_projects')?.annotations).toMatchObject({ readOnlyHint: true });
  });
});

describe('list_projects', () => {
  test('answers with the projects Hermes has', async () => {
    const folder = newFolder();
    const made = await around<{ project: { id: string } }>('projects.create', { profile: 'default', name: 'Alpha', folders: [folder], primary_path: folder });
    const client = await connect();

    const result = await client.call('list_projects');

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ projects: [{ id: made.project.id, name: 'Alpha', folder, folders: [folder], color: null, archived: false }], active_id: null });
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  });
});

describe('changing projects', () => {
  test('create_project makes the project in Hermes and the call is audited under the MCP client', async () => {
    const folder = newFolder();
    const client = await connect('claude-code');

    const result = await client.call('create_project', { name: 'Beta', folder });

    const [project] = await projectsOf();
    expect(result.isError).toBeUndefined();
    expect(project).toMatchObject({ name: 'Beta', primary_path: folder });
    expect(result.structuredContent).toEqual({ project: { id: project!.id, name: 'Beta', folder, folders: [folder], color: null, archived: false } });
    expect((await auditEntries()).find((entry) => entry.action === 'rpc projects.create')).toMatchObject({ actor: 'mcp:claude-code', tier: 'T1', profile: 'default' });
  });

  test('rename_project renames it in Hermes', async () => {
    const folder = newFolder();
    const made = await around<{ project: { id: string } }>('projects.create', { profile: 'default', name: 'Old name', folders: [folder], primary_path: folder });
    const client = await connect();

    const result = await client.call('rename_project', { project_id: made.project.id, name: 'New name' });

    expect(result.isError).toBeUndefined();
    expect((await projectsOf()).map((project) => project.name)).toEqual(['New name']);
  });

  test('an error of Hermes comes back as a machine-readable failure, not a crash', async () => {
    const client = await connect();

    const result = await client.call('rename_project', { project_id: 'p_nothing', name: 'Whatever' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: 'hermes-error' });
  });
});

describe('sessions', () => {
  test('list_sessions lists the sessions of the profile, newest first, up to the limit', async () => {
    await seedSessions(hermes.home, [{ id: 'sa', title: 'Alpha chat' }, { id: 'sb', title: 'Beta chat' }, { id: 'sc', title: 'Gamma chat' }]);
    const client = await connect();

    const all = await client.call('list_sessions');
    const one = await client.call('list_sessions', { limit: 1 });

    expect((all.structuredContent!.sessions as { id: string; title: string }[]).map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'sc', title: 'Gamma chat' },
      { id: 'sb', title: 'Beta chat' },
      { id: 'sa', title: 'Alpha chat' },
    ]);
    expect((one.structuredContent!.sessions as unknown[]).length).toBe(1);
  });

  test('rename_session gives the session a new title in Hermes', async () => {
    await seedSessions(hermes.home, [{ id: 'sr', title: 'Before' }]);
    const client = await connect();

    const result = await client.call('rename_session', { session_id: 'sr', title: 'After' });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ title: 'After' });
    expect((await sessionRow('sr')).title).toBe('After');
  });

  test('move_session moves a session into a project, and list_sessions of the project then has it', async () => {
    await seedSessions(hermes.home, [{ id: 'sm', title: 'Movable' }, { id: 'sn', title: 'Staying' }]);
    const folder = newFolder();
    const made = await around<{ project: { id: string } }>('projects.create', { profile: 'default', name: 'Home of sm', folders: [folder], primary_path: folder });
    const client = await connect();

    const moved = await client.call('move_session', { session_id: 'sm', project_id: made.project.id });
    const inProject = await client.call('list_sessions', { project_id: made.project.id });

    expect(moved.isError).toBeUndefined();
    expect((await sessionRow('sm')).cwd).toBe(folder);
    expect((await sessionRow('sn')).cwd).not.toBe(folder);
    expect((inProject.structuredContent!.sessions as { id: string }[]).map((session) => session.id)).toEqual(['sm']);
  });

  test('move_session to a project that does not exist says so and moves nothing', async () => {
    await seedSessions(hermes.home, [{ id: 'sx', title: 'Stays' }]);
    const client = await connect();

    const result = await client.call('move_session', { session_id: 'sx', project_id: 'p_nothing' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: 'project-not-found' });
  });
});

/** The owner of the server, signed in with a step-up grant: the one who may turn read-only mode on, and who holds a grant an agent must not borrow. */
async function steppedOwner() {
  const url = server!.url;
  const cookie = await ownerCookie(url);
  await stepUp(url, cookie, await addPasskey(url, cookie));
  const readOnly = (value: boolean) => fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: value }) });
  return { url, cookie, readOnly };
}

describe('the policy', () => {
  test('read-only mode refuses writes, which are not made, and still lets reads through', async () => {
    const folder = newFolder();
    const client = await connect();
    const owner = await steppedOwner();
    expect((await owner.readOnly(true)).status).toBe(200);

    const refused = await client.call('create_project', { name: 'Never made', folder });
    const read = await client.call('list_projects');

    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({ error: 'read-only', tier: 'T1' });
    expect(await projectsOf()).toEqual([]);
    expect(read.isError).toBeUndefined();
  });

  test('delete_project is refused as needing a step-up, even while the owner holds one, and the project stays', async () => {
    const folder = newFolder();
    const made = await around<{ project: { id: string } }>('projects.create', { profile: 'default', name: 'Keep me', folders: [folder], primary_path: folder });
    const client = await connect('claude-code');
    await steppedOwner();

    const result = await client.call('delete_project', { project_id: made.project.id });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: 'step-up-required', tier: 'T2', operation: 'rpc projects.delete' });
    expect(String(result.structuredContent!.message)).toContain('Ask the owner');
    expect((await projectsOf()).map((project) => project.name)).toEqual(['Keep me']);
    expect((await auditEntries()).find((entry) => entry.action === 'mcp.refused')).toMatchObject({ actor: 'mcp:claude-code', target: 'delete_project', tier: 'T2' });
  });

  test('every read is audited under the MCP client too', async () => {
    const client = await connect('inspector');

    await client.call('list_projects', { profile: 'default' });

    expect((await auditEntries()).find((entry) => entry.action === 'mcp.list_projects')).toMatchObject({ actor: 'mcp:inspector', tier: 'T0', profile: 'default' });
  });
});

describe('the token', () => {
  const callRoute = (url: string, headers: Record<string, string>, tool = 'list_projects') => fetch(`${url}/_caduceus/mcp/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"arguments":{}}' });
  const token = () => fs.readFileSync(mcpTokenPath(hermes.home), 'utf8').trim();

  test('is kept where only the owner can read it, and is what the route accepts', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });

    expect(fs.statSync(mcpTokenPath(hermes.home)).mode & 0o777).toBe(0o600);
    expect((await callRoute(server.url, { authorization: `Bearer ${token()}` })).status).toBe(200);
  });

  test('a missing or wrong token is refused and the refusal audited; the owner’s session is not a token', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    const owner = await steppedOwner();

    const none = await callRoute(server.url, {});
    const wrong = await callRoute(server.url, { authorization: 'Bearer not-the-token' });
    const cookie = await callRoute(server.url, { cookie: owner.cookie, origin: owner.url });

    expect([none.status, wrong.status, cookie.status]).toEqual([401, 401, 401]);
    expect((await auditEntries()).filter((entry) => entry.action === 'mcp.token-refused')).toHaveLength(3);
  });

  test('is no session: it opens nothing of the Caduceus API or of Hermes', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    const bearer = { authorization: `Bearer ${token()}` };

    const api = await fetch(`${server.url}/_caduceus/api/audit`, { headers: bearer });
    const proxy = await fetch(`${server.url}/api/sessions`, { headers: bearer });
    // The tool route takes a POST with the token and nothing else.
    const read = await fetch(`${server.url}/_caduceus/mcp/tools/list_projects`, { headers: bearer });

    expect([api.status, proxy.status]).toEqual([401, 401]);
    expect(read.status).toBe(401);
  });

  test('is not accepted from a request that came through a forwarding proxy such as Tailscale Serve', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });

    const res = await callRoute(server.url, { authorization: `Bearer ${token()}`, 'x-forwarded-for': '100.64.0.7' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'not-local' });
  });

  test('an unknown tool is a 404 and arguments that do not fit the schema a 400, before Hermes is asked anything', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    const bearer = { authorization: `Bearer ${token()}` };

    const unknown = await callRoute(server.url, bearer, 'drop_everything');
    const bad = await fetch(`${server.url}/_caduceus/mcp/tools/create_project`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify({ arguments: { name: 'No folder' } }) });

    expect(unknown.status).toBe(404);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'bad-arguments', message: 'folder is required.' });
  });
});

describe('the protocol', () => {
  test('arguments that do not fit a tool’s schema are a failed call the agent can read', async () => {
    const client = await connect();

    const result = await client.call('rename_session', { session_id: 'x', title: 5 });
    const extra = await client.call('list_projects', { everything: true });

    expect(result).toMatchObject({ isError: true, structuredContent: { error: 'bad-arguments', message: 'title must be a string.' } });
    expect(extra).toMatchObject({ isError: true, structuredContent: { error: 'bad-arguments' } });
  });

  test('a call before the handshake, an unknown tool and an unknown method are protocol errors', async () => {
    server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    const early = await startMcpClient({ url: server.url, root: hermes.home, handshake: false });
    clients.push(early);
    const ready = await connect();

    expect((await early.request('tools/list')).error?.code).toBe(-32002);
    expect((await ready.request('tools/call', { name: 'drop_everything', arguments: {} })).error?.code).toBe(-32602);
    expect((await ready.request('resources/list')).error?.code).toBe(-32601);
    expect((await ready.request('ping')).result).toEqual({});
  });

  test('when Caduceus is not running the call fails with a reason, and the server keeps serving', async () => {
    const client = await connect();
    await server!.close();
    server = undefined;

    const result = await client.call('list_projects');

    expect(result).toMatchObject({ isError: true, structuredContent: { error: 'caduceus-unreachable' } });
    expect((await client.tools()).length).toBe(7);
  });
});

describe('registering the server in Hermes', () => {
  test('the info card’s registration is added through the add flow (a T3), and Hermes itself starts the server and lists its tools', async () => {
    server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
    const owner = await steppedOwner();
    const call = async (method: string, route: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`${owner.url}${route}`, { method, headers: { origin: owner.url, cookie: owner.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const send = async (request: McpRequest, typed?: string) => {
      let confirmation: string | undefined;
      if (typed !== undefined) {
        const bodySha256 = crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex');
        const minted = (await (await call('POST', '/_caduceus/api/policy/confirmations', { operation: `${request.method} ${request.path}`, target: typed, typed, bodySha256 })).json()) as { token: string };
        confirmation = minted.token;
      }
      return call(request.method, request.path, request.body, confirmation ? { 'x-caduceus-confirmation': confirmation } : {});
    };
    const info = parseMcpServerInfo(await (await call('GET', '/_caduceus/api/mcp-server')).json())!;
    const listServers = async () => parseServers(await (await call('GET', '/api/mcp/servers?profile=default')).json(), await (await call('GET', '/api/config?profile=default')).json());

    expect(info.tools.map((tool) => tool.name).sort()).toEqual(['create_project', 'delete_project', 'list_projects', 'list_sessions', 'move_session', 'rename_project', 'rename_session']);
    expect(info.args).toContain(server.url);
    expect(JSON.stringify(info)).not.toContain(fs.readFileSync(mcpTokenPath(hermes.home), 'utf8').trim());
    expect(isRegistered(info, await listServers())).toBe(false);

    const request = serverCreate(registrationForm(info), 'default');
    const refused = await send(request);
    const added = await send(request, 'caduceus');
    const registered = await listServers();
    const probed = parseProbe(await (await call('POST', serverTest('caduceus', 'default').path)).json());

    try {
      expect(refused.status).toBe(403);
      expect(added.status).toBe(200);
      expect(isRegistered(info, registered)).toBe(true);
      expect(registered[0]).toMatchObject({ transport: 'stdio', command: info.command, args: info.args });
      expect(probed.tools.map((tool) => tool.name).sort()).toEqual(info.tools.map((tool) => tool.name).sort());
    } finally {
      await call('PUT', '/api/mcp/servers?profile=default', { servers: {} });
    }
  });
});
