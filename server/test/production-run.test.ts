import { afterEach, describe, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// The service the way launchd runs it (M0 #13): `server/src/main.ts` as its own process, pointed at a production configuration
// file, in front of the real Hermes in a throwaway HERMES_HOME. Reached the way Tailscale Serve reaches it.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const HOST = 'my-mac.tail0000aa.ts.net';
const SERVE_ORIGIN = `https://${HOST}:9443`;
const OWNER_LOGIN = 'owner@example.com';
const VIA_SERVE = { 'x-forwarded-host': `${HOST}:9443`, 'x-forwarded-for': '100.101.102.103', 'x-forwarded-proto': 'https' };

interface Service {
  /** The loopback URL it listens on. */
  url: string;
  /** Everything it has written to stdout and stderr, line by line. */
  log: string[];
  /** Resolves with the first line of its log, already written or still to come, that `match` accepts. */
  waitForLog(match: (line: string) => boolean): Promise<string>;
  /** Resolves when the process has exited. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  child: ChildProcess;
}

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  try {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    }
  } finally {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

async function freePort(): Promise<number> {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as net.AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

/** Starts `main.ts` with this configuration file text; the HERMES_HOME is a fresh temp dir. */
function startService(configText: string | undefined): Service {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-production-'));
  dirs.push(home);
  const configFile = path.join(home, 'production-config.json');
  if (configText !== undefined) fs.writeFileSync(configFile, configText);
  const child = spawn(process.execPath, [TSX, path.join(ROOT, 'server/src/main.ts')], {
    cwd: ROOT,
    env: { ...process.env, HERMES_HOME: home, CADUCEUS_CONFIG: configFile, CADUCEUS_PORT: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const log: string[] = [];
  const waiting = new Set<{ match: (line: string) => boolean; resolve: (line: string) => void }>();
  for (const stream of [child.stdout!, child.stderr!]) {
    readline.createInterface({ input: stream }).on('line', (line) => {
      log.push(line);
      for (const waiter of waiting) {
        if (!waiter.match(line)) continue;
        waiting.delete(waiter);
        waiter.resolve(line);
      }
    });
  }
  const { promise: exited, resolve: onExit } = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
  // `close`, not `exit`: it comes after the output streams have ended, so the log is complete.
  child.on('close', (code, signal) => onExit({ code, signal }));
  const waitForLog = (match: (line: string) => boolean) => {
    const seen = log.find(match);
    if (seen) return Promise.resolve(seen);
    const { promise, resolve } = Promise.withResolvers<string>();
    waiting.add({ match, resolve });
    return promise;
  };
  return { url: '', log, waitForLog, exited, child };
}

async function startReadyService(config: object): Promise<Service> {
  const service = startService(JSON.stringify(config));
  const line = await Promise.race([
    service.waitForLog((l) => l.includes('Caduceus Dashboard at ')),
    service.exited.then(({ code }) => {
      throw new Error(`Caduceus exited with ${code} before it was ready:\n${service.log.join('\n')}`);
    }),
  ]);
  return { ...service, url: line.slice(line.indexOf('http')) };
}

describe('the production service', () => {
  test('serves on the configured loopback port, with the configured origin and RP ID; through Serve only an owner login gets in, and a refusal is logged once', async () => {
    const port = await freePort();
    const service = await startReadyService({ port, publicOrigin: SERVE_ORIGIN, rpId: HOST, tailnetOwners: [OWNER_LOGIN] });

    const fromThisMac = await fetch(`${service.url}/_caduceus/healthz`);
    const asIntruder = () => fetch(`${service.url}/sign-in`, { headers: { ...VIA_SERVE, 'tailscale-user-login': 'intruder@example.com' } });
    const refusedFirst = await asIntruder();
    const refusedAgain = await asIntruder();
    const asOwner = await fetch(`${service.url}/sign-in`, { headers: { ...VIA_SERVE, 'tailscale-user-login': OWNER_LOGIN } });
    // A passkey ceremony from the Serve origin: the origin is accepted (an unsafe request) and the RP ID is the tailnet hostname.
    const passkey = await fetch(`${service.url}/_caduceus/api/auth/passkey-sign-in/options`, {
      method: 'POST',
      headers: { ...VIA_SERVE, 'tailscale-user-login': OWNER_LOGIN, origin: SERVE_ORIGIN, 'content-type': 'application/json' },
      body: '{}',
    });
    // The log is one ordered stream: once the last refusal is in it, every earlier one is too.
    await fetch(`${service.url}/sign-in`, { headers: { ...VIA_SERVE, 'tailscale-user-login': 'last@example.com' } });
    await service.waitForLog((line) => line.includes('tailnet:last@example.com'));

    expect(service.url).toBe(`http://127.0.0.1:${port}`);
    expect([fromThisMac.status, refusedFirst.status, refusedAgain.status, asOwner.status, passkey.status]).toEqual([200, 403, 403, 200, 200]);
    expect(await passkey.json()).toMatchObject({ rpId: HOST });
    expect(service.log.filter((line) => line.includes('tailnet:intruder@example.com'))).toEqual([
      '[caduceus] Refused a request through Tailscale Serve from tailnet:intruder@example.com: not one of the owners in tailnetOwners.',
    ]);
  }, 60_000);

  test('does not start when its configuration is missing or cannot be used: it exits with the reason and listens on nothing', async () => {
    const port = await freePort();
    const missing = startService(undefined);
    const noOwners = startService(JSON.stringify({ port, publicOrigin: SERVE_ORIGIN, rpId: HOST, tailnetOwners: [] }));

    const exits = await Promise.all([missing.exited, noOwners.exited]);

    expect(exits.map(({ code }) => code)).toEqual([1, 1]);
    const ours = (service: Service) => service.log.filter((line) => line.startsWith('[caduceus]'));
    expect(ours(missing)).toEqual([expect.stringMatching(/^\[caduceus\] Not starting: The configuration cannot be read \(ENOENT\)\. \(.*production-config\.json\)$/)]);
    expect(ours(noOwners)).toEqual([
      expect.stringMatching(/^\[caduceus\] Not starting: "tailnetOwners" must list at least one Tailscale login: with none, nobody could reach Caduceus\. \(.*production-config\.json\)$/),
    ]);
    await expect(fetch(`http://127.0.0.1:${port}/_caduceus/healthz`)).rejects.toThrow();
  });
});
