import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runCli } from '../src/service-cli.ts';
import { fakeSystem, startFakeService, FUNNEL_ONLY, HOST, UID, type FakeSystem } from './fixtures/fake-system.ts';
import { readPlist } from './fixtures/plist.ts';

const execFileAsync = promisify(execFile);

// The `caduceus` command (M0 #13), run in this process against a temp home and fake `launchctl`, `tailscale` and `hermes` that are
// the only programs on its PATH: nothing here can reach the real launchd or Tailscale. The planning logic is tested on its own in
// `service-plan.test.ts`; these tests are about what the command shows, what it asks, and what it does only when allowed.
let system: FakeSystem;
const services: { close(): Promise<void> }[] = [];
afterEach(async () => {
  system.cleanup();
  await Promise.all(services.splice(0).map((service) => service.close()));
});

/** The fake service answering the liveness probe, and the system it runs on. */
async function setUp(): Promise<{ port: number }> {
  system = fakeSystem();
  const service = await startFakeService();
  services.push(service);
  return { port: service.port };
}

const READ_ONLY = [`launchctl print gui/${UID}/dev.caduceus.dashboard`, 'tailscale serve status --json', 'tailscale status --json'];

describe('caduceus setup, planned', () => {
  test('without --yes it shows the whole plan, asks Tailscale and launchd only questions, and changes nothing', async () => {
    const { port } = await setUp();
    const { io, output } = system.io();

    const code = await runCli(['setup', '--port', String(port)], io);

    expect(code).toBe(0);
    expect(output()).toContain(`https://${HOST}:9443`);
    expect(output()).toContain('owner@example.com');
    expect(output()).toMatch(/1\. Create .*\.hermes\/caduceus \(owner only\)/);
    expect(output()).toMatch(/\[Tailscale\] Expose it on the tailnet only/);
    expect(output()).toContain(`tailscale serve --bg --https=9443 http://127.0.0.1:${port}`);
    expect(output()).toMatch(/Nothing was changed/);
    // Everything it asked of the machine was a question.
    expect(system.calls().every((call) => READ_ONLY.includes(call))).toBe(true);
    expect(system.mutations()).toEqual([]);
    expect(fs.existsSync(path.join(system.home, '.hermes'))).toBe(false);
    expect(fs.existsSync(path.join(system.home, 'Library'))).toBe(false);
  });
});

describe('caduceus setup, applied', () => {
  test('with --yes it does the local steps and waits for the service; Tailscale is left alone because nobody confirmed it', async () => {
    const { port } = await setUp();
    const { io, output } = system.io();

    const code = await runCli(['setup', '--yes', '--port', String(port)], io);

    const caduceusDir = path.join(system.home, '.hermes', 'caduceus');
    const plistFile = path.join(system.home, 'Library', 'LaunchAgents', 'dev.caduceus.dashboard.plist');
    const mode = (file: string) => fs.statSync(file).mode & 0o777;
    expect({ caduceusDir: mode(caduceusDir), logsDir: mode(path.join(caduceusDir, 'logs')), config: mode(path.join(caduceusDir, 'config.json')) }).toEqual({ caduceusDir: 0o700, logsDir: 0o700, config: 0o600 });
    expect(JSON.parse(fs.readFileSync(path.join(caduceusDir, 'config.json'), 'utf8'))).toEqual({
      port,
      publicOrigin: `https://${HOST}:9443`,
      rpId: HOST,
      tailnetOwners: ['owner@example.com'],
    });
    expect(readPlist(fs.readFileSync(plistFile, 'utf8'))).toMatchObject({ Label: 'dev.caduceus.dashboard', RunAtLoad: true, KeepAlive: true });
    expect(system.mutations()).toEqual([`launchctl bootstrap gui/${UID} ${plistFile}`]);
    expect(system.serve()).toEqual(FUNNEL_ONLY);
    expect(code).toBe(1);
    expect(output()).toContain('Certificate Transparency');
    expect(output()).toContain('Tailscale was not changed');
    expect(output()).toContain('--yes-tailscale');
  });
});

