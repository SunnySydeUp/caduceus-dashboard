// Hermes's contracts: the pinned copies Caduceus builds against, and the live ones of the running Hermes.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CompatibilityReport, ContractChanges, GatewayMarkers } from '@caduceus/contracts/caduceus-api';
import type { BackendGatewayEventMap, RpcMethods } from '@caduceus/contracts/hermes/gateway';
import {
  contractDrift,
  diffGatewayContracts,
  diffRestContracts,
  type OpenApiDocument,
  type OpenRpcDocument,
} from './contract-diff.ts';
import type { HermesBackend } from './hermes-backend.ts';

/** An installed Hermes, as `hermes --version` describes it. */
export interface HermesInstall {
  version: string;
  releaseDate: string;
  /** The git commit of a git install, if Hermes reports one. */
  upstreamCommit: string | null;
  /** Where Hermes is installed; it publishes its gateway contract there (`GATEWAY_CONTRACT_IN_INSTALL`). */
  dir: string;
}

/** `contracts/hermes/pin.json`: which Hermes the pins came from, and the gateway markers it advertised. */
export interface HermesPin {
  hermes: Omit<HermesInstall, 'dir'>;
  markers: GatewayMarkers;
}

/** One complete set of Hermes contracts. */
export interface HermesContracts {
  version: string;
  rest: OpenApiDocument;
  gateway: OpenRpcDocument;
  markers: GatewayMarkers;
}

/** Hermes's generated gateway contract, relative to its install directory (`scripts/gen_gateway_contracts.py`). */
export const GATEWAY_CONTRACT_IN_INSTALL = 'apps/shared/src/gateway-contract.openrpc.json';

/** The pinned files, relative to the contracts workspace. */
export const PINNED_FILES = {
  pin: 'hermes/pin.json',
  rest: 'hermes/openapi.json',
  gateway: 'vendor/hermes-shared/src/gateway-contract.openrpc.json',
};

export const CONTRACTS_DIR = new URL('../../contracts/', import.meta.url);

const GATEWAY_ANSWER_TIMEOUT_MS = 10_000;

/** Asks Hermes's own CLI (`<command> --version`) which version is installed and where. */
export async function findHermesInstall(command: string, env?: NodeJS.ProcessEnv): Promise<HermesInstall> {
  const { stdout } = await promisify(execFile)(command, ['--version'], { env: { ...process.env, ...env } });
  // e.g. "Hermes Agent v0.21.4 (2026.9.21) · upstream 2e1afdf0", or, for a build after a release, "Hermes Agent v0.22.2+1979.g5fc490e (2026.9.24) · stable ..."
  // then "Install directory: /path". The version is the release (what Hermes's own API reports), without the build that follows a `+`.
  const banner = /Hermes Agent v([^\s+]+)(?:\+\S+)? \(([^)]+)\)(?: · upstream (\w+))?/.exec(stdout);
  const dir = /^Install directory: (.+)$/m.exec(stdout);
  if (!banner || !dir) throw new Error(`Unrecognised \`${command} --version\` output:\n${stdout}`);
  return { version: banner[1], releaseDate: banner[2], upstreamCommit: banner[3] ?? null, dir: dir[1] };
}

/** The contracts Caduceus was built against (written by `npm run contracts:regenerate`). */
export async function loadPinnedContracts(): Promise<HermesContracts> {
  const [pin, rest, gateway] = await Promise.all(
    [PINNED_FILES.pin, PINNED_FILES.rest, PINNED_FILES.gateway].map(async (file) =>
      JSON.parse(await fs.readFile(new URL(file, CONTRACTS_DIR), 'utf8')),
    ),
  );
  const { hermes, markers }: HermesPin = pin;
  return { version: hermes.version, rest, gateway, markers };
}

/** Reads the gateway's capability markers over a short-lived `/api/ws` connection. Creates no session. */
export async function readGatewayMarkers(backend: HermesBackend): Promise<GatewayMarkers> {
  const socket = await backend.openGateway();
  const { promise, resolve, reject } = Promise.withResolvers<GatewayMarkers>();
  const timer = setTimeout(
    () => reject(new Error(`the gateway did not answer within ${GATEWAY_ANSWER_TIMEOUT_MS} ms`)),
    GATEWAY_ANSWER_TIMEOUT_MS,
  );
  let ready: BackendGatewayEventMap['gateway.ready'] | undefined;
  socket.addEventListener('message', ({ data }) => {
    let frame;
    try {
      frame = JSON.parse(String(data));
    } catch (error) {
      reject(error);
      return;
    }
    // Frame 1 is always the `gateway.ready` event; then ask what this build enforces.
    if (frame.method === 'event' && frame.params?.type === 'gateway.ready') {
      ready = frame.params.payload;
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gateway.capabilities', params: {} }));
      return;
    }
    if (frame.id !== 1 || !ready) return;
    if (frame.error) {
      reject(new Error(`gateway.capabilities failed: ${frame.error.message}`));
      return;
    }
    const capabilities: RpcMethods['gateway.capabilities']['result'] = frame.result;
    resolve({
      replayEpoch: typeof ready.replay_epoch === 'string' && ready.replay_epoch !== '',
      heartbeat: ready.heartbeat === true,
      changeEvents: ready.change_events === true,
      capabilities: { ...capabilities },
      // Only session.info carries it; M1 compares it when Caduceus's first session reports it.
      desktopContract: null,
    });
  });
  socket.addEventListener('error', () => reject(new Error('the gateway connection failed')));
  socket.addEventListener('close', ({ code }) => reject(new Error(`the gateway closed the connection (${code})`)));
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}

