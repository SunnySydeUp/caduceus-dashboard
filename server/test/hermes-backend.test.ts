import { afterEach, describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { FAKE_HERMES, fakeLaunch, fakeStateDir as newFakeStateDir, launchFakeHermes } from './fixtures/fake-hermes.ts';
import { launchHermesBackend } from '../src/hermes-backend.ts';

const LAUNCHER_HOST = fileURLToPath(new URL('./fixtures/launcher-host.ts', import.meta.url));

let backend: HermesBackend | undefined;
const tempDirs: string[] = [];
/** A fake-Hermes state dir that is removed after the test. */
function fakeStateDir(): string {
  const dir = newFakeStateDir();
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await backend?.stop();
  backend = undefined;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Hermes backend launcher: running the command line', () => {
  /** A `hermes` that serves like the fake and, for anything else, says what it was called with: the environment, one line per argument, and its standard input. */
  function standIn(): string {
    const dir = fakeStateDir();
    const file = `${dir}/hermes`;
    fs.writeFileSync(file, `#!/bin/sh\nif [ "$1" = serve ]; then exec "${process.execPath}" "${FAKE_HERMES}" "$@"; fi\nif [ "$1" = slow ]; then echo first; while [ ! -f "$2" ]; do sleep 0.05; done; echo second; exit 0; fi\nprintf 'env=%s\\n' "$MARKER"\nfor a in "$@"; do printf 'arg=%s\\n' "$a"; done\nprintf 'stdin=%s\\n' "$(cat)"\nif [ "$1" = fail ]; then echo 'no such task' >&2; exit 3; fi\nif [ "$1" = hang ]; then sleep 30; fi\n`, { mode: 0o755 });
    return file;
  }

  test('runs with the backend’s own environment, gives every argument as one value without a shell, and passes standard input', async () => {
    backend = launchHermesBackend({ command: standIn(), env: { MARKER: 'from-the-backend' } });
    await backend.ready();

    const result = await backend.runCli(['kanban', '--title', '$(echo pwned) "x" ; y', '--', '-flag'], { input: 'line one\nline two' });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('env=from-the-backend\narg=kanban\narg=--title\narg=$(echo pwned) "x" ; y\narg=--\narg=-flag\nstdin=line one\nline two\n');
  });

  test('lets the caller hear what a command prints while it is still running, and runs it with the extra environment it is given', async () => {
    const stand = standIn();
    const release = `${fakeStateDir()}/release`;
    backend = launchHermesBackend({ command: stand, env: { MARKER: 'from-the-backend' } });
    await backend.ready();

    const heard: string[] = [];
    const first = Promise.withResolvers<void>();
    const running = backend.runCli(['slow', release], {
      onOutput(text) {
        heard.push(text);
        if (heard.join('').includes('first')) first.resolve();
      },
    });
    let ended = false;
    void running.then(() => (ended = true));
    await first.promise;
    // The command is held at the file: what was heard came from a command that has not finished.
    expect(ended).toBe(false);
    fs.writeFileSync(release, '');
    const result = await running;

    expect(result.code).toBe(0);
    expect(heard.join('')).toBe('first\nsecond\n');
    expect((await backend.runCli(['env-check'], { env: { MARKER: 'from-the-caller' } })).stdout).toContain('env=from-the-caller');
  });

  test('a command that fails is a result with its code and what it said, and one that runs too long is a rejection', async () => {
    backend = launchHermesBackend({ command: standIn() });
    await backend.ready();

    expect(await backend.runCli(['fail'])).toMatchObject({ code: 3, stderr: 'no such task\n' });
    await expect(backend.runCli(['hang'], { timeoutMs: 300 })).rejects.toThrow();
  });
});

