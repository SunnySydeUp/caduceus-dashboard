import { afterEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { connectBrowserSocket, upgradeStatus, type BrowserSocket } from './fixtures/browser-socket.ts';
import { launchFakeHermes } from './fixtures/fake-hermes.ts';
import { graceClock } from './fixtures/grace-clock.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The terminal shell (M7 #05) at the Caduceus WebSocket seam: a real shell in a real PTY, run by the Caduceus server itself, in
// temp directories. It has no Hermes interface, so Hermes is the stand-in the server needs to start at all.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
const temps: string[] = [];
const sockets: BrowserSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server?.close();
  await backend?.stop();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  server = undefined;
  backend = undefined;
});

function tempDir(name: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `caduceus-${name}-`)));
  temps.push(dir);
  return dir;
}

const TERMINAL = '/_caduceus/api/terminal';

async function start(options: Partial<CaduceusServerOptions> = {}) {
  backend = launchFakeHermes();
  const root = tempDir('terminal-root');
  const work = tempDir('terminal-work');
  server = await startCaduceusServer({ backend, hermesRoot: root, fileRoots: [work], terminal: { shell: '/bin/sh', args: [], env: { PATH: process.env.PATH, PS1: '' } }, ...options });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  const asOwner = { cookie, origin: url };
  const setReadOnly = (readOnly: boolean) =>
    fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { ...asOwner, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly }) });
  const audit = async (): Promise<AuditEntry[]> => {
    const body: { entries: AuditEntry[] } = await (await fetch(`${url}/_caduceus/api/audit`, { headers: { cookie } })).json();
    return body.entries;
  };
  /** Opens the shell of `cwd` (the work folder by default) as a viewer that holds a step-up grant. */
  let granted: Promise<void> | undefined;
  const view = async (cwd = work, { cookie: as = cookie, query = '' }: { cookie?: string; query?: string } = {}) => {
    granted ??= addPasskey(url, cookie).then((authenticator) => stepUp(url, cookie, authenticator));
    await granted;
    const socket = await connectBrowserSocket(url, { cookie: as, path: `${TERMINAL}?cwd=${encodeURIComponent(cwd)}${query}` });
    sockets.push(socket);
    return socket;
  };
  return { url, cookie, asOwner, work, setReadOnly, audit, view };
}

/** Everything a viewer has been shown so far, as the shell printed it. */
function printed(socket: BrowserSocket): string {
  return socket.frames.map((frame) => (frame.type === 'output' ? String(frame.data) : '')).join('');
}

/** Resolves once a viewer has been shown `text`. */
function sees(socket: BrowserSocket, text: string): Promise<unknown> {
  return socket.waitFor(() => printed(socket).includes(text));
}

const type = (socket: BrowserSocket, text: string) => socket.send({ type: 'input', data: text });

