import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PolicyRefusal, SessionInfo } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The policy proxy in front of the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME): what is let through
// really happens, and what is refused really does not. The refusals before Hermes are counted in policy-proxy.test.ts.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
let workDir: string;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

interface Started {
  url: string;
  cookie: string;
  server: CaduceusServer;
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T }>;
  /** Makes the typed confirmation of a T3 request (target typed as `typed`), and returns its token. */
  confirm(operation: string, target: string, body?: unknown): Promise<string>;
}

async function start(options: Partial<CaduceusServerOptions> = {}): Promise<Started> {
  workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-work-')));
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, fileRoots: [workDir], ...options });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  await stepUp(url, cookie, authenticator);
  const call: Started['call'] = async (method, route, { body, headers } = {}) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    // Unchecked: the assertions that follow are what check the body.
    const answer = (res.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : text) as never;
    return { status: res.status, body: answer };
  };
  const confirm: Started['confirm'] = async (operation, target, body) => {
    const bodySha256 = body === undefined ? undefined : crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const minted = await call<{ token: string }>('POST', '/_caduceus/api/policy/confirmations', { body: { operation, target, typed: target, ...(bodySha256 ? { bodySha256 } : {}) } });
    return minted.body.token;
  };
  return { url, cookie, server, call, confirm };
}

/** The names of the profiles Hermes has, read straight from it (not through Caduceus). */
async function profileNames(): Promise<string[]> {
  const { profiles }: { profiles: { name: string }[] } = await (await hermes.backend.fetch('/api/profiles')).json();
  return profiles.map((profile) => profile.name).sort();
}

