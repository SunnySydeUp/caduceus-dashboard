import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { connectBrowserSocket } from './fixtures/browser-socket.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

// Hermes's restricted console (`hermes>`, M5 #13) through Caduceus, in front of the real Hermes in a throwaway HERMES_HOME. The console is Hermes's own engine:
// what it refuses is what it says (it runs no shell); what Caduceus adds is the passkey to open it, the frames it lets through and the audit.
async function start({ steppedUp = true }: { steppedUp?: boolean } = {}) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  const audit = async () => ((await (await fetch(`${url}/_caduceus/api/audit`, { headers: { origin: url, cookie } })).json()) as { entries: { action: string; target: string; tier?: string }[] }).entries;
  return { url, cookie, audit, open: () => connectBrowserSocket(url, { cookie, path: '/api/console' }) };
}

describe('opening the console', () => {
  test('needs a fresh passkey confirmation (T2): without one the upgrade is refused', async () => {
    const { open } = await start({ steppedUp: false });

    await expect(open()).rejects.toThrow('refused');
  });

  test('is refused in read-only mode, passkey or not', async () => {
    const { url, cookie, open } = await start();
    await fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: true }) });

    await expect(open()).rejects.toThrow('refused');
  });
});

describe('the console session', () => {
  test('says it is ready with Hermes’s prompt, refuses what is outside Hermes’s own set of commands, and answers the ones inside it', async () => {
    const { open } = await start();
    const console_ = await open();

    expect(await console_.waitFor((frame) => frame.type === 'ready')).toMatchObject({ prompt: 'hermes> ' });
    console_.send({ type: 'command', line: 'rm -rf /' });
    expect(await console_.waitFor((frame) => frame.type === 'error')).toMatchObject({ message: 'Unsupported Hermes Console command: rm -rf.', command: 'rm -rf /' });
    expect(await console_.waitFor((frame) => frame.type === 'complete' && frame.status === 'error')).toMatchObject({ command: 'rm -rf /' });
    console_.send({ type: 'command', line: 'status' });
    expect((await console_.waitFor((frame) => frame.type === 'output' && frame.command === 'status')).data).toContain('Hermes Agent Status');
    console_.close();
  });

  test('only the frames the console defines go through: any other is answered by Caduceus and never reaches Hermes', async () => {
    const { open } = await start();
    const console_ = await open();
    await console_.waitFor((frame) => frame.type === 'ready');

    console_.send({ type: 'resize', cols: 80 });

    expect(await console_.waitFor((frame) => frame.type === 'error')).toEqual({ type: 'error', message: 'Unsupported console frame: resize' });
    console_.close();
  });

  test('a frame larger than a console line may be closes the connection', async () => {
    const { open } = await start();
    const console_ = await open();
    await console_.waitFor((frame) => frame.type === 'ready');

    console_.send({ type: 'command', line: 'x'.repeat(9 * 1024) });

    expect((await console_.closed).code).toBe(1009);
  });

  test('is audited: the session opening, each command and the session ending, as T2 of the owner', async () => {
    const { open, audit } = await start();
    const console_ = await open();
    await console_.waitFor((frame) => frame.type === 'ready');
    console_.send({ type: 'command', line: 'status' });
    await console_.waitFor((frame) => frame.type === 'complete' && frame.command === 'status');
    console_.close();

    // The ending is written when the server sees the socket close: a bounded poll, since the close travels through the network stack.
    await expect.poll(async () => (await audit()).map((entry) => entry.action), { timeout: 5000 }).toContain('console.close');
    const entries = (await audit()).filter((entry) => entry.action.startsWith('console.'));
    expect(entries.map((entry) => [entry.action, entry.target])).toEqual([
      ['console.close', 'current'],
      ['console.command', 'status'],
      ['console.open', 'current'],
    ]);
    expect(entries.every((entry) => entry.tier === 'T2')).toBe(true);
  });
});
