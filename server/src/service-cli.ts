// The `caduceus` command (M0 #13): `setup`, `uninstall`, `restart` and `status` for the background service. It reads the machine
// (questions only), builds a plan with `service-plan.ts`, and shows it. Nothing is changed without `--yes`, and a change to
// Tailscale needs the owner's confirmation of its own, asked at that moment.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { hermesRootHome } from './hermes-root-home.ts';
import { parseProductionConfig, renderProductionConfig, type ProductionConfig } from './production-config.ts';
import {
  DEFAULT_PORT,
  SERVE_PORT,
  SERVICE_LABEL,
  inspectServe,
  parseLaunchctlPrint,
  parseTailscaleStatus,
  planRestart,
  planSetup,
  planUninstall,
  renderLaunchAgent,
  resolveConfig,
  servicePaths,
  type Action,
  type LaunchdState,
  type Observed,
  type Plan,
  type ServiceSpec,
  type TailnetNode,
} from './service-plan.ts';

/** What the command runs against: the owner's shell for real, a temp home and fake programs in the tests. */
export interface CliIo {
  /** The environment of the owner's shell: `PATH` finds `launchctl`, `tailscale` and `hermes`; `HERMES_HOME`, if set, is passed on to the service. */
  env: Record<string, string | undefined>;
  home: string;
  uid: number;
  platform: NodeJS.Platform;
  /** The `node` the service will run under: the one running this command. */
  nodePath: string;
  /** The Caduceus checkout (the service runs from it). */
  projectRoot: string;
  stdout(text: string): void;
  /** Where the owner's answer to the Tailscale question is read from. */
  stdin: Readable;
  /** Whether a person is at the terminal to answer it. */
  interactive: boolean;
  /** How long to wait for the service to answer after it is started; defaults to a minute. */
  healthTimeoutMs?: number;
}

const USAGE = `Usage: npm run caduceus -- <command> [options]

Commands:
  setup       Install Caduceus as a background service and serve it on the tailnet (safe to run again)
  uninstall   Remove the service and the Tailscale Serve entry that setup added, and nothing else
  restart     Restart the service (after an upgrade)
  status      Show whether the service is installed, running and served

Options:
  --yes, -y         Do what the plan says. Without it nothing is changed: the plan is only shown.
  --yes-tailscale   Also confirm the Tailscale change in advance (otherwise it is asked for at that moment)
  --dry-run         Only show the plan (the default)
  --host <name>     This node's tailnet hostname (setup; default: what Tailscale reports)
  --owner <login>   A Tailscale login allowed through Serve; repeat it for more (setup; default: this node's user)
  --port <n>        The loopback port Caduceus listens on (setup; default ${DEFAULT_PORT})
`;

interface Options {
  command: 'setup' | 'uninstall' | 'restart' | 'status';
  yes: boolean;
  yesTailscale: boolean;
  host?: string;
  owners: string[];
  port?: number;
}

/** Reads the command line; a string is what to tell the owner when it cannot be understood. */
function parseOptions(args: string[]): Options | string {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        yes: { type: 'boolean', short: 'y' },
        'yes-tailscale': { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        host: { type: 'string' },
        owner: { type: 'string', multiple: true },
        port: { type: 'string' },
      },
    });
  } catch (error) {
    return (error as Error).message;
  }
  const { values, positionals } = parsed;
  const [command, ...extra] = positionals;
  if (command !== 'setup' && command !== 'uninstall' && command !== 'restart' && command !== 'status') return command ? `Unknown command "${command}".` : 'Say what to do.';
  if (extra.length > 0) return `Unexpected argument "${extra[0]}".`;
  if (values.yes && values['dry-run']) return '--yes and --dry-run contradict each other.';
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && !Number.isInteger(port)) return `--port must be a whole number, not "${values.port}".`;
  return { command, yes: values.yes ?? false, yesTailscale: values['yes-tailscale'] ?? false, host: values.host, owners: values.owner ?? [], port };
}