describe('what the policy lets through, in front of the real Hermes', () => {
  test('a T1 create goes through, and a T3 delete needs its step-up and typed confirmation, then really deletes the profile', async () => {
    const { call, confirm } = await start();

    const created = await call('POST', '/api/profiles', { body: { name: 'scratch' } });
    const afterCreate = await profileNames();
    const withoutToken = await call('DELETE', '/api/profiles/scratch');
    const afterRefusal = await profileNames();
    const wrongProfile = await call('DELETE', '/api/profiles/scratch', { headers: { 'x-caduceus-confirmation': await confirm('DELETE /api/profiles/other', 'other') } });
    const deleted = await call('DELETE', '/api/profiles/scratch', { headers: { 'x-caduceus-confirmation': await confirm('DELETE /api/profiles/scratch', 'scratch') } });
    const afterDelete = await profileNames();

    expect(created.status).toBe(200);
    expect(afterCreate).toEqual(['default', 'scratch']);
    expect(withoutToken).toMatchObject({ status: 403, body: { error: 'confirmation-required' } });
    expect(wrongProfile).toMatchObject({ status: 403, body: { error: 'confirmation-invalid' } });
    expect(afterRefusal).toEqual(['default', 'scratch']);
    expect(deleted.status).toBe(200);
    expect(afterDelete).toEqual(['default']);
  });

  test('a T3 raw file write inside the allowed roots really writes the file; the guard keeps the keys, Caduceus’s data and the outside untouched', async () => {
    const { call, confirm } = await start();
    const notes = path.join(workDir, 'notes.md');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-outside-'));
    const envFile = path.join(hermes.home, '.env');
    fs.writeFileSync(envFile, 'OPENAI_API_KEY=sk-test\n');
    const store = path.join(hermes.home, 'caduceus', 'caduceus.db');
    const storeBefore = fs.statSync(store).size;
    try {
      const write = (target: string, content: string, token?: string) =>
        call<PolicyRefusal>('POST', '/api/fs/write-text', { body: { path: target, content }, ...(token ? { headers: { 'x-caduceus-confirmation': token } } : {}) });
      const bodyOf = (target: string, content: string) => ({ path: target, content });

      const withoutToken = await write(notes, 'hello\n');
      const existedBefore = fs.existsSync(notes);
      const written = await write(notes, 'hello\n', await confirm('POST /api/fs/write-text', 'notes.md', bodyOf(notes, 'hello\n')));
      const refused = [
        await write(envFile, 'OPENAI_API_KEY=stolen\n'),
        await write(store, 'garbage'),
        await write(path.join(outside, 'x.txt'), 'x'),
        await write('/etc/caduceus-test', 'x'),
      ];
      const readStore = await call('GET', `/api/fs/read-text?path=${encodeURIComponent(store)}`);

      expect(withoutToken).toMatchObject({ status: 403, body: { error: 'confirmation-required' } });
      expect(existedBefore).toBe(false);
      expect(written).toMatchObject({ status: 200, body: { ok: true, path: notes, byteSize: 6 } });
      expect(fs.readFileSync(notes, 'utf8')).toBe('hello\n');
      expect(refused.map((r) => [r.status, r.body.reason])).toEqual([
        [403, 'protected-path'],
        [403, 'protected-path'],
        [403, 'outside-roots'],
        [403, 'outside-roots'],
      ]);
      expect(readStore).toMatchObject({ status: 403, body: { reason: 'protected-path' } });
      expect(fs.readFileSync(envFile, 'utf8')).toBe('OPENAI_API_KEY=sk-test\n');
      expect(fs.statSync(store).size).toBe(storeBefore);
      expect(fs.existsSync(path.join(outside, 'x.txt'))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(envFile, { force: true });
    }
  });

  test('a write inside a workspace Caduceus knows is T1: no passkey, no typed name, and the file is written', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-workspace-'));
    try {
      const { server: running, ...started } = await start({ fileRoots: [workspace], workspaceRoots: () => [fs.realpathSync(workspace)] });
      void running;
      // A second session holds no step-up, which a T3 write would need.
      const noGrant = await ownerCookie(started.url);
      const res = await fetch(`${started.url}/api/fs/write-text`, {
        method: 'POST',
        headers: { origin: started.url, cookie: noGrant, 'content-type': 'application/json' },
        body: JSON.stringify({ path: path.join(workspace, 'main.ts'), content: 'export {};\n' }),
      });

      expect(res.status).toBe(200);
      expect(fs.readFileSync(path.join(workspace, 'main.ts'), 'utf8')).toBe('export {};\n');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('the gateway hook, wired to the real server and Hermes', () => {
  const frame = (id: number, method: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => JSON.stringify({ jsonrpc: '2.0', id, method, params, ...extra });

  test('denies the slash commands Hermes’s own config makes shell commands, asks the owner’s real step-up, and follows read-only mode', async () => {
    const started = await start();
    const { server: running, call } = started;
    const sessions = (await call<{ sessions: SessionInfo[] }>('GET', '/_caduceus/api/auth/sessions')).body;
    const frames = running.gatewayPolicy.connect({ sessionId: sessions.sessions.find((s) => s.current)!.id, source: 'local' });
    await hermes.backend.fetch('/api/config/raw', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml_text: 'quick_commands:\n  deploy:\n    type: exec\n    command: echo deploying\n' }),
    });
    const verdict = async (text: string) => {
      const { forward, reply } = await frames.fromBrowser(text);
      return forward ? 'forwarded' : (JSON.parse(reply!).error.data.error + (JSON.parse(reply!).error.data.reason ? `:${JSON.parse(reply!).error.data.reason}` : ''));
    };

    const shell = await verdict(frame(1, 'shell.exec', { command: 'id' }));
    const deploy = await verdict(frame(2, 'command.dispatch', { name: 'deploy', session_id: 's' }));
    const retry = await verdict(frame(3, 'command.dispatch', { name: 'retry', session_id: 's' }));
    // The step-up of the real session (given in start()) is what the hook reads.
    const stop = await verdict(frame(4, 'process.stop'));
    await call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    const whileReadOnly = await verdict(frame(5, 'prompt.submit', { session_id: 's', text: 'hi' }));
    const readWhileReadOnly = await verdict(frame(6, 'session.list'));
    await hermes.backend.fetch('/api/config/raw', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yaml_text: 'quick_commands: {}\n' }) });

    expect([shell, deploy, retry, stop, whileReadOnly, readWhileReadOnly]).toEqual([
      'denied:shell-exec',
      'denied:exec-quick-command',
      'forwarded',
      'forwarded',
      'read-only',
      'forwarded',
    ]);
  });
});
