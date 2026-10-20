// Shared helpers for tests that run Caduceus against the fake Hermes (`fake-hermes.mjs`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Policy } from '@caduceus/contracts/policy/tiers';
import { launchHermesBackend, type HermesBackend, type LaunchOptions } from '../../src/hermes-backend.ts';
import { GATEWAY_CONTRACT_IN_INSTALL } from '../../src/hermes-contract.ts';

export const FAKE_HERMES = fileURLToPath(new URL('./fake-hermes.mjs', import.meta.url));

/**
 * The policy of the routes only the fake Hermes has, for a Caduceus server in front of it (`extraRoutes`): the policy
 * proxy denies whatever the pinned contract does not name. `/api/does-not-exist` lets a test see Hermes's own 404.
 */
export const FAKE_HERMES_ROUTES: Record<string, Policy> = {
  'GET /api/__fake/echo': { tier: 'T0', read: true },
  'GET /api/__fake/leak': { tier: 'T0', read: true },
  'GET /api/__fake/log-flood': { tier: 'T0', read: true },
  'GET /api/does-not-exist': { tier: 'T0', read: true },
};

/** What the fake Hermes records about each launch (a test-only side channel). */
export interface FakeLaunch {
  pid: number;
  token: string;
}

/** Launches the fake Hermes through the real launcher, exactly as Caduceus launches `hermes`. */
export function launchFakeHermes(options: Omit<LaunchOptions, 'command' | 'args'> = {}): HermesBackend {
  return launchHermesBackend({ command: process.execPath, args: [FAKE_HERMES], ...options });
}

/**
 * Sets what the fake's status endpoints answer (`PUT /api/__fake/answers`), by path: `{ '/api/status': { gateway_running: false } }`.
 * Whatever is not set answers as a healthy, idle Hermes does; `null` takes a path back to that.
 */
export async function scriptFakeHermes(backend: HermesBackend, answers: Record<string, unknown>): Promise<void> {
  const res = await backend.fetch('/api/__fake/answers', { method: 'PUT', body: JSON.stringify(answers) });
  if (!res.ok) throw new Error(`Scripting the fake Hermes: HTTP ${res.status}`);
}

/** A fresh directory for the fake to record its launches in (pass as `FAKE_HERMES_STATE_DIR`). */
export function fakeStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fake-hermes-'));
}

/** Launch `n` (1-based) recorded in `dir`, or the newest launch when `n` is omitted. */
export function fakeLaunch(dir: string, n?: number): FakeLaunch {
  const launches = fs.readdirSync(dir).filter((f) => f.startsWith('launch-')).length;
  return JSON.parse(fs.readFileSync(path.join(dir, `launch-${n ?? launches}.json`), 'utf8'));
}

/**
 * A directory shaped like a Hermes install that publishes exactly the gateway contract Caduceus pins (the fake Hermes has no
 * install of its own), for `hermesInstallDir`: with it, Caduceus finds the fake fully compatible. The test deletes it.
 */
export function fakeHermesInstall(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-hermes-install-'));
  const file = path.join(dir, GATEWAY_CONTRACT_IN_INSTALL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL('../../../contracts/vendor/hermes-shared/src/gateway-contract.openrpc.json', import.meta.url)), file);
  return dir;
}