describe('Hermes backend launcher', () => {
  test('becomes ready once the backend announces its port, and its requests carry the launch secret', async () => {
    backend = launchFakeHermes();

    await backend.ready();
    const res = await backend.fetch('/api/profiles');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profiles: [{ name: 'default' }, { name: 'coder' }, { name: 'librarian' }] });
  });

  test('keeps serving after Hermes writes more log output than a pipe can hold', async () => {
    backend = launchFakeHermes();
    await backend.ready();

    // A stalled pipe gives no event to await, so a bounded abort turns a hang into a failure.
    const flood = await backend.fetch('/api/__fake/log-flood', { signal: AbortSignal.timeout(5_000) });
    const after = await backend.fetch('/api/profiles', { signal: AbortSignal.timeout(5_000) });

    expect([flood.status, after.status]).toEqual([200, 200]);
  });

  test('restarts the backend after it dies, with a fresh secret, and requests work again', async () => {
    const dir = fakeStateDir();
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir }, restartDelaysMs: [10] });
    await backend.ready();
    const first = fakeLaunch(dir, 1);

    const restarted = once(backend, 'ready');
    process.kill(first.pid, 'SIGKILL');
    await restarted;
    const res = await backend.fetch('/api/profiles');

    expect(res.status).toBe(200);
    expect(fakeLaunch(dir, 2).token).not.toBe(first.token);
  });

  test('keeps the time of every stop it did not ask for', async () => {
    const dir = fakeStateDir();
    const clock = { now: 1_000 };
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir }, restartDelaysMs: [10], now: () => clock.now });
    await backend.ready();
    const crash = async (launch: number) => {
      const back = once(backend!, 'ready');
      process.kill(fakeLaunch(dir, launch).pid, 'SIGKILL');
      await back;
    };

    const untouched = [...backend.restarts];
    await crash(1);
    clock.now = 5_000;
    await crash(2);

    expect([untouched, backend.restarts]).toEqual([[], [1_000, 5_000]]);
  });

  test('restarts on request: a fresh Hermes with a fresh secret, the old one gone, and not counted as a stop it did not ask for', async () => {
    const dir = fakeStateDir();
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir }, restartDelaysMs: [10] });
    await backend.ready();
    // A crash first, so there is a stop on record for the restart to be told apart from.
    const crashed = once(backend, 'ready');
    process.kill(fakeLaunch(dir, 1).pid, 'SIGKILL');
    await crashed;
    expect(backend.restarts).toHaveLength(1);
    const first = fakeLaunch(dir, 2);
    const states: string[] = [];
    backend.on('status', (status) => states.push(status.state));

    await backend.restart();
    const res = await backend.fetch('/api/profiles');

    expect(res.status).toBe(200);
    expect(fakeLaunch(dir, 3).token).not.toBe(first.token);
    // `restarting` is what a crash looks like; a restart that was asked for starts afresh, with no backoff to wait out...
    expect(states).toEqual(['starting', 'ready']);
    // ...and with the stops before it forgotten: that Hermes is gone, and this one has not stopped yet.
    expect(backend.restarts).toEqual([]);
    expect(() => process.kill(first.pid, 0)).toThrow();
  });

  test('restarting on request does not wait out the backoff of a Hermes that keeps crashing', async () => {
    const dir = fakeStateDir();
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir }, restartDelaysMs: [60_000] });
    await backend.ready();
    const { promise: waiting, resolve } = Promise.withResolvers<void>();
    backend.on('status', (status) => status.state === 'restarting' && resolve());
    process.kill(fakeLaunch(dir, 1).pid, 'SIGKILL');
    await waiting;

    await backend.restart();

    expect(backend.status).toEqual({ state: 'ready' });
    expect(fakeLaunch(dir, 2).pid).not.toBe(fakeLaunch(dir, 1).pid);
  });

  test.each([
    ['before announcing ready', { FAKE_HERMES_EXIT_BEFORE_READY: '1' }],
    ['right after announcing ready', { FAKE_HERMES_EXIT_AFTER_READY: '1' }],
  ])('reports restarting and keeps backing off while Hermes crashes %s', async (_when, env) => {
    backend = launchFakeHermes({ env, restartDelaysMs: [10, 20, 40] });
    const retries: number[] = [];
    const { promise: fourRetries, resolve } = Promise.withResolvers<void>();
    backend.on('status', (status) => {
      if (status.state !== 'restarting') return;
      retries.push(status.retryInMs);
      if (retries.length === 4) resolve();
    });

    await fourRetries;

    expect(retries).toEqual([10, 20, 40, 40]);
  });

  test('never outlives the process that launched it, even if that process is killed outright', async () => {
    const dir = fakeStateDir();
    // Run the host directly under Node (native type stripping): a wrapper like tsx would make it a
    // grandchild, and killing the wrapper would leave the real owner alive.
    const host = spawn(process.execPath, [LAUNCHER_HOST, FAKE_HERMES, dir], { stdio: ['ignore', 'pipe', 'inherit'] });
    for await (const line of createInterface({ input: host.stdout! })) if (line === 'HOST_READY') break;
    const { pid } = fakeLaunch(dir, 1);

    host.kill('SIGKILL');
    await once(host, 'exit');

    // An unrelated process's exit can't be awaited from outside its tree, so poll the OS (bounded, 5 s).
    let alive = true;
    for (let i = 0; i < 100 && alive; i++) {
      try {
        process.kill(pid, 0);
        await sleep(50);
      } catch {
        alive = false;
      }
    }
    if (alive) process.kill(pid, 'SIGKILL');
    expect(alive).toBe(false);
  });

  test('turns on the gateway’s checkpoints for the Hermes it runs, unless the environment it was started with says otherwise', async () => {
    const script = `${fakeStateDir()}/hermes`;
    fs.writeFileSync(script, '#!/bin/sh\nprintf "cp=%s" "$HERMES_TUI_CHECKPOINTS"\n', { mode: 0o755 });
    backend = launchHermesBackend({ command: script });
    expect((await backend.runCli(['x'])).stdout).toBe('cp=1');
    expect((await backend.runCli(['x'], { env: { HERMES_TUI_CHECKPOINTS: '0' } })).stdout).toBe('cp=0');
  });

  test('keeps the Hermes it runs out of the host’s rendezvous, so it neither joins nor takes the place of the owner’s own Hermes server', async () => {
    // Hermes 0.22 allows one `hermes serve` per host (a second attaches to it or is refused) and records the first in a directory shared by
    // the operating-system user. Caduceus's is a private one, so it starts beside the owner's own, and the owner's is never replaced by it.
    const script = `${fakeStateDir()}/hermes`;
    fs.writeFileSync(script, '#!/bin/sh\nprintf "%s" "$HERMES_GATEWAY_LOCK_DIR"\n', { mode: 0o755 });
    const home = path.join(fakeStateDir(), 'home');
    backend = launchHermesBackend({ command: script, env: { HERMES_HOME: home } });
    expect((await backend.runCli(['x'])).stdout).toBe(path.join(home, 'caduceus', 'host-state'));
    expect((await backend.runCli(['x'], { env: { HERMES_GATEWAY_LOCK_DIR: '/elsewhere' } })).stdout).toBe('/elsewhere');
  });

  test('still shows the Hermes it runs the owner’s gateway, which is what tells a profile it is served: only the gateway’s record and lock are shared, never the server’s', async () => {
    // Hermes answers "is this profile's gateway running?" from the host's gateway record (a profile served by the one multiplexing gateway has
    // no files of its own), and that record lives in the directory that Caduceus's Hermes has to keep private (see above).
    const script = `${fakeStateDir()}/hermes`;
    fs.writeFileSync(script, '#!/bin/sh\nprintf "%s" "$HERMES_GATEWAY_LOCK_DIR"\n', { mode: 0o755 });
    const home = path.join(fakeStateDir(), 'home');
    const shared = path.join(fakeStateDir(), 'shared');
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, 'host-serve.json'), '{"role":"serve"}');
    fs.writeFileSync(path.join(shared, 'host-serve.lock'), '');
    backend = launchHermesBackend({ command: script, env: { HERMES_HOME: home }, sharedHostState: shared });
    const privateDir = (await backend.runCli(['x'])).stdout;

    expect(privateDir).toBe(path.join(home, 'caduceus', 'host-state'));
    // The owner's server is not in it...
    expect(fs.existsSync(path.join(privateDir, 'host-serve.json'))).toBe(false);
    expect(fs.existsSync(path.join(privateDir, 'host-serve.lock'))).toBe(false);
    // ...and a gateway that starts later is: the record and the lock are read where the gateway writes them.
    fs.writeFileSync(path.join(shared, 'host-gateway.json'), '{"role":"gateway"}');
    fs.writeFileSync(path.join(shared, 'host-gateway.lock'), '');
    expect(fs.readFileSync(path.join(privateDir, 'host-gateway.json'), 'utf8')).toBe('{"role":"gateway"}');
    expect(fs.existsSync(path.join(privateDir, 'host-gateway.lock'))).toBe(true);
    // Launching again leaves them as they are.
    await backend.runCli(['x']);
    expect(fs.readFileSync(path.join(privateDir, 'host-gateway.json'), 'utf8')).toBe('{"role":"gateway"}');
  });
});
