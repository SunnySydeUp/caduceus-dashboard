// Caduceus Dashboard server: launches a private Hermes backend and serves the web app on loopback.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hostStateDir, launchHermesBackend } from './hermes-backend.ts';
import { startCaduceusServer } from './caduceus-server.ts';
import { findHermesInstall } from './hermes-contract.ts';
import { hermesRootHome } from './hermes-root-home.ts';
import { parseProductionConfig, ProductionConfigError, type ProductionConfig } from './production-config.ts';

// `CADUCEUS_CONFIG` names the production configuration file (`caduceus setup` writes it and starts the service with it): the
// port, the Tailscale Serve origin and RP ID, and the owner's Tailscale logins. Without it this is development: plain
// loopback, and no requirement on who is behind Serve. An unusable file stops the service rather than starting it open.
let production: ProductionConfig | undefined;
const configFile = process.env.CADUCEUS_CONFIG;
if (configFile) {
  try {
    production = parseProductionConfig(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    const reason = error instanceof ProductionConfigError ? error.message : `The configuration cannot be read (${(error as NodeJS.ErrnoException).code ?? error}).`;
    console.error(`[caduceus] Not starting: ${reason} (${configFile})`);
    process.exit(1);
  }
}

const command = process.env.CADUCEUS_HERMES_COMMAND ?? 'hermes';
// Without it the compatibility report says the gateway contract is unavailable; Caduceus still starts.
const install = await findHermesInstall(command).catch((error: Error) => {
  console.warn(`[caduceus] Could not locate the Hermes install: ${error.message}`);
  return undefined;
});

const backend = launchHermesBackend({ command, sharedHostState: hostStateDir(process.env) });
backend.on('status', (status) => console.log(`[caduceus] Hermes backend: ${JSON.stringify(status)}`));
backend.on('log', (text) => process.stderr.write(text));

// A request refused for its tailnet identity is logged once per source, so a wrong owner login shows up in the log without a
// flood of requests filling it.
const refusedSources = new Set<string>();
// Only the background service is supervised (launchd starts it again whenever it stops: `KeepAlive`), so only it can restart itself after its own
// update. A development server that stopped itself would simply be gone.
const supervised = production !== undefined;
const server = await startCaduceusServer({
  backend,
  // The same HERMES_HOME the private backend runs with; its root home holds the Caduceus store (`caduceus/`).
  hermesRoot: hermesRootHome(process.env),
  port: production?.port ?? Number(process.env.CADUCEUS_PORT ?? 9130),
  publicOrigin: production?.publicOrigin,
  rpId: production?.rpId,
  tailnetOwners: production?.tailnetOwners,
  onTailnetRefusal(source) {
    if (refusedSources.has(source) || refusedSources.size >= 100) return;
    refusedSources.add(source);
    console.warn(`[caduceus] Refused a request through Tailscale Serve from ${source}: not one of the owners in tailnetOwners.`);
  },
  webRoot: fileURLToPath(new URL('../../web/dist', import.meta.url)),
  hermesInstallDir: install?.dir,
  deployment: { root: fileURLToPath(new URL('../..', import.meta.url)) },
  restart: supervised ? () => stop() : undefined,
  hermesUpdateCheck: true,
  playbookEngine: {},
  budgetGuard: {},
});
console.log(`[caduceus] Caduceus Dashboard at ${server.url}`);

async function stop(): Promise<never> {
  await server.close();
  await backend.stop();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop());