/** The first executable called `name` on `searchPath`, like a shell finds it. */
function findOnPath(name: string, searchPath: string | undefined): string | undefined {
  for (const dir of (searchPath ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not here; try the next directory.
    }
  }
  return undefined;
}

interface Probe {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Runs a program to its end and reports how it went; never throws. */
function run(file: string, args: string[], env: CliIo['env']): Promise<Probe> {
  const { promise, resolve } = Promise.withResolvers<Probe>();
  execFile(file, args, { env: env as NodeJS.ProcessEnv, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }));
  return promise;
}

const readText = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

const permissions = (file: string): number | undefined => {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return undefined;
  }
};

export async function runCli(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args);
  if (typeof options === 'string') {
    io.stdout(`${options}\n\n${USAGE}`);
    return 2;
  }
  if (io.platform !== 'darwin') {
    io.stdout('The service is a macOS LaunchAgent, so this command only runs on macOS.\n');
    return 1;
  }
  const launchctl = findOnPath('launchctl', io.env.PATH);
  if (!launchctl) {
    io.stdout('`launchctl` was not found on PATH.\n');
    return 1;
  }
  const tailscale = findOnPath('tailscale', io.env.PATH);
  const hermes = findOnPath('hermes', io.env.PATH);
  const hermesRoot = hermesRootHome(io.env, io.home);
  const configFile = path.join(hermesRoot, 'caduceus', 'config.json');
  const existing = readConfig(configFile);
  if (options.command === 'status' && !existing.config) {
    io.stdout(`Caduceus is not set up: ${existing.problem ?? `there is no configuration at ${configFile}`}. Run \`npm run caduceus -- setup\`.\n`);
    return 1;
  }

  // What Tailscale says about this node is the default for the hostname and the owner, but never over what was written before.
  const serveStatus = tailscale ? await run(tailscale, ['serve', 'status', '--json'], io.env) : undefined;
  const serve: unknown = serveStatus?.ok ? safeJson(serveStatus.stdout) : undefined;
  const needsTailscaleIdentity = !existing.config && (!options.host || options.owners.length === 0);
  let detected: TailnetNode | undefined;
  if (tailscale && needsTailscaleIdentity) detected = parseTailscaleStatus((await run(tailscale, ['status', '--json'], io.env)).stdout);

  let config: ProductionConfig;
  let from: Record<'host' | 'owners' | 'port', string> = { host: '', owners: '', port: '' };
  if (options.command === 'setup') {
    const choice = resolveConfig({ flags: { host: options.host, owners: options.owners, port: options.port }, existing: existing.config, detected });
    if ('error' in choice) {
      io.stdout(`${choice.error}\n`);
      return 1;
    }
    ({ config, from } = choice);
    if (existing.problem) io.stdout(`The configuration at ${configFile} cannot be used (${existing.problem}) and will be replaced.\n\n`);
    if (existing.config && existing.config.rpId !== config.rpId) {
      io.stdout(`Warning: the hostname changes from ${existing.config.rpId} to ${config.rpId}. Passkeys are bound to the hostname, so those already registered will stop working, and a new one must be added.\n\n`);
    }
  } else {
    // Removing, restarting and reporting need only the host and the port, which setup wrote. Without that file, ask Tailscale.
    const host = detected?.host ?? 'unknown.ts.net';
    config = existing.config ?? { port: options.port ?? DEFAULT_PORT, publicOrigin: `https://${host}:${SERVE_PORT}`, rpId: host, tailnetOwners: [] };
  }

  const hermesHome = io.env.HERMES_HOME?.trim();
  const spec: ServiceSpec = {
    uid: io.uid,
    home: io.home,
    hermesRoot,
    projectRoot: io.projectRoot,
    nodePath: io.nodePath,
    hermesCommand: hermes ?? 'hermes',
    path: io.env.PATH ?? '',
    hermesHome: hermesHome || undefined,
    config,
  };
  const paths = servicePaths(spec);
  const launchd = await run(launchctl, ['print', `gui/${io.uid}/${SERVICE_LABEL}`], io.env);
  const observed: Observed = {
    caduceusDir: modeOf(paths.caduceusDir),
    logsDir: modeOf(paths.logsDir),
    configFile: fileOf(paths.configFile),
    plistFile: plistOf(paths.plistFile),
    loaded: launchd.ok,
    serve,
    prerequisites: {
      webBuilt: fs.existsSync(path.join(io.projectRoot, 'web', 'dist', 'index.html')),
      dependencies: fs.existsSync(paths.tsxLoader),
      hermes: hermes !== undefined,
    },
  };

  if (options.command === 'status') return showStatus(io, spec, observed, launchd.ok ? parseLaunchctlPrint(launchd.stdout) : undefined);
  const plan = options.command === 'setup' ? planSetup(spec, observed) : options.command === 'uninstall' ? planUninstall(spec, observed) : planRestart(spec, observed);
  showPlan(io, options, spec, from, plan);
  if (plan.blockers.length > 0) return 1;
  if (plan.steps.length === 0) return 0;
  if (!options.yes) {
    io.stdout('\nNothing was changed. Run it again with --yes to do this. The Tailscale step will still ask you first.\n');
    return 0;
  }
  io.stdout('\n');
  const code = await carryOut(io, options, spec, plan, { launchctl, tailscale });
  if (code === 0 && options.command === 'setup') {
    io.stdout(
      [
        '',
        `Caduceus is running (${SERVICE_LABEL}) and served on the tailnet only at ${spec.config.publicOrigin}.`,
        '',
        'Next:',
        `  1. On this Mac, open http://localhost:${spec.config.port} and set the owner password (that is only possible from this Mac, and only once).`,
        `  2. On your phone, open ${spec.config.publicOrigin}, sign in, then add a passkey in Settings > Security (passkeys made on localhost do not carry over).`,
        `  The log is ${servicePaths(spec).logFile}`,
        '',
      ].join('\n'),
    );
  }
  return code;
}