/**
 * Compares the running Hermes with the pinned contracts: its REST contract (`/openapi.json`), the gateway contract
 * its install publishes, and the gateway's live markers. Never throws: whatever cannot be read becomes a reason.
 */
export async function checkCompatibility(
  backend: HermesBackend,
  pinned: HermesContracts,
  hermesInstallDir: string | undefined,
): Promise<CompatibilityReport> {
  const reasons: string[] = [];
  const noChanges: ContractChanges = { added: [], removed: [], changed: [] };
  const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

  let rest = noChanges;
  let hermesVersion: string | null = null;
  try {
    const res = await backend.fetch('/openapi.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const live: OpenApiDocument = await res.json();
    hermesVersion = live.info?.version ?? null;
    rest = diffRestContracts(pinned.rest, live);
  } catch (error) {
    reasons.push(`REST contract unavailable: ${failure(error)}`);
  }

  let gateway = noChanges;
  try {
    if (!hermesInstallDir) throw new Error('Hermes install directory unknown');
    const file = path.join(hermesInstallDir, GATEWAY_CONTRACT_IN_INSTALL);
    const live: OpenRpcDocument = JSON.parse(await fs.readFile(file, 'utf8'));
    gateway = diffGatewayContracts(pinned.gateway, live);
  } catch (error) {
    reasons.push(`Gateway contract unavailable: ${failure(error)}`);
  }

  let liveMarkers: GatewayMarkers | null = null;
  try {
    liveMarkers = await readGatewayMarkers(backend);
  } catch (error) {
    reasons.push(`Gateway markers unavailable: ${failure(error)}`);
  }

  reasons.push(...contractDrift({ rest, gateway, markers: { pinned: pinned.markers, live: liveMarkers } }));
  return {
    state: reasons.length ? 'incompatible' : 'compatible',
    pinnedVersion: pinned.version,
    hermesVersion,
    reasons,
    rest,
    gateway,
    markers: { pinned: pinned.markers, live: liveMarkers },
  };
}

/**
 * The desktop contract number a frame from Hermes carries: the `info` of a `session.create` / `session.resume` /
 * `session.activate` result, or the payload of a `session.info` event. `undefined` for any other frame.
 */
export function desktopContractIn(frame: unknown): number | undefined {
  const { result, params } = (typeof frame === 'object' && frame !== null ? frame : {}) as { result?: { info?: { desktop_contract?: unknown } }; params?: { type?: unknown; payload?: { desktop_contract?: unknown } } };
  const number = result?.info?.desktop_contract ?? (params?.type === 'session.info' ? params.payload?.desktop_contract : undefined);
  return typeof number === 'number' ? number : undefined;
}

/**
 * The report with the desktop contract number a session reported put on its live markers (Hermes says it only per session,
 * so the startup check cannot), and the verdict worked out again: a number that is not the pinned one is drift. A report that
 * has no live markers to put it on (still checking, or the markers could not be read) is returned as it is.
 */
export function withDesktopContract(report: CompatibilityReport, desktopContract: number): CompatibilityReport {
  if (report.state === 'checking' || !report.markers.live) return report;
  const markers = { pinned: report.markers.pinned, live: { ...report.markers.live, desktopContract } };
  // What was said about the number before is replaced; every other reason stays (what could not be read is not drift, and stays too).
  const reasons = [...report.reasons.filter((reason) => !reason.startsWith(DESKTOP_CONTRACT_REASON)), ...contractDrift({ rest: report.rest, gateway: report.gateway, markers }).filter((reason) => reason.startsWith(DESKTOP_CONTRACT_REASON))];
  return { ...report, state: reasons.length ? 'incompatible' : 'compatible', reasons, markers };
}

const DESKTOP_CONTRACT_REASON = 'Gateway marker changed: desktop contract';
