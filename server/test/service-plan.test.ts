import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectServe, parseLaunchctlPrint, parseTailscaleStatus, planRestart, planSetup, planUninstall, renderLaunchAgent, resolveConfig, type Observed, type Plan, type ServiceSpec } from '../src/service-plan.ts';
import { readPlist } from './fixtures/plist.ts';

// The setup command's planning (M0 #13), as a pure module: what the service is, what each command would change given what is
// already there, and that running setup again changes nothing. Nothing here touches the system.
const HOST = 'my-mac.tail0000aa.ts.net';
const SPEC: ServiceSpec = {
  uid: 501,
  home: '/Users/tester',
  hermesRoot: '/Users/tester/.hermes',
  projectRoot: '/Users/tester/hermes-dashboard',
  nodePath: '/Users/tester/.local/bin/node',
  hermesCommand: '/Users/tester/.local/bin/hermes',
  path: '/Users/tester/.local/bin:/usr/local/bin:/usr/bin:/bin',
  config: { port: 9130, publicOrigin: `https://${HOST}:9443`, rpId: HOST, tailnetOwners: ['owner@example.com'] },
};

describe('the LaunchAgent', () => {
  test('starts the production server at login and whenever it stops, from the project, owner-only and logging under the Caduceus directory', () => {
    expect(readPlist(renderLaunchAgent(SPEC))).toEqual({
      Label: 'dev.caduceus.dashboard',
      // One process: tsx as a loader of node itself, so that launchd's process is the server (through tsx's own command, the
      // server would be a child that outlives it when it is killed, and keeps the port).
      ProgramArguments: ['/Users/tester/.local/bin/node', '--import', '/Users/tester/hermes-dashboard/node_modules/tsx/dist/loader.mjs', '/Users/tester/hermes-dashboard/server/src/main.ts'],
      WorkingDirectory: '/Users/tester/hermes-dashboard',
      EnvironmentVariables: {
        PATH: '/Users/tester/.local/bin:/usr/local/bin:/usr/bin:/bin',
        CADUCEUS_CONFIG: '/Users/tester/.hermes/caduceus/config.json',
        CADUCEUS_HERMES_COMMAND: '/Users/tester/.local/bin/hermes',
      },
      RunAtLoad: true,
      KeepAlive: true,
      // 0o077: what the service writes (logs, and the store's files) is the owner's alone.
      Umask: 63,
      StandardOutPath: '/Users/tester/.hermes/caduceus/logs/caduceus.log',
      StandardErrorPath: '/Users/tester/.hermes/caduceus/logs/caduceus.log',
    });
  });

  test('keeps paths with markup characters intact, passes on a custom HERMES_HOME, and is a property list macOS accepts', () => {
    const spec = { ...SPEC, projectRoot: '/Users/tester/R&D <dash>/hermes-dashboard', hermesHome: '/Volumes/Data & Co/hermes' };

    const plist = renderLaunchAgent(spec);
    // The shape is known (the plist above is what this test asked for); the reader types it as any plist value.
    const read = readPlist(plist) as { WorkingDirectory: string; ProgramArguments: string[]; EnvironmentVariables: Record<string, string> };

    expect(read.WorkingDirectory).toBe('/Users/tester/R&D <dash>/hermes-dashboard');
    expect(read.ProgramArguments[3]).toBe('/Users/tester/R&D <dash>/hermes-dashboard/server/src/main.ts');
    expect(read.EnvironmentVariables.HERMES_HOME).toBe('/Volumes/Data & Co/hermes');
    // `plutil -lint` is macOS's own judge of a property list; it reads the file and changes nothing.
    if (process.platform === 'darwin') {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-plist-'));
      try {
        fs.writeFileSync(path.join(dir, 'agent.plist'), plist);
        expect(execFileSync('plutil', ['-lint', path.join(dir, 'agent.plist')], { encoding: 'utf8' })).toContain('OK');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

// `tailscale serve status --json`, as Tailscale 1.102 prints it. This node's Funnel on :443 is the one that was there before Caduceus.
const FUNNEL_443 = {
  TCP: { '443': { HTTPS: true } },
  Web: { [`${HOST}:443`]: { Handlers: { '/': { Proxy: 'http://localhost:2283' } } } },
  AllowFunnel: { [`${HOST}:443`]: true },
};
const withCaduceus = (proxy: string, extra: object = {}) => ({
  ...FUNNEL_443,
  TCP: { ...FUNNEL_443.TCP, '9443': { HTTPS: true } },
  Web: { ...FUNNEL_443.Web, [`${HOST}:9443`]: { Handlers: { '/': { Proxy: proxy }, ...extra } } },
});

describe('inspecting Tailscale Serve', () => {
  test('tells an empty port, Caduceus\'s own entry (however Tailscale spells the loopback target), and anything else, and sees Funnel on the port', () => {
    const inspect = (config: unknown) => inspectServe(config, HOST, 9443, 9130);

    expect({
      nothingConfigured: inspect({}),
      onlyTheFunnelOn443: inspect(FUNNEL_443),
      ours: inspect(withCaduceus('http://127.0.0.1:9130')),
      oursAsLocalhost: inspect(withCaduceus('http://localhost:9130')),
      oursWithSlash: inspect(withCaduceus('http://127.0.0.1:9130/')),
      otherPort: inspect(withCaduceus('http://127.0.0.1:9131')),
      otherHost: inspect(withCaduceus('http://192.168.1.5:9130')),
      extraPath: inspect(withCaduceus('http://127.0.0.1:9130', { '/files': { Path: '/tmp/files' } })),
      notAProxy: inspect({ ...FUNNEL_443, Web: { ...FUNNEL_443.Web, [`${HOST}:9443`]: { Handlers: { '/': { Text: 'hello' } } } } }),
      otherHostname: inspect({ Web: { 'other-node.tail0000aa.ts.net:9443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9130' } } } } }),
      publicOn9443: inspect({ ...withCaduceus('http://127.0.0.1:9130'), AllowFunnel: { ...FUNNEL_443.AllowFunnel, [`${HOST}:9443`]: true } }),
      funnelSwitchedOff: inspect({ ...withCaduceus('http://127.0.0.1:9130'), AllowFunnel: { [`${HOST}:9443`]: false } }),
      tcpForward: inspect({ TCP: { '9443': { TCPForward: '127.0.0.1:5000' } } }),
      listenerWithoutHandlers: inspect({ TCP: { '9443': { HTTPS: true } } }),
    }).toEqual({
      nothingConfigured: { entry: 'absent', funnel: false },
      onlyTheFunnelOn443: { entry: 'absent', funnel: false },
      ours: { entry: 'ours', funnel: false },
      oursAsLocalhost: { entry: 'ours', funnel: false },
      oursWithSlash: { entry: 'ours', funnel: false },
      otherPort: { entry: 'other', funnel: false, description: '/ → http://127.0.0.1:9131' },
      otherHost: { entry: 'other', funnel: false, description: '/ → http://192.168.1.5:9130' },
      extraPath: { entry: 'other', funnel: false, description: '/ → http://127.0.0.1:9130, /files → /tmp/files' },
      notAProxy: { entry: 'other', funnel: false, description: '/ → (text)' },
      otherHostname: { entry: 'absent', funnel: false },
      publicOn9443: { entry: 'ours', funnel: true },
      funnelSwitchedOff: { entry: 'ours', funnel: false },
      tcpForward: { entry: 'other', funnel: false, description: 'a TCP forward to 127.0.0.1:5000' },
      listenerWithoutHandlers: { entry: 'other', funnel: false, description: 'a listener with no handlers' },
    });
  });
});

/** A Mac where nothing of Caduceus is installed yet, with everything setup needs in place. */
const FRESH: Observed = { loaded: false, serve: FUNNEL_443, prerequisites: { webBuilt: true, dependencies: true, hermes: true } };
const PLIST = '/Users/tester/Library/LaunchAgents/dev.caduceus.dashboard.plist';

describe('planning setup', () => {
  test('on a fresh Mac: the directories, the configuration, the LaunchAgent, loading it, waiting for it to answer, and only then Serve', () => {
    const plan = planSetup(SPEC, FRESH);

    expect(plan.blockers).toEqual([]);
    expect(plan.steps.map((step) => step.action)).toEqual([
      { kind: 'ensure-dir', path: '/Users/tester/.hermes/caduceus', mode: 0o700 },
      { kind: 'ensure-dir', path: '/Users/tester/.hermes/caduceus/logs', mode: 0o700 },
      { kind: 'write-file', path: '/Users/tester/.hermes/caduceus/config.json', content: expect.any(String), mode: 0o600 },
      { kind: 'write-file', path: PLIST, content: expect.any(String), mode: 0o644 },
      { kind: 'launchctl', args: ['bootstrap', 'gui/501', PLIST] },
      { kind: 'wait-healthy', url: 'http://127.0.0.1:9130/_caduceus/healthz' },
      { kind: 'tailscale', args: ['serve', '--bg', '--https=9443', 'http://127.0.0.1:9130'] },
    ]);
    // What is written says what the owner expects: the configuration the service reads, and the LaunchAgent that starts it.
    const [config, plist] = plan.steps.flatMap(({ action }) => (action.kind === 'write-file' ? [action.content] : []));
    expect(JSON.parse(config)).toEqual(SPEC.config);
    expect(readPlist(plist)).toMatchObject({ Label: 'dev.caduceus.dashboard', RunAtLoad: true, KeepAlive: true });
  });
});

/**
 * A stand-in for the machine: carries out the actions of a plan on what `Observed` describes, the way the real system would
 * (the facts it encodes are launchd's and Tailscale's, not this module's).
 */
function apply(observed: Observed, plan: Plan): Observed {
  const next: Observed = structuredClone(observed);
  const serve = asRecord(next.serve);
  for (const { action } of plan.steps) {
    if (action.kind === 'ensure-dir') {
      next[action.path.endsWith('/logs') ? 'logsDir' : 'caduceusDir'] = { mode: action.mode };
    } else if (action.kind === 'write-file') {
      if (action.path.endsWith('.plist')) next.plistFile = { content: action.content };
      else next.configFile = { content: action.content, mode: action.mode };
    } else if (action.kind === 'remove-file') {
      delete next.plistFile;
    } else if (action.kind === 'launchctl') {
      if (action.args[0] === 'bootstrap') next.loaded = true;
      if (action.args[0] === 'bootout') next.loaded = false;
    } else if (action.kind === 'tailscale') {
      const key = `${HOST}:9443`;
      if (action.args.at(-1) === 'off') {
        delete asRecord(serve.TCP)['9443'];
        delete asRecord(serve.Web)[key];
      } else {
        asRecord(serve.TCP)['9443'] = { HTTPS: true };
        asRecord(serve.Web)[key] = { Handlers: { '/': { Proxy: action.args.at(-1) } } };
      }
    }
  }
  return next;
}
// The simulated Serve config is a plain object tree that `apply` edits in place.
const asRecord = (value: unknown) => value as Record<string, Record<string, unknown>>;

describe('running setup again', () => {
  test('changes nothing once everything is in place', () => {
    const first = planSetup(SPEC, FRESH);
    const installed = apply(FRESH, first);

    const second = planSetup(SPEC, installed);

    expect(first.steps.length).toBe(7);
    expect(second).toEqual({ blockers: [], steps: [], notes: [] });
  });

  test('a changed setting reloads the running service and leaves Serve alone; a missing LaunchAgent is written back; a loose directory is made owner-only', () => {
    const installed = apply(FRESH, planSetup(SPEC, FRESH));
    const kinds = (observed: Observed, spec: ServiceSpec = SPEC) => planSetup(spec, observed).steps.map(({ action }) => action.kind + (action.kind === 'launchctl' ? ` ${action.args[0]}` : ''));

    const newOwner = { ...SPEC, config: { ...SPEC.config, tailnetOwners: ['owner@example.com', 'partner@example.com'] } };
    const noPlist: Observed = { ...installed, plistFile: undefined };
    const looseDir: Observed = { ...installed, caduceusDir: { mode: 0o755 } };
    const looseConfig: Observed = { ...installed, configFile: { ...installed.configFile!, mode: 0o644 } };
    const stopped: Observed = { ...installed, loaded: false };

    expect({
      newOwner: kinds(installed, newOwner),
      noPlist: kinds(noPlist),
      looseDir: kinds(looseDir),
      looseConfig: kinds(looseConfig),
      stopped: kinds(stopped),
    }).toEqual({
      newOwner: ['write-file', 'launchctl bootout', 'launchctl bootstrap', 'wait-healthy'],
      noPlist: ['write-file', 'launchctl bootout', 'launchctl bootstrap', 'wait-healthy'],
      looseDir: ['ensure-dir'],
      looseConfig: ['write-file', 'launchctl bootout', 'launchctl bootstrap', 'wait-healthy'],
      stopped: ['launchctl bootstrap', 'wait-healthy'],
    });
  });
});

describe('what stops setup before it changes anything', () => {
  test('a web app that is not built, missing dependencies or Hermes, Tailscale not answering, something else on Serve\'s port, and Funnel on it', () => {
    const blocked = (observed: Observed) => planSetup(SPEC, observed);
    const needs = (prerequisites: Partial<Observed['prerequisites']>): Observed => ({ ...FRESH, prerequisites: { ...FRESH.prerequisites, ...prerequisites } });

    expect({
      webNotBuilt: blocked(needs({ webBuilt: false })),
      noDependencies: blocked(needs({ dependencies: false })),
      noHermes: blocked(needs({ hermes: false })),
      noTailscale: blocked({ ...FRESH, serve: undefined }),
      somethingElse: blocked({ ...FRESH, serve: withCaduceus('http://127.0.0.1:8080') }),
      public: blocked({ ...FRESH, serve: { ...withCaduceus('http://127.0.0.1:9130'), AllowFunnel: { [`${HOST}:9443`]: true } } }),
      several: blocked({ ...needs({ webBuilt: false, hermes: false }), serve: undefined }),
    }).toEqual({
      webNotBuilt: { blockers: ['The web app is not built. Run `npm run build -w web` first.'], steps: [], notes: [] },
      noDependencies: { blockers: ['Dependencies are not installed. Run `npm install` first.'], steps: [], notes: [] },
      noHermes: { blockers: ['`hermes` was not found on PATH, and the service needs it.'], steps: [], notes: [] },
      noTailscale: { blockers: ['Tailscale did not answer `tailscale serve status`. Is it installed and signed in?'], steps: [], notes: [] },
      somethingElse: {
        blockers: [`Tailscale Serve already has something else on port 9443 (/ → http://127.0.0.1:8080). Caduceus will not replace it: free the port yourself, or leave it as it is.`],
        steps: [],
        notes: [],
      },
      public: {
        blockers: ['Tailscale Funnel is on for port 9443, which would make Caduceus public. Caduceus is never served that way: turn it off with `tailscale funnel --https=9443 off`.'],
        steps: [],
        notes: [],
      },
      several: {
        blockers: [
          'The web app is not built. Run `npm run build -w web` first.',
          '`hermes` was not found on PATH, and the service needs it.',
          'Tailscale did not answer `tailscale serve status`. Is it installed and signed in?',
        ],
        steps: [],
        notes: [],
      },
    });
  });
});

describe('planning uninstall', () => {
  test('removes Serve\'s entry, the service and its LaunchAgent, in that order, and nothing else: the data stays and so does the Funnel on 443', () => {
    const installed = apply(FRESH, planSetup(SPEC, FRESH));

    const plan = planUninstall(SPEC, installed);
    const after = apply(installed, plan);

    expect(plan.blockers).toEqual([]);
    expect(plan.steps.map((step) => step.action)).toEqual([
      { kind: 'tailscale', args: ['serve', '--https=9443', 'off'] },
      { kind: 'launchctl', args: ['bootout', 'gui/501/dev.caduceus.dashboard'] },
      { kind: 'remove-file', path: PLIST },
    ]);
    // Back to what was there before setup, except what holds the owner's data and settings.
    expect(after).toEqual({ ...FRESH, caduceusDir: installed.caduceusDir, logsDir: installed.logsDir, configFile: installed.configFile });
    expect(after.serve).toEqual(FUNNEL_443);
    expect(plan.notes).toEqual(['Kept /Users/tester/.hermes/caduceus: the owner password, passkeys, sessions, audit log, configuration and logs. Delete it yourself to remove them too.']);
  });

  test('leaves a Serve entry that is not Caduceus\'s alone, says so when Tailscale cannot be asked, and has nothing to do once removed', () => {
    const installed = apply(FRESH, planSetup(SPEC, FRESH));
    const kept = 'Kept /Users/tester/.hermes/caduceus: the owner password, passkeys, sessions, audit log, configuration and logs. Delete it yourself to remove them too.';

    const someoneElses = planUninstall(SPEC, { ...installed, serve: withCaduceus('http://127.0.0.1:8080') });
    const noTailscale = planUninstall(SPEC, { ...installed, serve: undefined });
    const removed = planUninstall(SPEC, apply(installed, planUninstall(SPEC, installed)));
    const never = planUninstall(SPEC, FRESH);

    expect(someoneElses.steps.map(({ action }) => action.kind)).toEqual(['launchctl', 'remove-file']);
    expect(someoneElses.notes).toEqual([
      'Tailscale Serve port 9443 holds something that is not Caduceus\'s (/ → http://127.0.0.1:8080), so it was left alone.',
      kept,
    ]);
    expect(noTailscale.steps.map(({ action }) => action.kind)).toEqual(['launchctl', 'remove-file']);
    expect(noTailscale.notes).toEqual([
      'Tailscale did not answer, so Serve was not checked. If Caduceus was exposed, remove it with `tailscale serve --https=9443 off`.',
      kept,
    ]);
    expect(removed).toEqual({ blockers: [], steps: [], notes: ['Caduceus is not set up: nothing to remove.'] });
    expect(never).toEqual({ blockers: [], steps: [], notes: ['Caduceus is not set up: nothing to remove.'] });
  });
});

describe('planning a restart (after an upgrade)', () => {
  test('restarts the loaded service in place and waits for it; there is nothing to restart before setup', () => {
    const installed = apply(FRESH, planSetup(SPEC, FRESH));

    expect(planRestart(SPEC, installed)).toEqual({
      blockers: [],
      steps: [
        { summary: 'Restart the service, so that it runs the code now on disk', action: { kind: 'launchctl', args: ['kickstart', '-k', 'gui/501/dev.caduceus.dashboard'] } },
        { summary: 'Wait for Caduceus to answer on http://127.0.0.1:9130', action: { kind: 'wait-healthy', url: 'http://127.0.0.1:9130/_caduceus/healthz' } },
      ],
      notes: [],
    });
    expect(planRestart(SPEC, FRESH)).toEqual({ blockers: ['Caduceus is not loaded in launchd. Run `npm run caduceus -- setup` first.'], steps: [], notes: [] });
  });
});

describe('reading `tailscale status --json`', () => {
  test('finds this node\'s hostname without the trailing dot and the login of the user it belongs to; says nothing when it is not signed in', () => {
    const status = {
      BackendState: 'Running',
      Self: { DNSName: `${HOST}.`, UserID: 1234567 },
      User: { '1234567': { ID: 1234567, LoginName: 'Owner@Example.com', DisplayName: 'Owner' }, '7654321': { ID: 7654321, LoginName: 'friend@example.com' } },
    };

    expect(parseTailscaleStatus(JSON.stringify(status))).toEqual({ host: HOST, login: 'owner@example.com' });
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'NeedsLogin', Self: null, User: null }))).toBeUndefined();
    expect(parseTailscaleStatus(JSON.stringify({ ...status, User: {} }))).toEqual({ host: HOST, login: undefined });
    expect(parseTailscaleStatus('not json')).toBeUndefined();
  });
});