/** `status`: what is installed, running, answering and served, from questions only. Exit 0 when all of it is as it should be. */
async function showStatus(io: CliIo, spec: ServiceSpec, observed: Observed, launchd: LaunchdState | undefined): Promise<number> {
  const paths = servicePaths(spec);
  const healthUrl = `http://127.0.0.1:${spec.config.port}/_caduceus/healthz`;
  const answering = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) }).then(
    (response) => response.ok,
    () => false,
  );
  const serve = observed.serve === undefined ? undefined : inspectServe(observed.serve, new URL(spec.config.publicOrigin).hostname, SERVE_PORT, spec.config.port);
  const upToDate = observed.plistFile?.content === renderLaunchAgent(spec) && observed.configFile?.content === renderProductionConfig(spec.config);
  const row = (label: string, text: string) => `  ${label.padEnd(12)}${text}`;

  const lines = [
    'Caduceus status',
    '',
    row('LaunchAgent', observed.plistFile ? `${paths.plistFile} (${upToDate ? 'up to date' : 'differs from what setup would write: run setup again'})` : `missing: ${paths.plistFile}`),
    row('Service', !observed.loaded ? 'not loaded in launchd' : launchd?.state === 'running' ? `running (pid ${launchd.pid})` : `loaded, ${launchd?.state ?? 'state unknown'}${launchd?.lastExit ? ` (last exit ${launchd.lastExit})` : ''}`),
    row('Health', answering ? `answering at ${healthUrl}` : `NOT answering at ${healthUrl}`),
    row(
      'Serve',
      serve === undefined
        ? 'unknown: Tailscale did not answer'
        : serve.entry === 'ours'
          ? `${spec.config.publicOrigin} -> http://127.0.0.1:${spec.config.port} (tailnet only)`
          : serve.entry === 'absent'
            ? `not set up: nothing is served at ${spec.config.publicOrigin}`
            : `something else is on port ${SERVE_PORT}: ${serve.description}`,
    ),
    row('Funnel', serve?.funnel ? `ON for port ${SERVE_PORT}: Caduceus is PUBLIC. Turn it off: tailscale funnel --https=${SERVE_PORT} off` : `off for port ${SERVE_PORT}`),
    row('Owners', spec.config.tailnetOwners.join(', ')),
    row('Log', paths.logFile),
    '',
  ];
  io.stdout(lines.join('\n'));
  return observed.loaded && answering && serve?.entry === 'ours' && !serve.funnel ? 0 : 1;
}