describe('the Tailscale confirmation', () => {
  test('at a terminal it asks at that moment: no leaves Tailscale alone; yes makes exactly that one change, the only step left, and the Funnel on 443 is untouched', async () => {
    const { port } = await setUp();
    const plistFile = path.join(system.home, 'Library', 'LaunchAgents', 'dev.caduceus.dashboard.plist');

    const declined = system.io({ input: 'n\n', interactive: true });
    const declinedCode = await runCli(['setup', '--yes', '--port', String(port)], declined.io);
    const afterNo = { calls: system.mutations(), serve: system.serve() };

    const accepted = system.io({ input: 'yes\n', interactive: true });
    const acceptedCode = await runCli(['setup', '--yes', '--port', String(port)], accepted.io);

    expect(declinedCode).toBe(1);
    expect(declined.output()).toContain('Change Tailscale Serve now? [y/N]');
    expect(declined.output()).toContain('Tailscale was not changed');
    expect(afterNo).toEqual({ calls: [`launchctl bootstrap gui/${UID} ${plistFile}`], serve: FUNNEL_ONLY });

    expect(acceptedCode).toBe(0);
    // Everything local is already in place, so what is left is to check the service is up, and then Serve.
    expect(accepted.output()).toMatch(/1\. Wait for Caduceus to answer on/);
    expect(accepted.output()).toMatch(/2\. \[Tailscale\] Expose it on the tailnet only/);
    expect(accepted.output()).not.toMatch(/3\. /);
    expect(accepted.output().indexOf('Certificate Transparency')).toBeLessThan(accepted.output().indexOf('Change Tailscale Serve now?'));
    expect(system.mutations()).toEqual([`launchctl bootstrap gui/${UID} ${plistFile}`, `tailscale serve --bg --https=9443 http://127.0.0.1:${port}`]);
    expect(system.serve()).toEqual({
      TCP: { ...FUNNEL_ONLY.TCP, '9443': { HTTPS: true } },
      Web: { ...FUNNEL_ONLY.Web, [`${HOST}:9443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } },
      AllowFunnel: FUNNEL_ONLY.AllowFunnel,
    });
  });
});

describe('running setup again', () => {
  test('does everything once, tells the owner what to do next, and a second run, even without any options, finds it all in place and changes nothing', async () => {
    const { port } = await setUp();

    const first = system.io();
    const firstCode = await runCli(['setup', '--yes', '--yes-tailscale', '--port', String(port)], first.io);
    const afterFirst = system.mutations();
    const second = system.io();
    const secondCode = await runCli(['setup', '--yes', '--yes-tailscale'], second.io);

    expect([firstCode, secondCode]).toEqual([0, 0]);
    expect(afterFirst).toHaveLength(2);
    expect(system.mutations()).toEqual(afterFirst);
    expect(first.output()).toContain(`On this Mac, open http://localhost:${port} and set the owner password`);
    expect(first.output()).toContain(`On your phone, open https://${HOST}:9443`);
    expect(second.output()).toContain('Nothing to do.');
    expect(second.output()).not.toContain('✓');
  });
});

describe('caduceus uninstall', () => {
  test('removes the service and its LaunchAgent, and Serve\'s entry only once the owner confirms it; keeps the data and the Funnel on 443', async () => {
    const { port } = await setUp();
    const plistFile = path.join(system.home, 'Library', 'LaunchAgents', 'dev.caduceus.dashboard.plist');
    const caduceusDir = path.join(system.home, '.hermes', 'caduceus');
    await runCli(['setup', '--yes', '--yes-tailscale', '--port', String(port)], system.io().io);
    const setUpCalls = system.mutations();

    const withoutTailscale = system.io();
    const firstCode = await runCli(['uninstall', '--yes'], withoutTailscale.io);
    const afterFirst = { loaded: system.loaded(), plist: fs.existsSync(plistFile), serve: system.serve() };
    const confirmed = system.io();
    const secondCode = await runCli(['uninstall', '--yes', '--yes-tailscale'], confirmed.io);

    expect(firstCode).toBe(1);
    expect(withoutTailscale.output()).toContain('Tailscale was not changed');
    expect(afterFirst).toMatchObject({ loaded: false, plist: false });
    expect(afterFirst.serve).toMatchObject({ Web: { [`${HOST}:9443`]: expect.anything() } });
    expect(secondCode).toBe(0);
    expect(confirmed.output()).toMatch(/1\. \[Tailscale\] Stop exposing Caduceus on the tailnet/);
    expect(confirmed.output()).not.toMatch(/2\. /);
    expect(system.mutations()).toEqual([...setUpCalls, `launchctl bootout gui/${UID}/dev.caduceus.dashboard`, 'tailscale serve --https=9443 off']);
    expect(system.serve()).toEqual(FUNNEL_ONLY);
    // The owner's data and settings are theirs to delete.
    expect(fs.existsSync(path.join(caduceusDir, 'config.json'))).toBe(true);
    expect(fs.statSync(path.join(caduceusDir, 'logs')).isDirectory()).toBe(true);
  });
});

describe('when setup must not go on', () => {
  test('something else on port 9443 stops it before anything changes, even with every confirmation given', async () => {
    const { port } = await setUp();
    const theirs = { Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } } };
    system.setServe({ ...FUNNEL_ONLY, TCP: { ...FUNNEL_ONLY.TCP, '9443': { HTTPS: true } }, Web: { ...FUNNEL_ONLY.Web, [`${HOST}:9443`]: theirs } });
    const { io, output } = system.io();

    const code = await runCli(['setup', '--yes', '--yes-tailscale', '--port', String(port)], io);

    expect(code).toBe(1);
    expect(output()).toContain('Cannot go on: Tailscale Serve already has something else on port 9443 (/ → http://127.0.0.1:8080)');
    expect(system.mutations()).toEqual([]);
    expect(fs.existsSync(path.join(system.home, '.hermes'))).toBe(false);
  });

  test('a service that never answers is not exposed: the owner is pointed at its log and Tailscale stays as it was', async () => {
    system = fakeSystem();
    const unused = await startFakeService();
    await unused.close();
    // The wait for a service to start listening is bounded by an option, so that this failure does not take a minute.
    const { io, output } = system.io({ healthTimeoutMs: 300 });

    const code = await runCli(['setup', '--yes', '--yes-tailscale', '--port', String(unused.port)], io);

    expect(code).toBe(1);
    expect(output()).toContain(`Caduceus did not answer at http://127.0.0.1:${unused.port}/_caduceus/healthz. The service's log is ${path.join(system.home, '.hermes', 'caduceus', 'logs', 'caduceus.log')}.`);
    expect(system.mutations().map((call) => call.split(' ').slice(0, 2).join(' '))).toEqual(['launchctl bootstrap']);
    expect(system.serve()).toEqual(FUNNEL_ONLY);
  });

  test('a command it does not understand is a usage error that changes nothing, and so is asking for a plan and for the work together', async () => {
    system = fakeSystem();
    const unknown = system.io();
    const contradiction = system.io();

    const codes = [await runCli(['frobnicate'], unknown.io), await runCli(['setup', '--yes', '--dry-run'], contradiction.io)];

    expect(codes).toEqual([2, 2]);
    expect(unknown.output()).toContain('Unknown command "frobnicate".');
    expect(unknown.output()).toContain('Usage: npm run caduceus');
    expect(contradiction.output()).toContain('--yes and --dry-run contradict each other.');
    expect(system.calls()).toEqual([]);
  });
});

describe('caduceus status', () => {
  test('says what is installed, running, answering and served, and exits 0 only when all of it is true; it changes nothing', async () => {
    const { port } = await setUp();
    const before = system.io();
    const beforeCode = await runCli(['status'], before.io);
    await runCli(['setup', '--yes', '--yes-tailscale', '--port', String(port)], system.io().io);
    const mutationsAfterSetup = system.mutations();

    const running = system.io();
    const runningCode = await runCli(['status'], running.io);

    expect(beforeCode).toBe(1);
    expect(before.output()).toContain('Caduceus is not set up');
    expect(runningCode).toBe(0);
    expect(running.output()).toContain('running (pid 4242)');
    expect(running.output()).toContain(`answering at http://127.0.0.1:${port}`);
    expect(running.output()).toContain(`https://${HOST}:9443 -> http://127.0.0.1:${port}`);
    expect(running.output()).toContain('Funnel      off for port 9443');
    expect(running.output()).toContain('Owners      owner@example.com');
    expect(running.output()).toContain('up to date');
    expect(system.mutations()).toEqual(mutationsAfterSetup);
  });

  test('fails, and says so, when the service does not answer, when Serve is missing, and when Funnel is on for Caduceus\'s port', async () => {
    const { port } = await setUp();
    await runCli(['setup', '--yes', '--yes-tailscale', '--port', String(port)], system.io().io);

    system.setServe({ ...FUNNEL_ONLY, AllowFunnel: { ...FUNNEL_ONLY.AllowFunnel, [`${HOST}:9443`]: true }, TCP: { ...FUNNEL_ONLY.TCP, '9443': { HTTPS: true } }, Web: { ...FUNNEL_ONLY.Web, [`${HOST}:9443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } } });
    const publicNow = system.io();
    const publicCode = await runCli(['status'], publicNow.io);
    system.setServe(FUNNEL_ONLY);
    const unserved = system.io();
    const unservedCode = await runCli(['status'], unserved.io);
    await services.splice(0)[0].close();
    const silent = system.io();
    const silentCode = await runCli(['status'], silent.io);

    expect([publicCode, unservedCode, silentCode]).toEqual([1, 1, 1]);
    expect(publicNow.output()).toContain('Funnel      ON for port 9443: Caduceus is PUBLIC');
    expect(unserved.output()).toContain(`Serve       not set up: nothing is served at https://${HOST}:9443`);
    expect(silent.output()).toContain('NOT answering at');
  });
});

describe('caduceus restart', () => {
  test('restarts the loaded service in place after an upgrade, never touching Tailscale; before setup there is nothing to restart', async () => {
    const { port } = await setUp();
    const before = system.io();
    const beforeCode = await runCli(['restart', '--yes', '--port', String(port)], before.io);
    await runCli(['setup', '--yes', '--yes-tailscale', '--port', String(port)], system.io().io);
    const setUpCalls = system.mutations();

    const restarted = system.io();
    const code = await runCli(['restart', '--yes'], restarted.io);

    expect(beforeCode).toBe(1);
    expect(before.output()).toContain('Caduceus is not loaded in launchd. Run `npm run caduceus -- setup` first.');
    expect(code).toBe(0);
    expect(system.mutations()).toEqual([...setUpCalls, `launchctl kickstart -k gui/${UID}/dev.caduceus.dashboard`]);
  });
});

describe('the command as `npm run caduceus` starts it', () => {
  test('runs the entry script as a process on the fake machine: the plan is shown, the exit code is the command\'s, nothing is changed', async () => {
    const { port } = await setUp();
    const entry = fileURLToPath(new URL('../scripts/caduceus.ts', import.meta.url));
    const tsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
    const start = (...args: string[]) => execFileAsync(process.execPath, [tsx, entry, ...args], { env: system.env, cwd: system.home }).catch((error: { code: number; stdout: string }) => ({ ...error, exitCode: error.code }));

    const planned = await start('setup', '--port', String(port));
    const status = await start('status');

    expect(planned).toMatchObject({ stdout: expect.stringContaining(`https://${HOST}:9443`) });
    expect(planned).not.toHaveProperty('exitCode');
    expect(status).toMatchObject({ exitCode: 1, stdout: expect.stringContaining('Caduceus is not set up') });
    expect(system.mutations()).toEqual([]);
    expect(fs.existsSync(path.join(system.home, '.hermes'))).toBe(false);
  });

  test('without Tailscale on the PATH, setup says so and changes nothing', async () => {
    const { port } = await setUp();
    const { io, output } = system.io({ withoutTailscale: true });

    const code = await runCli(['setup', '--yes', '--yes-tailscale', '--host', HOST, '--owner', 'owner@example.com', '--port', String(port)], io);

    expect(code).toBe(1);
    expect(output()).toContain('Cannot go on: Tailscale did not answer `tailscale serve status`. Is it installed and signed in?');
    expect(system.mutations()).toEqual([]);
    expect(fs.existsSync(path.join(system.home, 'Library'))).toBe(false);
  });
});