describe('choosing the configuration', () => {
  test('flags beat the configuration already written, which beats what Tailscale says; origin and RP ID follow the host; a bad choice is named', () => {
    const existing = { port: 9130, publicOrigin: `https://${HOST}:9443`, rpId: HOST, tailnetOwners: ['a@example.com', 'b@example.com'] };
    const detected = { host: 'other-node.tail0000aa.ts.net', login: 'detected@example.com' };
    const choose = (input: Partial<Parameters<typeof resolveConfig>[0]>) => resolveConfig({ flags: { owners: [] }, ...input });

    expect({
      detectedOnly: choose({ detected }),
      existingKept: choose({ existing, detected }),
      flagsWin: choose({ existing, detected, flags: { host: 'third.tail0000aa.ts.net', owners: ['New@Example.com'], port: 9200 } }),
      noHost: choose({ detected: undefined }),
      noLogin: choose({ detected: { host: detected.host, login: undefined } }),
      notATailnetHost: choose({ flags: { host: 'example.com', owners: ['a@example.com'] } }),
      badPort: choose({ existing, flags: { owners: [], port: 0 } }),
    }).toEqual({
      detectedOnly: {
        config: { port: 9130, publicOrigin: 'https://other-node.tail0000aa.ts.net:9443', rpId: 'other-node.tail0000aa.ts.net', tailnetOwners: ['detected@example.com'] },
        from: { host: 'Tailscale', owners: 'Tailscale', port: 'the default' },
      },
      existingKept: { config: existing, from: { host: 'the configuration already written', owners: 'the configuration already written', port: 'the configuration already written' } },
      flagsWin: {
        config: { port: 9200, publicOrigin: 'https://third.tail0000aa.ts.net:9443', rpId: 'third.tail0000aa.ts.net', tailnetOwners: ['new@example.com'] },
        from: { host: 'the command line', owners: 'the command line', port: 'the command line' },
      },
      noHost: { error: 'Cannot tell this node\'s tailnet hostname. Pass it with `--host <node>.<tailnet>.ts.net`.' },
      noLogin: { error: 'Cannot tell which Tailscale login is the owner\'s. Pass it with `--owner <login>` (repeat it for more than one).' },
      notATailnetHost: { error: '"publicOrigin" must be on a ts.net hostname: Caduceus is served only on the tailnet.' },
      badPort: { error: '"port" must be a whole number from 1 to 65535.' },
    });
  });
});

describe('reading `launchctl print`', () => {
  test('finds whether the service is running and its process, and why it last stopped, in the way launchd words them', () => {
    const running = 'gui/501/dev.caduceus.dashboard = {\n\tactive count = 1\n\tpath = /x.plist\n\ttype = LaunchAgent\n\tstate = running\n\n\tprogram = /usr/bin/node\n\tpid = 4321\n\tlast exit code = (never exited)\n\n\tproperties = keepalive | runatload\n}\n';
    const waiting = 'gui/501/dev.caduceus.dashboard = {\n\tstate = waiting\n\n\tlast exit code = 1\n\tlast terminating signal = Killed: 9\n}\n';

    expect(parseLaunchctlPrint(running)).toEqual({ state: 'running', pid: 4321, lastExit: '(never exited)' });
    expect(parseLaunchctlPrint(waiting)).toEqual({ state: 'waiting', pid: undefined, lastExit: '1' });
    expect(parseLaunchctlPrint('something unexpected')).toEqual({ state: undefined, pid: undefined, lastExit: undefined });
  });
});