/** The Certificate Transparency warning shown before the owner is asked about Serve. */
function certificateTransparencyWarning(host: string): string {
  return [
    '',
    'About the hostname: Tailscale gets a public HTTPS certificate for this node, and certificate authorities publish every certificate',
    `in public Certificate Transparency logs. Anyone can therefore see that ${host} exists (not what is served on it).`,
    'The certificate covers every port of the hostname, so if Serve or Funnel already uses HTTPS on this node, it is already listed.',
    '',
  ].join('\n');
}

/** The owner's answer to a question, read from one line of input. Anything but yes is no. */
async function askYesNo(io: CliIo, question: string): Promise<boolean> {
  io.stdout(question);
  const lines = readline.createInterface({ input: io.stdin });
  try {
    for await (const line of lines) return /^y(es)?$/i.test(line.trim());
  } finally {
    lines.close();
  }
  return false;
}

/** Whether the owner has agreed to this change of Tailscale: in advance with --yes-tailscale, or now, at the terminal. Nothing else counts. */
async function confirmTailscale(io: CliIo, options: Options, args: string[]): Promise<boolean> {
  if (options.yesTailscale) return true;
  if (!io.interactive) return false;
  io.stdout(`This changes Tailscale's configuration. It runs: tailscale ${args.join(' ')}\n`);
  return askYesNo(io, 'Change Tailscale Serve now? [y/N] ');
}

