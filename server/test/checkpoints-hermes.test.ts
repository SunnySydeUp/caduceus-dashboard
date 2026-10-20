import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionCreateResult, SessionLiveInfo } from '@caduceus/contracts/hermes/gateway';
import type { GatewayEvent } from '@caduceus/contracts/hermes/shared/gateway';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { hermesPython } from './fixtures/seed-session.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';

// Workspace › Checkpoints (M7 #04) over the browser's gateway connection through Caduceus, in front of the real Hermes (stub LLM as its provider, so that a
// session's agent can be built). The checkpoints are taken the way Hermes takes them (its own `CheckpointManager`, in the temp HERMES_HOME), because an
// agent takes one only before it writes a file in a turn.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let page: TestGatewayConnection | undefined;
let work: string;
beforeAll(async () => {
  // Hermes's gateway takes checkpoints for its sessions only when this is set in its environment (`tui_gateway/server.py`); its `checkpoints.enabled` config is for the CLI.
  hermes = await launchTestHermes({ env: { HERMES_TUI_CHECKPOINTS: '1' } });
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
afterEach(async () => {
  page?.connection.close();
  page = undefined;
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

/** Takes `versions.length` checkpoints of `work` with Hermes's own manager, writing `a.txt` as each version says before the next one. */
function takeCheckpoints(versions: readonly string[]): void {
  const script = [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(hermes.install.dir)})`,
    'from tools.checkpoint_manager import CheckpointManager',
    'm = CheckpointManager(enabled=True)',
    `work = ${JSON.stringify(work)}`,
    `versions = ${JSON.stringify(versions)}`,
    'for index, text in enumerate(versions):',
    "    open(work + '/a.txt', 'w').write(text)",
    '    m.new_turn()',
    "    assert m.ensure_checkpoint(work, 'turn %d' % index)",
  ].join('\n');
  execFileSync(hermesPython(), ['-c', script], { env: { ...process.env, HERMES_HOME: hermes.home, HOME: hermes.fakeHome } });
}

async function openPage() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const url = server.url;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  page = openGatewayConnection(url, cookie);
  await page.until((status) => status.state === 'connected');
  const { client } = page.connection;
  const infos: GatewayEvent<'session.info'>[] = [];
  client.on('session.info', (event) => infos.push(event));

  /** A session on `cwd` once Hermes has built its agent (`session.create` answers with a lazy session; the first `session.info` with tools is the built one). */
  async function sessionOn(cwd: string): Promise<string> {
    const created = await client.request<SessionCreateResult>('session.create', { cwd });
    const { promise, resolve } = Promise.withResolvers<SessionLiveInfo>();
    const settle = () => {
      const built = infos.find((event) => event.session_id === created.session_id && Object.keys(event.payload?.tools ?? {}).length > 0);
      if (built?.payload) resolve(built.payload);
    };
    client.on('session.info', settle);
    settle();
    await promise;
    return created.session_id;
  }
  const confirmation = async (typed: string) => {
    const res = await fetch(`${url}/_caduceus/api/policy/confirmations`, { method: 'POST', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'rpc rollback.restore', target: typed, typed }) });
    return ((await res.json()) as { token: string }).token;
  };
  return { url, cookie, client, connection: page.connection, sessionOn, confirmation, stepUp: () => stepUp(url, cookie, authenticator) };
}

interface Checkpoints {
  enabled: boolean;
  checkpoints: { hash: string; timestamp: string; message: string }[];
}

describe('a workspace’s checkpoints', () => {
  test('are listed through a session opened on the workspace, newest first, and one can be compared with the files as they are now in Hermes’s plain unified diff', async () => {
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-checkpoints-')));
    takeCheckpoints(['one\n', 'two\n']);
    fs.writeFileSync(path.join(work, 'a.txt'), 'three\n');
    const { client, sessionOn, url, cookie } = await openPage();
    const sessionId = await sessionOn(work);

    const listed = await client.request<Checkpoints>('rollback.list', { session_id: sessionId });
    expect(listed.enabled).toBe(true);
    expect(listed.checkpoints).toHaveLength(2);
    expect(Date.parse(listed.checkpoints[0].timestamp)).not.toBeNaN();

    // The newest checkpoint holds 'two'; the files now hold 'three'.
    const diff = await client.request<{ stat: string; diff: string; rendered?: string }>('rollback.diff', { session_id: sessionId, hash: listed.checkpoints[0].hash });
    expect(diff.diff).toContain('-two');
    expect(diff.diff).toContain('+three');
    expect(diff.stat).toContain('a.txt');

    const total = (await (await fetch(`${url}/api/ops/checkpoints`, { headers: { cookie } })).json()) as { total_bytes: number };
    expect(total.total_bytes).toBeGreaterThan(0);
  }, HERMES_WORK_TIMEOUT_MS);
});

describe('restoring a checkpoint', () => {
  test('is a T3: refused without the passkey and the confirmation, and with them it puts the files back as they were', async () => {
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-checkpoints-')));
    takeCheckpoints(['one\n', 'two\n']);
    fs.writeFileSync(path.join(work, 'a.txt'), 'three\n');
    const { client, connection, sessionOn, confirmation, stepUp: grant } = await openPage();
    const sessionId = await sessionOn(work);
    const { checkpoints } = await client.request<Checkpoints>('rollback.list', { session_id: sessionId });
    const target = checkpoints[1].hash;
    const params = { session_id: sessionId, hash: target, file_path: 'a.txt' };

    await expect(client.request('rollback.restore', params)).rejects.toThrow(/passkey/i);
    await grant();
    await expect(client.request('rollback.restore', params)).rejects.toThrow(/type the name|confirm/i);
    expect(fs.readFileSync(path.join(work, 'a.txt'), 'utf8')).toBe('three\n');

    const restored = await connection.requestConfirmed<{ success: boolean }>('rollback.restore', params, await confirmation('a.txt'));
    expect(restored.success).toBe(true);
    expect(fs.readFileSync(path.join(work, 'a.txt'), 'utf8')).toBe('one\n');
  }, HERMES_WORK_TIMEOUT_MS);
});

describe('the confirmation of a gateway method', () => {
  test('cannot be minted for a method Caduceus does not know, and read-only mode stops a restore even with one', async () => {
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-checkpoints-')));
    takeCheckpoints(['one\n', 'two\n']);
    fs.writeFileSync(path.join(work, 'a.txt'), 'three\n');
    const { url, cookie, client, connection, sessionOn, confirmation, stepUp: grant } = await openPage();
    const sessionId = await sessionOn(work);
    const { checkpoints } = await client.request<Checkpoints>('rollback.list', { session_id: sessionId });
    await grant();

    const unknown = await fetch(`${url}/_caduceus/api/policy/confirmations`, { method: 'POST', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'rpc not.a.method', target: 'x', typed: 'x' }) });
    expect(unknown.status).toBe(400);

    const token = await confirmation('a.txt');
    await fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: true }) });
    await expect(connection.requestConfirmed('rollback.restore', { session_id: sessionId, hash: checkpoints[1].hash, file_path: 'a.txt' }, token)).rejects.toThrow(/read-only/i);
    expect(fs.readFileSync(path.join(work, 'a.txt'), 'utf8')).toBe('three\n');
    // Reading is still allowed.
    expect((await client.request<Checkpoints>('rollback.list', { session_id: sessionId })).checkpoints).toHaveLength(2);
  }, HERMES_WORK_TIMEOUT_MS);
});