describe('the terminal shell', () => {
  test('is refused without a step-up grant, on the upgrade itself, and in read-only mode', async () => {
    const { url, cookie, asOwner, setReadOnly, work } = await start();
    const route = `${TERMINAL}?cwd=${encodeURIComponent(work)}`;

    const withoutGrant = await upgradeStatus(url, asOwner, route);
    await stepUp(url, cookie, await addPasskey(url, cookie));
    const withGrant = await upgradeStatus(url, asOwner, route);
    await setReadOnly(true);
    const readOnly = await upgradeStatus(url, asOwner, route);

    expect({ withoutGrant, withGrant, readOnly }).toEqual({ withoutGrant: 403, withGrant: 101, readOnly: 403 });
  });

  test('starts a real shell in the folder it was asked for, which the viewer types into and reads from', async () => {
    const { view, work } = await start();
    const socket = await view();

    const attached = await socket.waitFor((frame) => frame.type === 'attached');
    type(socket, 'pwd; echo $((6*7))\n');
    await sees(socket, '42');

    expect(attached).toEqual({ type: 'attached', cwd: work, running: true, cols: 80, rows: 24 });
    expect(printed(socket)).toContain(work);
  });

  test('every viewer of a folder watches the same shell, and one that arrives later is shown what was printed before', async () => {
    const { view } = await start();
    const first = await view();
    const second = await view();

    type(first, 'GREETING=hello-from-the-first; echo $GREETING\n');
    await sees(second, 'hello-from-the-first');
    type(second, 'echo \"${GREETING}-again\"\n');
    await sees(first, 'hello-from-the-first-again');
    const third = await view();
    await sees(third, 'hello-from-the-first-again');

    expect(printed(third)).toContain('hello-from-the-first');
  });

  test('follows the size of the viewer\'s window', async () => {
    const { view } = await start();
    const socket = await view();

    socket.send({ type: 'resize', cols: 100, rows: 30 });
    // The shell learns the size from the PTY, so asking it is the way to see that the resize arrived.
    type(socket, 'stty size\n');
    await sees(socket, '30 100');
    const another = await view();

    expect(await another.waitFor((frame) => frame.type === 'attached')).toMatchObject({ cols: 100, rows: 30 });
  });

  test('survives a dropped connection and is found again with its state; with nobody watching it ends after the grace period', async () => {
    const clock = graceClock();
    const { view, audit, work } = await start({ terminal: { shell: '/bin/sh', args: [], env: { PATH: process.env.PATH, PS1: '' }, graceMs: 1111, idleMs: 2222, timers: clock.timers } });
    /** The next time the shell starts counting the grace period (it counts the idle period at every keystroke too). */
    const nextGrace = async () => {
      for (;;) {
        const timer = await clock.nextStart();
        if (timer.ms === 1111) return timer;
      }
    };
    const before = await view();
    type(before, 'KEPT=still-here; echo set-up-$((1+1))\n');
    await sees(before, 'set-up-2');
    before.close();
    await before.closed;
    const grace = await nextGrace();

    const after = await view();
    type(after, 'echo \"kept=${KEPT}\"\n');
    await sees(after, 'kept=still-here');
    after.close();
    await after.closed;
    const secondGrace = await nextGrace();
    // The first grace was cancelled when the viewer came back; the second one runs out.
    secondGrace.fire();
    grace.fire();
    const afterGrace = await view();

    expect({ firstGraceMs: grace.ms, firstCancelled: grace.cancelled, secondGraceMs: secondGrace.ms }).toEqual({ firstGraceMs: 1111, firstCancelled: true, secondGraceMs: 1111 });
    // A new shell: the old one's variable is gone, and the end of the first one is in the audit log.
    type(afterGrace, 'echo \"kept=${KEPT:-gone}\"\n');
    await sees(afterGrace, 'kept=gone');
    expect((await audit()).filter((entry) => entry.action.startsWith('terminal.')).map(({ action, target }) => ({ action, target }))).toEqual([
      { action: 'terminal.start', target: work },
      { action: 'terminal.end', target: `${work} (nobody watched it)` },
      { action: 'terminal.start', target: work },
    ].reverse());
  });

  test('ends after the idle period with nothing typed, watched or not, and says so; typing starts the clock again', async () => {
    const clock = graceClock();
    const { view } = await start({ terminal: { shell: '/bin/sh', args: [], env: { PATH: process.env.PATH, PS1: '' }, graceMs: 1111, idleMs: 2222, timers: clock.timers } });
    const socket = await view();
    const first = await clock.nextStart();

    type(socket, 'echo typed\n');
    const second = await clock.nextStart();
    first.fire();
    second.fire();
    const ended = await socket.waitFor((frame) => frame.type === 'ended');

    expect({ firstMs: first.ms, firstCancelled: first.cancelled, secondMs: second.ms, ended }).toEqual({ firstMs: 2222, firstCancelled: true, secondMs: 2222, ended: { type: 'ended', reason: 'idle' } });
  });

  test('tells the viewer when the owner leaves the shell, and Restart starts a new one in the same place for every viewer', async () => {
    const { url, asOwner, view, work } = await start();
    const first = await view();
    const second = await view();
    type(first, 'echo set-up-$((1+1))\n');
    await sees(first, 'set-up-2');
    const restart = (cwd: string) => fetch(`${url}/_caduceus/api/terminal/restart`, { method: 'POST', headers: { ...asOwner, 'content-type': 'application/json' }, body: JSON.stringify({ cwd }) });
    type(first, 'LEFT=behind; exit 3\n');
    const ended = await second.waitFor((frame) => frame.type === 'ended');

    const missing = await restart(path.join(work, 'no-such-folder'));
    const restarted = await restart(work);
    await second.waitFor((frame) => frame.type === 'restarted');
    type(second, 'echo \"left=${LEFT:-nothing}\"\n');
    await sees(first, 'left=nothing');

    expect({ ended, missing: missing.status, restarted: restarted.status }).toEqual({ ended: { type: 'ended', reason: 'exited', code: 3 }, missing: 404, restarted: 200 });
  });

  test('starts only in a folder inside the folders Caduceus works in: not outside them, through a link out of them, or on a file', async () => {
    const { url, asOwner, view, work } = await start();
    await view();
    const outside = tempDir('terminal-outside');
    fs.symlinkSync(outside, path.join(work, 'way-out'));
    fs.writeFileSync(path.join(work, 'notes.txt'), 'a file');
    const statusFor = (cwd: string) => upgradeStatus(url, asOwner, `${TERMINAL}?cwd=${encodeURIComponent(cwd)}`);

    const statuses = {
      outside: await statusFor(outside),
      link: await statusFor(path.join(work, 'way-out')),
      file: await statusFor(path.join(work, 'notes.txt')),
      missing: await statusFor(path.join(work, 'nothing-here')),
      relative: await statusFor('../etc'),
      inside: await statusFor(work),
    };

    expect(statuses).toEqual({ outside: 403, link: 403, file: 404, missing: 404, relative: 400, inside: 101 });
  });

  test('is killed when Caduceus stops, and the shell does not inherit Caduceus\'s own settings', async () => {
    const env = { PATH: process.env.PATH, PS1: '', CADUCEUS_CONFIG: '/should/not/leak', KEEP_ME: 'kept' };
    const { view } = await start({ terminal: { shell: '/bin/sh', args: [], env } });
    const socket = await view();
    type(socket, 'echo pid=$$ config=${CADUCEUS_CONFIG:-unset} keep=$KEEP_ME term=$TERM\n');
    await sees(socket, 'keep=kept');
    const pid = Number(/pid=(\d+)/.exec(printed(socket))?.[1]);
    expect(Number.isInteger(pid)).toBe(true);

    await server!.close();
    server = undefined;
    const closed = await socket.closed;
    // The process is a different one, so the operating system is the only one that can say it is gone: a bounded poll of its own table.
    const gone = await vi.waitFor(() => {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
      throw new Error('the shell is still running');
    });

    expect(printed(socket)).toContain('config=unset keep=kept term=xterm-256color');
    expect({ closed, gone }).toEqual({ closed: { code: 1001, reason: 'Caduceus is stopping.' }, gone: true });
  });

  test('audits start, end and restart with the folder, the device and the profile, and never what was typed', async () => {
    const { url, asOwner, view, audit, work } = await start();
    const socket = await view(work, { query: '&profile=Research' });
    type(socket, 'echo SECRET_KEYSTROKES\n');
    await sees(socket, 'SECRET_KEYSTROKES');
    await fetch(`${url}/_caduceus/api/terminal/restart`, { method: 'POST', headers: { ...asOwner, 'content-type': 'application/json' }, body: JSON.stringify({ cwd: work }) });
    type(socket, 'exit\n');
    await socket.waitFor((frame) => frame.type === 'ended');

    const entries = (await audit()).filter((entry) => entry.action.startsWith('terminal.'));

    expect(entries.map(({ actor, action, target, source, tier, profile }) => ({ actor, action, target, source, tier, profile }))).toEqual([
      { actor: 'owner', action: 'terminal.end', target: `${work} (exited)`, source: 'local', tier: 'T2', profile: 'research' },
      { actor: 'owner', action: 'terminal.restart', target: work, source: 'local', tier: 'T1', profile: 'research' },
      { actor: 'owner', action: 'terminal.start', target: work, source: 'local', tier: 'T2', profile: 'research' },
    ]);
    expect(JSON.stringify(await audit())).not.toContain('SECRET_KEYSTROKES');
  });

  test('Restart is closed in read-only mode', async () => {
    const { url, asOwner, view, work, setReadOnly } = await start();
    await view();
    await setReadOnly(true);

    const res = await fetch(`${url}/_caduceus/api/terminal/restart`, { method: 'POST', headers: { ...asOwner, 'content-type': 'application/json' }, body: JSON.stringify({ cwd: work }) });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'read-only' });
  });
});