/** Runs one step; throws what went wrong, in words for the owner. */
async function perform(io: CliIo, action: Action, programs: { launchctl: string; tailscale?: string }, logFile: string, state: { afterBootout: boolean }): Promise<void> {
  switch (action.kind) {
    case 'ensure-dir':
      fs.mkdirSync(action.path, { recursive: true, mode: action.mode });
      // The mode of `mkdir` only applies to a directory that is new, and the umask can trim it.
      fs.chmodSync(action.path, action.mode);
      return;
    case 'write-file': {
      fs.mkdirSync(path.dirname(action.path), { recursive: true });
      const temporary = `${action.path}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, action.content, { mode: action.mode });
      fs.chmodSync(temporary, action.mode);
      fs.renameSync(temporary, action.path);
      return;
    }
    case 'remove-file':
      fs.rmSync(action.path, { force: true });
      return;
    case 'launchctl': {
      // Right after an unload, launchd can still be finishing it, and loading again fails for a moment.
      const attempts = action.args[0] === 'bootstrap' && state.afterBootout ? 10 : 1;
      let result = await run(programs.launchctl, action.args, io.env);
      for (let attempt = 1; !result.ok && attempt < attempts; attempt++) {
        await sleep(500);
        result = await run(programs.launchctl, action.args, io.env);
      }
      state.afterBootout = action.args[0] === 'bootout';
      if (!result.ok) throw new Error(`launchctl ${action.args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
      return;
    }
    case 'wait-healthy':
      await waitUntilHealthy(action.url, io.healthTimeoutMs ?? 60_000, logFile);
      return;
    case 'tailscale': {
      // Only `carryOut` gets here, and only once the owner has agreed to this very step.
      const result = await run(programs.tailscale!, action.args, io.env);
      if (!result.ok) throw new Error(`tailscale ${action.args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
      if (result.stdout.trim()) io.stdout(`${result.stdout.trim().replace(/^/gm, '       ')}\n`);
      return;
    }
  }
}

/**
 * Waits for Caduceus to answer its liveness probe. The service starting to listen is a fact of the operating system and there is
 * nothing to await but the answer, so this polls, up to `timeoutMs`.
 */
async function waitUntilHealthy(url: string, timeoutMs: number, logFile: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() >= deadline) throw new Error(`Caduceus did not answer at ${url}. The service's log is ${logFile}.`);
    await sleep(250);
  }
}

async function carryOut(io: CliIo, options: Options, spec: ServiceSpec, plan: Plan, programs: { launchctl: string; tailscale?: string }): Promise<number> {
  const { logFile } = servicePaths(spec);
  const state = { afterBootout: false };
  let tailscaleLeftAlone: Action | undefined;
  for (const step of plan.steps) {
    if (step.action.kind === 'tailscale') {
      if (options.command === 'setup') io.stdout(`${certificateTransparencyWarning(new URL(spec.config.publicOrigin).hostname)}\n`);
      if (!(await confirmTailscale(io, options, step.action.args))) {
        tailscaleLeftAlone = step.action;
        io.stdout(`  - ${step.summary}: NOT DONE, the owner has not confirmed it\n`);
        continue;
      }
    }
    try {
      await perform(io, step.action, programs, logFile, state);
    } catch (error) {
      io.stdout(`  ✗ ${step.summary}\n    ${(error as Error).message}\n`);
      return 1;
    }
    io.stdout(`  ✓ ${step.summary}\n`);
  }
  if (tailscaleLeftAlone?.kind === 'tailscale') {
    io.stdout(
      `\nTailscale was not changed. To do it, run the command again with --yes-tailscale (or at a terminal, where you are asked), or run it yourself: tailscale ${tailscaleLeftAlone.args.join(' ')}\n`,
    );
    return 1;
  }
  return 0;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readConfig(file: string): { config?: ProductionConfig; problem?: string } {
  const text = readText(file);
  if (text === undefined) return {};
  try {
    return { config: parseProductionConfig(text) };
  } catch (error) {
    return { problem: (error as Error).message };
  }
}

const modeOf = (dir: string) => {
  const mode = permissions(dir);
  return mode === undefined ? undefined : { mode };
};

const fileOf = (file: string) => {
  const content = readText(file);
  return content === undefined ? undefined : { content, mode: permissions(file) ?? 0 };
};

const plistOf = (file: string) => {
  const content = readText(file);
  return content === undefined ? undefined : { content };
};

function showPlan(io: CliIo, options: Options, spec: ServiceSpec, from: Record<'host' | 'owners' | 'port', string>, plan: Plan): void {
  const lines: string[] = [`Caduceus ${options.command}`, ''];
  if (options.command === 'setup') {
    lines.push(
      `  Address  ${spec.config.publicOrigin}  (tailnet only; never Funnel; host from ${from.host})`,
      `  Owners   ${spec.config.tailnetOwners.join(', ')}  (from ${from.owners})`,
      `  Service  ${SERVICE_LABEL}, 127.0.0.1:${spec.config.port}  (port from ${from.port})`,
      '',
    );
  }
  for (const blocker of plan.blockers) lines.push(`  Cannot go on: ${blocker}`);
  if (plan.blockers.length === 0) {
    if (plan.steps.length === 0) lines.push('  Nothing to do.');
    plan.steps.forEach((step, index) => {
      const { action } = step;
      lines.push(`  ${index + 1}. ${action.kind === 'tailscale' ? '[Tailscale] ' : ''}${step.summary}`);
      if (action.kind === 'tailscale') lines.push(`       runs: tailscale ${action.args.join(' ')}`, '       asks for your confirmation on its own, when it comes to it');
      if (action.kind === 'launchctl') lines.push(`       runs: launchctl ${action.args.join(' ')}`);
    });
  }
  for (const note of plan.notes) lines.push('', `  ${note}`);
  io.stdout(`${lines.join('\n')}\n`);
}
