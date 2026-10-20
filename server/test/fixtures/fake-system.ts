// A stand-in machine for tests of the `caduceus` command (M0 #13): a temp home and project, and fake `launchctl`, `tailscale` and
// `hermes` programs that are the only ones on the command's PATH. The fakes keep their state in files and log every call, so a test
// can see exactly what the command asked of them: a command that would change launchd or Tailscale can never reach the real ones.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { CliIo } from '../../src/service-cli.ts';

export const HOST = 'my-mac.tail0000aa.ts.net';
export const UID = 501;

/** The serve config of the Mac the tests describe before Caduceus: only the public Funnel on 443. */
export const FUNNEL_ONLY = {
  TCP: { '443': { HTTPS: true } },
  Web: { [`${HOST}:443`]: { Handlers: { '/': { Proxy: 'http://localhost:2283' } } } },
  AllowFunnel: { [`${HOST}:443`]: true },
};

const FAKE_LAUNCHCTL = `
const fs = require('node:fs');
const path = require('node:path');
const state = process.env.FAKE_STATE;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(state, 'calls.log'), 'launchctl ' + args.join(' ') + '\\n');
const loaded = path.join(state, 'loaded');
if (args[0] === 'print') {
  if (!fs.existsSync(loaded)) { console.error('Could not find service'); process.exit(113); }
  console.log('state = running\\n\\tpid = 4242\\n\\tlast exit code = (never exited)');
} else if (args[0] === 'bootstrap') {
  if (fs.existsSync(loaded)) { console.error('Bootstrap failed: 5: Input/output error'); process.exit(5); }
  fs.writeFileSync(loaded, '');
} else if (args[0] === 'bootout') {
  fs.rmSync(loaded, { force: true });
} else if (args[0] !== 'kickstart') {
  process.exit(64);
}
`;

const FAKE_TAILSCALE = `
const fs = require('node:fs');
const path = require('node:path');
const state = process.env.FAKE_STATE;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(state, 'calls.log'), 'tailscale ' + args.join(' ') + '\\n');
const serveFile = path.join(state, 'serve.json');
const serve = () => JSON.parse(fs.readFileSync(serveFile, 'utf8'));
const host = JSON.parse(fs.readFileSync(path.join(state, 'status.json'), 'utf8')).Self.DNSName.replace(/\\.$/, '');
const line = args.join(' ');
if (line === 'serve status --json') {
  process.stdout.write(fs.readFileSync(serveFile, 'utf8'));
} else if (line === 'status --json') {
  process.stdout.write(fs.readFileSync(path.join(state, 'status.json'), 'utf8'));
} else if (args[0] === 'serve' && args[1] === '--bg' && /^--https=\\d+$/.test(args[2])) {
  const port = args[2].slice('--https='.length);
  const config = serve();
  config.TCP[port] = { HTTPS: true };
  config.Web[host + ':' + port] = { Handlers: { '/': { Proxy: args[3] } } };
  fs.writeFileSync(serveFile, JSON.stringify(config));
  console.log('Available within your tailnet:\\n\\nhttps://' + host + ':' + port + '/\\n|-- proxy ' + args[3]);
} else if (args[0] === 'serve' && /^--https=\\d+$/.test(args[1]) && args[2] === 'off') {
  const port = args[1].slice('--https='.length);
  const config = serve();
  delete config.TCP[port];
  delete config.Web[host + ':' + port];
  fs.writeFileSync(serveFile, JSON.stringify(config));
} else {
  console.error('fake tailscale: unexpected arguments: ' + line);
  process.exit(64);
}
`;

export interface FakeSystem {
  home: string;
  projectRoot: string;
  /** The environment of a process that should see only this machine: its PATH holds the fake programs and nothing else. */
  env: Record<string, string>;
  /** Every call to the fake `launchctl` and `tailscale`, in order, as `launchctl print gui/501/…`. */
  calls(): string[];
  /** The calls that can change something: everything but `launchctl print`, `tailscale serve status --json` and `tailscale status --json`. */
  mutations(): string[];
  /** What `tailscale serve status --json` answers now. */
  serve(): unknown;
  setServe(config: object): void;
  /** Whether the fake launchd has the service loaded. */
  loaded(): boolean;
  /** An Io for `runCli` as the owner's shell would give it: this home, these programs, this much input. */
  io(options?: { input?: string; interactive?: boolean; healthTimeoutMs?: number; withoutTailscale?: boolean }): { io: CliIo; output(): string };
  cleanup(): void;
}

/** Writes an executable that runs under this process's Node (a shebang naming it, since the command's PATH has no `env node`). */
function writeProgram(dir: string, name: string, source: string): void {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${source}`, { mode: 0o755 });
}

export function fakeSystem(): FakeSystem {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-fake-system-'));
  const home = path.join(root, 'home');
  const projectRoot = path.join(root, 'caduceus');
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'state');
  for (const dir of [home, bin, state, path.join(projectRoot, 'web', 'dist'), path.join(projectRoot, 'node_modules', 'tsx', 'dist')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'web', 'dist', 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs'), '');
  writeProgram(bin, 'launchctl', FAKE_LAUNCHCTL);
  writeProgram(bin, 'tailscale', FAKE_TAILSCALE);
  writeProgram(bin, 'hermes', 'process.exit(0);\n');
  fs.writeFileSync(path.join(state, 'calls.log'), '');
  fs.writeFileSync(path.join(state, 'serve.json'), JSON.stringify(FUNNEL_ONLY));
  fs.writeFileSync(
    path.join(state, 'status.json'),
    JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${HOST}.`, UserID: 1 }, User: { '1': { ID: 1, LoginName: 'Owner@Example.com' } } }),
  );

  const env = { PATH: bin, HOME: home, FAKE_STATE: state };
  const calls = () => fs.readFileSync(path.join(state, 'calls.log'), 'utf8').split('\n').filter(Boolean);
  const readOnly = new Set([`launchctl print gui/${UID}/dev.caduceus.dashboard`, 'tailscale serve status --json', 'tailscale status --json']);
  return {
    home,
    projectRoot,
    env,
    calls,
    mutations: () => calls().filter((call) => !readOnly.has(call)),
    serve: () => JSON.parse(fs.readFileSync(path.join(state, 'serve.json'), 'utf8')),
    setServe: (config) => fs.writeFileSync(path.join(state, 'serve.json'), JSON.stringify(config)),
    loaded: () => fs.existsSync(path.join(state, 'loaded')),
    io({ input = '', interactive = false, healthTimeoutMs, withoutTailscale = false } = {}) {
      let output = '';
      if (withoutTailscale) fs.rmSync(path.join(bin, 'tailscale'), { force: true });
      const io: CliIo = {
        env: { ...env },
        home,
        uid: UID,
        platform: 'darwin',
        nodePath: process.execPath,
        projectRoot,
        stdout: (text) => (output += text),
        stdin: Readable.from(input ? [input] : []),
        interactive,
        healthTimeoutMs,
      };
      return { io, output: () => output };
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}

/** A stand-in for the running service: answers the liveness probe the way Caduceus does. */
export async function startFakeService(): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/_caduceus/healthz') res.setHeader('content-type', 'application/json').end('{"ok":true}');
    else res.writeHead(404).end();
  });
  const { promise: listening, resolve } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', resolve);
  await listening;
  return {
    port: (server.address() as AddressInfo).port,
    async close() {
      const { promise: closed, resolve: done } = Promise.withResolvers<void>();
      server.close(() => done());
      await closed;
    },
  };
}
