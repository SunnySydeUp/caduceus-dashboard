import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditEntry, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { emptyHookForm, hookCreate, hookProblems, hookRemove, parseHooks, type HookRequest } from '../../web/src/modules/tools/hooks-model.ts';
import { backendSelect, parseBackends, parseTerminalCwd, readBackendAnswer, terminalCwdUpdate, type TerminalRequest } from '../../web/src/modules/tools/terminal-model.ts';
import { createChat, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { folderProblem, parseListing } from '../../web/src/modules/work/workspace-model.ts';
import { remoteWorkspace } from '../../web/src/modules/tools/terminal-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { openGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Agents › Tools & MCP › Hooks and Terminal (M4 #08) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The
// page's own reading and request code (`web/src/modules/tools/hooks-model.ts`, `terminal-model.ts`) is run over what Hermes really answers.
// A hook is only ever written to the temp home's config.yaml and its consent list: the test sessions here never start an agent, so no hook
// command runs. Every command points into a temp directory of the test's own, so one that did run could touch nothing else.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
let scratch: string;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-hooks-'));
}, 90_000);
afterAll(async () => {
  await hermes.stop();
  fs.rmSync(scratch, { recursive: true, force: true });
});
afterEach(async () => {
  // The home is shared by the tests of this file: every test starts from profiles with no hooks.
  for (const profile of ['default', 'builder']) {
    const listed = (await (await hermes.backend.fetch(`/api/ops/hooks?profile=${profile}`)).json().catch(() => ({ hooks: [] }))) as { hooks?: { event: string; command: string }[] };
    for (const { event, command } of listed.hooks ?? []) await hermes.backend.fetch(`/api/ops/hooks?profile=${profile}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event, command }) });
  }
  // And the terminal of each is the local one, starting where Hermes chooses.
  for (const profile of ['default', 'builder']) {
    await hermes.backend.fetch(`/api/tools/terminal/backend?profile=${profile}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backend: 'local', profile }) });
    await hermes.backend.fetch(`/api/config?profile=${profile}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: { terminal: { cwd: '.' } } }) });
  }
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

interface Answer<T> {
  status: number;
  body: T;
  headers: Headers;
  text: string;
}

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Answer<T>>;
  /** Sends one of the page's requests the way the tiered dialog does: with the typed confirmation of `typed` for a T3. */
  send<T = unknown>(request: HookRequest | TerminalRequest, typed?: string): Promise<Answer<T>>;
}

async function start({ steppedUp = true }: { steppedUp?: boolean } = {}): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  const call: Owner['call'] = async (method, route, { body, headers } = {}) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as never };
  };
  const send: Owner['send'] = async (request, typed) => {
    let confirmation: string | undefined;
    if (typed !== undefined) {
      const bodySha256 = request.body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex');
      const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation: `${request.method} ${request.path}`, target: typed, typed, ...(bodySha256 ? { bodySha256 } : {}) } });
      confirmation = minted.body.token;
    }
    return call(request.method, request.path, { body: request.body, headers: confirmation ? { 'x-caduceus-confirmation': confirmation } : undefined });
  };
  return { call, send };
}

/** The second profile of the shared home: made once, left in place. */
const ensureBuilder = async (owner: Owner) => {
  const listed = (await owner.call<{ profiles: { name: string }[] }>('GET', '/api/profiles')).body.profiles;
  if (!listed.some((profile) => profile.name === 'builder')) expect((await owner.call('POST', '/api/profiles', { body: { name: 'builder' } })).status).toBe(200);
};

const hooksOf = async (owner: Owner, profile = 'default') => parseHooks((await owner.call('GET', `/api/ops/hooks?profile=${profile}`)).body, profile);

describe('creating a shell hook', () => {
  test('is a Tier 3 write whose typed confirmation is the whole command: nothing is saved without it, and then the hook is listed with its event, command and profile', async () => {
    const owner = await start();
    const command = `${scratch}/notify.sh --quiet`;
    const request = hookCreate({ event: 'on_session_start', command, matcher: '', timeout: '' }, 'default');

    const refused = await owner.send<PolicyRefusal>(request);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    expect(await hooksOf(owner)).toEqual({ hooks: [], events: expect.arrayContaining(['on_session_start', 'pre_tool_call']) });

    const created = await owner.send(request, command);
    const listed = await hooksOf(owner);
    const audit = await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');

    expect(created.status).toBe(200);
    // Hermes lists the timeout it will use: 60 seconds when the hook sets none.
    expect(listed.hooks).toEqual([{ event: 'on_session_start', command, matcher: undefined, timeout: 60, profile: 'default', allowed: true, executable: false }]);
    expect(audit.body.entries.find((entry) => entry.action === 'POST /api/ops/hooks')).toMatchObject({ tier: 'T3', profile: 'default' });
  });
});

describe('removing a shell hook', () => {
  test('is a Tier 2 write (a passkey step-up, no typed name); Hermes takes the hook out of the profile and withdraws its consent, and a hook that is not there is refused in Hermes’s words', async () => {
    const asGuest = await start({ steppedUp: false });
    const command = `${scratch}/cleanup.sh`;
    fs.writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const created = await hermes.backend.fetch('/api/ops/hooks?profile=default', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'pre_tool_call', command, matcher: 'terminal', timeout: 5, approve: true }) });
    expect(created.status).toBe(200);
    const request = hookRemove({ event: 'pre_tool_call', command }, 'default');

    const refused = await asGuest.send<PolicyRefusal>(request);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect((await hooksOf(asGuest)).hooks).toEqual([{ event: 'pre_tool_call', command, matcher: 'terminal', timeout: 5, profile: 'default', allowed: true, executable: true }]);
    await server!.close();

    const owner = await start();
    const removed = await owner.send(request);
    const again = await owner.send<{ detail: string }>(request);

    expect(removed.status).toBe(200);
    expect((await hooksOf(owner)).hooks).toEqual([]);
    expect(again.status).toBe(404);
    expect(again.body.detail).toBe('No matching hook found');
  });
});

describe('hooks of one profile and the create form', () => {
  test('each profile has its own hooks, a hook Hermes does not know the event of is refused in Hermes’s words, and a timeout or matcher is kept', async () => {
    const owner = await start();
    await ensureBuilder(owner);
    const command = `${scratch}/builder-only.sh`;

    const created = await owner.send(hookCreate({ event: 'post_tool_call', command, matcher: 'write_file', timeout: '12' }, 'builder'), command);
    const unknown = await owner.send<{ detail: string }>(hookCreate({ event: 'when_it_rains', command, matcher: '', timeout: '' }, 'builder'), command);

    expect(created.status).toBe(200);
    expect((await hooksOf(owner, 'builder')).hooks).toEqual([{ event: 'post_tool_call', command, matcher: 'write_file', timeout: 12, profile: 'builder', allowed: true, executable: false }]);
    expect((await hooksOf(owner, 'default')).hooks).toEqual([]);
    expect(unknown.status).toBe(400);
    expect(unknown.body.detail).toMatch(/^Unknown event 'when_it_rains'\. Valid: .*post_tool_call/);
  });

  test('every write is blocked in read-only mode, and the list still reads', async () => {
    const owner = await start();
    const command = `${scratch}/read-only.sh`;
    const kept = await hermes.backend.fetch('/api/ops/hooks?profile=default', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'on_session_end', command }) });
    expect(kept.status).toBe(200);
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });

    const writes = [hookCreate({ event: 'on_session_end', command: `${command} again`, matcher: '', timeout: '' }, 'default'), hookRemove({ event: 'on_session_end', command }, 'default')];
    const answers = await Promise.all(writes.map((request) => owner.call<PolicyRefusal>(request.method, request.path, { body: request.body, headers: { 'x-caduceus-confirmation': 'whatever' } })));
    const listed = await hooksOf(owner);
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });

    expect(answers.map((answer) => [answer.status, answer.body.error])).toEqual(writes.map(() => [403, 'read-only']));
    expect(listed.hooks.map((hook) => hook.command)).toEqual([command]);
  });

  test('the form asks for an event Hermes has, one line of command and a whole number of seconds, and the create request says nothing it was not given', () => {
    const events = ['on_session_start', 'pre_tool_call'];
    expect(hookProblems({ ...emptyHookForm, event: 'pre_tool_call', command: '/usr/bin/true' }, events)).toEqual({});
    expect(hookProblems(emptyHookForm, events)).toEqual({ event: 'Choose the event the hook runs on.', command: 'Give the command to run.' });
    expect(hookProblems({ ...emptyHookForm, event: 'nope', command: 'x' }, events)).toEqual({ event: 'Hermes has no event called nope.' });
    expect(hookProblems({ ...emptyHookForm, event: 'pre_tool_call', command: 'a\nb' }, events)).toEqual({ command: 'Use one line: a command and its arguments, or the path of a script.' });
    expect(hookProblems({ ...emptyHookForm, event: 'pre_tool_call', command: 'x', timeout: '1.5' }, events)).toEqual({ timeout: 'Give the seconds as a whole number, such as 30, or leave it empty.' });
    expect(hookCreate({ event: ' pre_tool_call ', command: ' /usr/bin/true ', matcher: ' ', timeout: ' ' }, 'a b')).toEqual({ method: 'POST', path: '/api/ops/hooks?profile=a%20b', body: { event: 'pre_tool_call', command: '/usr/bin/true', approve: true } });
  });
});

describe('the terminal backend', () => {
  test('the choices are the backends Hermes lists, with the active one and Hermes’s own words about what each still needs', async () => {
    const owner = await start();

    const answer = await owner.call('GET', '/api/tools/terminal/backends?profile=default');
    const view = parseBackends(answer.body);

    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(view.active).toBe('local');
    expect(view.backends.map((backend) => backend.name)).toEqual(expect.arrayContaining(['local', 'docker', 'ssh', 'singularity', 'modal', 'daytona']));
    expect(view.backends.find((backend) => backend.name === 'local')).toMatchObject({ label: 'Local', active: true, status: 'ready', remote: false });
    // A fresh home has no ssh host or user: Hermes says which settings to make.
    expect(view.backends.find((backend) => backend.name === 'ssh')).toMatchObject({ label: 'SSH', active: false, status: 'needs-setup', remote: true, detail: 'Set terminal.ssh_host and terminal.ssh_user in config.yaml (or the matching TERMINAL_SSH_* env vars).' });
  });
});

describe('switching the terminal backend', () => {
  test('is a Tier 3 write that names the profile: nothing is saved without the typed backend, and then Hermes lists it as active for that profile only; Hermes’s answer carries no restart note unless Hermes gives one', async () => {
    const owner = await start();
    await ensureBuilder(owner);
    const request = backendSelect('ssh', 'builder');
    const backendsOf = async (profile: string) => parseBackends((await owner.call('GET', `/api/tools/terminal/backends?profile=${profile}`)).body);

    const refused = await owner.send<PolicyRefusal>(request);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    expect((await backendsOf('builder')).active).toBe('local');

    const saved = await owner.send<unknown>(request, 'ssh');
    const audit = await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');

    expect(saved.status).toBe(200);
    expect(readBackendAnswer(saved.body)).toEqual({ backend: 'ssh', restartNote: undefined });
    expect(await backendsOf('builder')).toMatchObject({ active: 'ssh', backends: expect.arrayContaining([expect.objectContaining({ name: 'ssh', active: true, status: 'needs-setup' })]) });
    expect((await backendsOf('default')).active).toBe('local');
    expect(audit.body.entries.find((entry) => entry.action === 'PUT /api/tools/terminal/backend')).toMatchObject({ tier: 'T3', profile: 'builder' });
  });

  test('a backend Hermes does not have is refused in Hermes’s words, and the switch is blocked in read-only mode', async () => {
    const owner = await start();

    const unknown = await owner.send<{ detail: string }>(backendSelect('teleporter', 'default'), 'teleporter');
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    const readOnly = await owner.call<PolicyRefusal>('PUT', '/api/tools/terminal/backend', { body: backendSelect('docker', 'default').body, headers: { 'x-caduceus-confirmation': 'whatever' } });
    await owner.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: false } });

    expect(unknown.status).toBe(400);
    expect(unknown.body.detail).toMatch(/^Unknown terminal backend: 'teleporter'\. Use one of: .*ssh/);
    expect(readOnly).toMatchObject({ status: 403, body: { error: 'read-only' } });
    expect(parseBackends((await owner.call('GET', '/api/tools/terminal/backends?profile=default')).body).active).toBe('local');
  });

  test('a restart note shows only when Hermes reports one, in its words', () => {
    expect(readBackendAnswer({ ok: true, backend: 'docker' })).toEqual({ backend: 'docker', restartNote: undefined });
    expect(readBackendAnswer({ ok: true, backend: 'docker', restart_required: true, message: 'Restart the gateway for chats that are open.' })).toEqual({ backend: 'docker', restartNote: 'Restart the gateway for chats that are open.' });
    expect(readBackendAnswer({ ok: true, backend: 'docker', restart_required: true })).toEqual({ backend: 'docker', restartNote: 'Hermes says this needs a restart to take effect.' });
  });
});

describe('the working directory', () => {
  test('is terminal.cwd of the profile’s config, a Tier 3 write; Hermes’s placeholder for none reads as no folder', async () => {
    const owner = await start();
    const folder = fs.mkdtempSync(path.join(scratch, 'work-'));
    const cwdOf = async () => parseTerminalCwd((await owner.call('GET', '/api/config?profile=default')).body);
    expect(await cwdOf()).toBeUndefined();

    const request = terminalCwdUpdate(` ${folder} `, 'default');
    const refused = await owner.send<PolicyRefusal>(request);
    const saved = await owner.send(request, 'default');

    expect(refused.status).toBe(403);
    expect(saved.status).toBe(200);
    expect(await cwdOf()).toBe(folder);
  });
});

describe('workspaces under a remote backend', () => {
  test('under SSH Hermes takes a path only the remote machine has for the chat, as typed; under another remote backend Hermes refuses it in its own words, in the composer and in the folder check, and the page says what that means', async () => {
    const owner = await start();
    const llm = await startStubLlm();
    await llm.connect(hermes);
    const page = openGatewayConnection(server!.url, await ownerCookie(server!.url));
    let chat: Chat | undefined;
    try {
      await page.until((status) => status.state === 'connected');
      expect((await owner.send(backendSelect('ssh', 'default'), 'ssh')).status).toBe(200);
      expect(remoteWorkspace(parseBackends((await owner.call('GET', '/api/tools/terminal/backends?profile=default')).body))).toEqual({ backend: 'ssh', label: 'SSH' });

      chat = createChat(page.connection, { history: page.rest, cwd: scratch });
      await chat.send('First');
      await chat.until((state) => !state.running && state.turn === undefined && state.messages.length >= 2);
      // The folder is on the other machine: Hermes 0.22 no longer looks for an SSH workspace on its own Mac, and takes the path.
      await chat.setWorkspace('/srv/remote-only/app');
      expect(chat.state.cwd).toBe('/srv/remote-only/app');

      // Docker and the other backends mount folders of the Mac, and Hermes keeps checking them there.
      expect((await owner.send(backendSelect('docker', 'default'), 'docker')).status).toBe(200);
      const remote = remoteWorkspace(parseBackends((await owner.call('GET', '/api/tools/terminal/backends?profile=default')).body));
      expect(remote).toEqual({ backend: 'docker', label: 'Docker / Podman' });
      await expect(chat.setWorkspace('/srv/remote-only/other')).rejects.toThrow('working directory does not exist: /srv/remote-only/other');

      const listing = parseListing((await owner.call('GET', '/api/fs/list?path=%2Fsrv%2Fremote-only%2Fapp')).body);
      expect(listing).toEqual({ kind: 'missing' });
      expect(folderProblem(listing, remote)).toBe('Hermes does not find this folder on the Mac that runs it. The terminal backend of this profile is Docker / Podman, so the agent works on another machine, but Hermes can only check folders on its own Mac: a folder that exists only there is refused here.');
      expect(folderProblem({ kind: 'folder', folders: [], files: 0 }, remote)).toBeUndefined();
    } finally {
      chat?.dispose();
      page.connection.close();
      await llm.close();
    }
  });

  test('only the local backend keeps workspaces on the Mac that runs Hermes: any other is remote, and nothing is labelled while Hermes has not answered', () => {
    const view = (active: string) => parseBackends({ active, backends: [{ name: 'local', label: 'Local', status: 'ready', active: active === 'local' }, { name: 'docker', label: 'Docker / Podman', status: 'ready', active: active === 'docker' }] });
    expect(remoteWorkspace(view('local'))).toBeUndefined();
    expect(remoteWorkspace(view('docker'))).toEqual({ backend: 'docker', label: 'Docker / Podman' });
    expect(remoteWorkspace(undefined)).toBeUndefined();
  });
});
