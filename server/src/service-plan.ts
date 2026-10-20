// Running Caduceus as a background service (M0 #13), as pure logic: what the service is, what `caduceus setup`, `uninstall` and
// `restart` would change given what is already there, and what they leave alone. Nothing here reads or changes the system;
// `service-cli.ts` observes it, shows the plan and (only with the owner's confirmation) carries out each step.
import path from 'node:path';
import { parseProductionConfig, ProductionConfigError, renderProductionConfig, type ProductionConfig } from './production-config.ts';

/** The launchd label of the service. */
export const SERVICE_LABEL = 'dev.caduceus.dashboard';

/** What the service is: everything the plan needs from the machine, as absolute paths. */
export interface ServiceSpec {
  /** The owner's user id: the LaunchAgent lives in their `gui/<uid>` launchd domain. */
  uid: number;
  home: string;
  /** The Hermes root home (`~/.hermes`); Caduceus keeps its directory, configuration and logs in its `caduceus/`. */
  hermesRoot: string;
  /** The Caduceus checkout the service runs from. */
  projectRoot: string;
  /** The `node` that runs it. launchd has no login shell, so this is the one found when setup ran. */
  nodePath: string;
  /** The `hermes` the private backend is started with. */
  hermesCommand: string;
  /** The service's `PATH`: Hermes starts tools of its own, and launchd's default `PATH` has none of the owner's. */
  path: string;
  /** Passed on when setup ran with `HERMES_HOME` set (a Hermes profile or a custom root), so the service sees the same home. */
  hermesHome?: string;
  config: ProductionConfig;
}

/** Where everything of the service lives. */
export function servicePaths(spec: ServiceSpec) {
  const caduceusDir = path.join(spec.hermesRoot, 'caduceus');
  return {
    caduceusDir,
    logsDir: path.join(caduceusDir, 'logs'),
    logFile: path.join(caduceusDir, 'logs', 'caduceus.log'),
    configFile: path.join(caduceusDir, 'config.json'),
    plistFile: path.join(spec.home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`),
    tsxLoader: path.join(spec.projectRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs'),
    mainFile: path.join(spec.projectRoot, 'server', 'src', 'main.ts'),
  };
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const xml = (text: string) => text.replace(/[&<>]/g, (char) => XML_ESCAPES[char]);

/** The LaunchAgent property list: runs the production server at login and again whenever it stops, logging under the Caduceus directory. */
export function renderLaunchAgent(spec: ServiceSpec): string {
  const paths = servicePaths(spec);
  const environment: Record<string, string> = {
    PATH: spec.path,
    CADUCEUS_CONFIG: paths.configFile,
    CADUCEUS_HERMES_COMMAND: spec.hermesCommand,
    ...(spec.hermesHome ? { HERMES_HOME: spec.hermesHome } : {}),
  };
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `\t<key>Label</key>\n\t<string>${SERVICE_LABEL}</string>`,
    `\t<key>ProgramArguments</key>\n\t<array>\n${[spec.nodePath, '--import', paths.tsxLoader, paths.mainFile].map((arg) => `\t\t<string>${xml(arg)}</string>`).join('\n')}\n\t</array>`,
    `\t<key>WorkingDirectory</key>\n\t<string>${xml(spec.projectRoot)}</string>`,
    `\t<key>EnvironmentVariables</key>\n\t<dict>\n${Object.entries(environment)
      .map(([key, value]) => `\t\t<key>${key}</key>\n\t\t<string>${xml(value)}</string>`)
      .join('\n')}\n\t</dict>`,
    '\t<key>RunAtLoad</key>\n\t<true/>',
    '\t<key>KeepAlive</key>\n\t<true/>',
    '\t<key>Umask</key>\n\t<integer>63</integer>',
    `\t<key>StandardOutPath</key>\n\t<string>${xml(paths.logFile)}</string>`,
    `\t<key>StandardErrorPath</key>\n\t<string>${xml(paths.logFile)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ];
  return lines.join('\n');
}

export interface ServeInspection {
  /** `ours`: exactly the entry setup adds (everything at `/` proxied to Caduceus's loopback port). `other`: something else is on the port. */
  entry: 'absent' | 'ours' | 'other';
  /** Funnel is switched on for the port: Caduceus would be public. Never what setup wants, and never something it changes. */
  funnel: boolean;
  /** What is on the port, when it is `other`. */
  description?: string;
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

/** Whether a Serve proxy target is Caduceus's own loopback port, however Tailscale or the owner spelled it. */
function isLoopbackTarget(proxy: unknown, port: number): boolean {
  if (typeof proxy !== 'string' || !URL.canParse(proxy)) return false;
  const url = new URL(proxy);
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port === String(port) && url.pathname === '/' && !url.search;
}

/**
 * Reads what `tailscale serve status --json` printed (`config`, parsed) for this node's `host:servePort`: whether the entry is
 * Caduceus's own, something else, or nothing, and whether Funnel is on there. Other ports (this node's Funnel on 443) are not looked at.
 */
export function inspectServe(config: unknown, host: string, servePort: number, proxyPort: number): ServeInspection {
  const key = `${host}:${servePort}`;
  const funnel = asRecord(asRecord(config).AllowFunnel)[key] === true;
  const web = asRecord(asRecord(config).Web)[key];
  if (web === undefined) {
    const listener = asRecord(asRecord(asRecord(config).TCP)[String(servePort)]);
    if (Object.keys(listener).length === 0) return { entry: 'absent', funnel };
    const description = typeof listener.TCPForward === 'string' ? `a TCP forward to ${listener.TCPForward}` : 'a listener with no handlers';
    return { entry: 'other', funnel, description };
  }
  const handlers = Object.entries(asRecord(asRecord(web).Handlers));
  if (handlers.length === 1 && handlers[0][0] === '/' && isLoopbackTarget(asRecord(handlers[0][1]).Proxy, proxyPort)) return { entry: 'ours', funnel };
  const description = handlers
    .map(([mount, handler]) => {
      const { Proxy, Path, Redirect } = asRecord(handler);
      return `${mount} → ${Proxy ?? Path ?? (Redirect === undefined ? '(text)' : `(redirect to ${Redirect})`)}`;
    })
    .join(', ');
  return { entry: 'other', funnel, description };
}

/** One thing a command does to the machine. `service-cli.ts` carries each out; this module only decides which. */
export type Action =
  | { kind: 'ensure-dir'; path: string; mode: number }
  | { kind: 'write-file'; path: string; content: string; mode: number }
  | { kind: 'remove-file'; path: string }
  | { kind: 'launchctl'; args: string[] }
  | { kind: 'wait-healthy'; url: string }
  /** A change to Tailscale Serve: the only kind that needs the owner's separate confirmation. */
  | { kind: 'tailscale'; args: string[] };

export interface Step {
  /** What the owner is told before it happens. */
  summary: string;
  action: Action;
}

export interface Plan {
  /** Reasons nothing can be done; when there are any, `steps` is empty. */
  blockers: string[];
  steps: Step[];
  /** Things the owner should know that are not steps. */
  notes: string[];
}

/** What is on this machine now: read, never changed, before a plan is made. Modes are the permission bits only. */
export interface Observed {
  caduceusDir?: { mode: number };
  logsDir?: { mode: number };
  configFile?: { content: string; mode: number };
  plistFile?: { content: string };
  /** launchd has the service loaded (it is running, or waiting for its next start). */
  loaded: boolean;
  /** `tailscale serve status --json`, parsed; `undefined` when Tailscale could not be asked (not installed, not running). */
  serve: unknown;
  prerequisites: { webBuilt: boolean; dependencies: boolean; hermes: boolean };
}

/** The port Tailscale Serve exposes Caduceus on (D9: 443 is the node's public Funnel). */
export const SERVE_PORT = 9443;

/**
 * What setup would do to bring `observed` to `spec`: only what is missing or different, so that on a machine where everything
 * is in place the plan is empty. A change to the configuration or the LaunchAgent while the service is loaded reloads it.
 * Tailscale Serve is the last step and is added only once the service answers.
 */
export function planSetup(spec: ServiceSpec, observed: Observed): Plan {
  const paths = servicePaths(spec);
  const target = `http://127.0.0.1:${spec.config.port}`;
  const domain = `gui/${spec.uid}`;
  const serve = observed.serve === undefined ? undefined : inspectServe(observed.serve, new URL(spec.config.publicOrigin).hostname, SERVE_PORT, spec.config.port);

  // Everything that would stop setup is found before anything is planned, so that a refusal changes nothing at all.
  const blockers: string[] = [];
  if (!observed.prerequisites.webBuilt) blockers.push('The web app is not built. Run `npm run build -w web` first.');
  if (!observed.prerequisites.dependencies) blockers.push('Dependencies are not installed. Run `npm install` first.');
  if (!observed.prerequisites.hermes) blockers.push('`hermes` was not found on PATH, and the service needs it.');
  if (!serve) blockers.push('Tailscale did not answer `tailscale serve status`. Is it installed and signed in?');
  if (serve?.entry === 'other') {
    blockers.push(`Tailscale Serve already has something else on port ${SERVE_PORT} (${serve.description}). Caduceus will not replace it: free the port yourself, or leave it as it is.`);
  }
  if (serve?.funnel) {
    blockers.push(`Tailscale Funnel is on for port ${SERVE_PORT}, which would make Caduceus public. Caduceus is never served that way: turn it off with \`tailscale funnel --https=${SERVE_PORT} off\`.`);
  }
  if (blockers.length > 0 || !serve) return { blockers, steps: [], notes: [] };

  const steps: Step[] = [];

  for (const [dir, found] of [[paths.caduceusDir, observed.caduceusDir], [paths.logsDir, observed.logsDir]] as const) {
    if (found?.mode === 0o700) continue;
    steps.push({ summary: `${found ? 'Make' : 'Create'} ${dir} ${found ? 'owner-only' : '(owner only)'}`, action: { kind: 'ensure-dir', path: dir, mode: 0o700 } });
  }

  const config = renderProductionConfig(spec.config);
  const plist = renderLaunchAgent(spec);
  const configChanged = observed.configFile?.content !== config || observed.configFile.mode !== 0o600;
  const plistChanged = observed.plistFile?.content !== plist;
  if (configChanged) steps.push({ summary: `Write ${paths.configFile}`, action: { kind: 'write-file', path: paths.configFile, content: config, mode: 0o600 } });
  if (plistChanged) steps.push({ summary: `Write ${paths.plistFile}`, action: { kind: 'write-file', path: paths.plistFile, content: plist, mode: 0o644 } });

  const reload = observed.loaded && (configChanged || plistChanged);
  if (reload) steps.push({ summary: 'Unload the running service, to load it again with the new settings', action: { kind: 'launchctl', args: ['bootout', `${domain}/${SERVICE_LABEL}`] } });
  if (!observed.loaded || reload) steps.push({ summary: 'Load the service into launchd (it starts now, at every login, and again if it stops)', action: { kind: 'launchctl', args: ['bootstrap', domain, paths.plistFile] } });

  const exposes = serve.entry === 'absent';
  if (steps.some(({ action }) => action.kind === 'launchctl') || exposes) {
    steps.push({ summary: `Wait for Caduceus to answer on ${target}`, action: { kind: 'wait-healthy', url: `${target}/_caduceus/healthz` } });
  }
  if (exposes) {
    steps.push({ summary: `Expose it on the tailnet only: ${spec.config.publicOrigin} → ${target}`, action: { kind: 'tailscale', args: ['serve', '--bg', `--https=${SERVE_PORT}`, target] } });
  }
  return { blockers: [], steps, notes: [] };
}

/**
 * What uninstall would remove: Caduceus's own Serve entry (never another, never the node's Funnel on 443), the loaded service
 * and its LaunchAgent. The Caduceus directory (the owner's password, passkeys, sessions and audit log, and the configuration and
 * logs) stays: deleting someone's data is not part of removing the service.
 */
export function planUninstall(spec: ServiceSpec, observed: Observed): Plan {
  const paths = servicePaths(spec);
  const domain = `gui/${spec.uid}`;
  const steps: Step[] = [];
  const notes: string[] = [];

  const serve = observed.serve === undefined ? undefined : inspectServe(observed.serve, new URL(spec.config.publicOrigin).hostname, SERVE_PORT, spec.config.port);
  if (serve?.entry === 'ours') {
    steps.push({ summary: `Stop exposing Caduceus on the tailnet (Tailscale Serve, port ${SERVE_PORT})`, action: { kind: 'tailscale', args: ['serve', `--https=${SERVE_PORT}`, 'off'] } });
  } else if (serve?.entry === 'other') {
    notes.push(`Tailscale Serve port ${SERVE_PORT} holds something that is not Caduceus's (${serve.description}), so it was left alone.`);
  } else if (!serve) {
    notes.push(`Tailscale did not answer, so Serve was not checked. If Caduceus was exposed, remove it with \`tailscale serve --https=${SERVE_PORT} off\`.`);
  }
  if (observed.loaded) {
    steps.push({ summary: 'Stop the service and unload it from launchd', action: { kind: 'launchctl', args: ['bootout', `${domain}/${SERVICE_LABEL}`] } });
  }
  if (observed.plistFile) {
    steps.push({ summary: `Delete ${paths.plistFile}`, action: { kind: 'remove-file', path: paths.plistFile } });
  }
  if (steps.length > 0) {
    notes.push(`Kept ${paths.caduceusDir}: the owner password, passkeys, sessions, audit log, configuration and logs. Delete it yourself to remove them too.`);
  } else if (notes.length === 0) {
    notes.push('Caduceus is not set up: nothing to remove.');
  }
  return { blockers: [], steps, notes };
}

/** What restarting the service would do: for after an upgrade, when the code on disk has changed under a running service. */
export function planRestart(spec: ServiceSpec, observed: Observed): Plan {
  if (!observed.loaded) return { blockers: ['Caduceus is not loaded in launchd. Run `npm run caduceus -- setup` first.'], steps: [], notes: [] };
  const target = `http://127.0.0.1:${spec.config.port}`;
  return {
    blockers: [],
    steps: [
      { summary: 'Restart the service, so that it runs the code now on disk', action: { kind: 'launchctl', args: ['kickstart', '-k', `gui/${spec.uid}/${SERVICE_LABEL}`] } },
      { summary: `Wait for Caduceus to answer on ${target}`, action: { kind: 'wait-healthy', url: `${target}/_caduceus/healthz` } },
    ],
    notes: [],
  };
}

/** This node's tailnet identity, as `tailscale status --json` (Tailscale 1.102) names it. */
export interface TailnetNode {
  /** The node's MagicDNS name without the trailing dot: `<node>.<tailnet>.ts.net`. */
  host: string;
  /** The login of the user the node belongs to (lower-case), if the status names one. */
  login: string | undefined;
}

/** Reads `tailscale status --json`; `undefined` when it is not JSON or the node is not signed in to a tailnet. */
export function parseTailscaleStatus(json: string): TailnetNode | undefined {
  let status: unknown;
  try {
    status = JSON.parse(json);
  } catch {
    return undefined;
  }
  const self = asRecord(asRecord(status).Self);
  if (typeof self.DNSName !== 'string' || self.DNSName === '') return undefined;
  const login = asRecord(asRecord(asRecord(status).User)[String(self.UserID)]).LoginName;
  return { host: self.DNSName.replace(/\.$/, ''), login: typeof login === 'string' ? login.toLowerCase() : undefined };
}

/** The port Caduceus listens on (loopback) unless the owner chose another. */
export const DEFAULT_PORT = 9130;

export interface ConfigChoices {
  /** What the owner typed (`--host`, repeated `--owner`, `--port`). */
  flags: { host?: string; owners: string[]; port?: number };
  /** The configuration setup wrote before, if it can be read. */
  existing?: ProductionConfig;
  /** What Tailscale says about this node. */
  detected?: TailnetNode;
}

type ChoiceSource = 'the command line' | 'the configuration already written' | 'Tailscale' | 'the default';

/**
 * Decides the configuration setup writes: what the owner typed, else what was written before (so that running setup again
 * never swaps the owners for a guess), else what Tailscale says about this node. `from` tells the owner where each value came from.
 */
export function resolveConfig({ flags, existing, detected }: ConfigChoices): { config: ProductionConfig; from: Record<'host' | 'owners' | 'port', ChoiceSource> } | { error: string } {
  const existingHost = existing && new URL(existing.publicOrigin).hostname;
  const host = flags.host ?? existingHost ?? detected?.host;
  if (!host) return { error: "Cannot tell this node's tailnet hostname. Pass it with `--host <node>.<tailnet>.ts.net`." };
  const owners = flags.owners.length > 0 ? flags.owners : (existing?.tailnetOwners ?? (detected?.login ? [detected.login] : []));
  if (owners.length === 0) return { error: "Cannot tell which Tailscale login is the owner's. Pass it with `--owner <login>` (repeat it for more than one)." };
  const port = flags.port ?? existing?.port ?? DEFAULT_PORT;
  try {
    const config = parseProductionConfig(renderProductionConfig({ port, publicOrigin: `https://${host}:${SERVE_PORT}`, rpId: host, tailnetOwners: owners }));
    return {
      config,
      from: {
        host: flags.host ? 'the command line' : existingHost ? 'the configuration already written' : 'Tailscale',
        owners: flags.owners.length > 0 ? 'the command line' : existing ? 'the configuration already written' : 'Tailscale',
        port: flags.port !== undefined ? 'the command line' : existing ? 'the configuration already written' : 'the default',
      },
    };
  } catch (error) {
    if (error instanceof ProductionConfigError) return { error: error.message };
    throw error;
  }
}

export interface LaunchdState {
  /** `running`, `waiting` (between runs), or whatever launchd names it. */
  state: string | undefined;
  pid: number | undefined;
  /** How the last run ended, as launchd words it (`1`, `(never exited)`). */
  lastExit: string | undefined;
}

/**
 * Reads what `launchctl print gui/<uid>/<label>` says of the service. It is for the owner's information only (launchd's output
 * is not a stable interface, and whether Caduceus is up is decided by asking it), so a field it cannot find is just left out.
 * The first of each field is the service's own; the nested sections after it repeat some names.
 */
export function parseLaunchctlPrint(text: string): LaunchdState {
  const field = (name: string) => new RegExp(`^\\s*${name} = (.+)$`, 'm').exec(text)?.[1].trim();
  const pid = field('pid');
  return { state: field('state'), pid: pid === undefined ? undefined : Number(pid), lastExit: field('last exit code') };
}
