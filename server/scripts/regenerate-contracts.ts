// `npm run contracts:regenerate`: re-pins Caduceus to the installed Hermes, all in one go:
//   - contracts/hermes/openapi.json         REST contract, from a private `hermes serve` in a throwaway HERMES_HOME
//                                           (so the owner's own plugins never leak into the pin)
//   - contracts/hermes/rest.generated.ts    TypeScript types generated from it
//   - contracts/vendor/hermes-shared/       Hermes's @hermes/shared (MIT), incl. the gateway contract (OpenRPC + types)
//   - contracts/hermes/pin.json             the Hermes version and the gateway markers it advertised
// Afterwards run `npm test`: the compatibility test asserts the new pin, so update its expected version and markers.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACTS_DIR, GATEWAY_CONTRACT_IN_INSTALL, PINNED_FILES, readGatewayMarkers, type HermesPin } from '../src/hermes-contract.ts';
import { launchTestHermes } from '../test/fixtures/real-hermes.ts';

// openapi-typescript drives the TypeScript 5 compiler API, which the repo's TypeScript 7 lacks; npx runs it isolated.
const OPENAPI_TYPESCRIPT = ['--yes', '-p', 'openapi-typescript@7.13.0', '-p', 'typescript@5.9.3', 'openapi-typescript'];

const contracts = fileURLToPath(CONTRACTS_DIR);
const hermes = await launchTestHermes();
try {
  await hermes.backend.ready();
  const { dir, ...version } = hermes.install;

  const openapi = await (await hermes.backend.fetch('/openapi.json')).json();
  const markers = await readGatewayMarkers(hermes.backend);
  // Hermes reports desktop_contract only per session; the pin takes it from the constant every session reports.
  const serverSource = fs.readFileSync(path.join(dir, 'tui_gateway/server.py'), 'utf8');
  const desktopContract = /^DESKTOP_BACKEND_CONTRACT = (\d+)$/m.exec(serverSource);
  if (!desktopContract) throw new Error('DESKTOP_BACKEND_CONTRACT not found in tui_gateway/server.py');
  markers.desktopContract = Number(desktopContract[1]);

  const vendor = path.join(contracts, path.dirname(path.dirname(PINNED_FILES.gateway)));
  fs.rmSync(vendor, { recursive: true, force: true });
  fs.cpSync(path.join(dir, 'apps/shared/src'), path.join(vendor, 'src'), {
    recursive: true,
    filter: (source) => !/\.test(-d)?\.ts$/.test(source),
  });
  fs.copyFileSync(path.join(dir, 'apps/shared/package.json'), path.join(vendor, 'package.json'));
  fs.copyFileSync(path.join(dir, 'LICENSE'), path.join(vendor, 'LICENSE'));
  if (!fs.existsSync(path.join(contracts, PINNED_FILES.gateway))) {
    throw new Error(`${GATEWAY_CONTRACT_IN_INSTALL} is missing from the Hermes install`);
  }

  const restFile = path.join(contracts, PINNED_FILES.rest);
  fs.mkdirSync(path.dirname(restFile), { recursive: true });
  fs.writeFileSync(restFile, `${JSON.stringify(openapi, null, 2)}\n`);
  execFileSync('npx', [...OPENAPI_TYPESCRIPT, restFile, '-o', path.join(contracts, 'hermes/rest.generated.ts')], {
    stdio: 'inherit',
  });

  const pin: HermesPin = { hermes: version, markers };
  fs.writeFileSync(path.join(contracts, PINNED_FILES.pin), `${JSON.stringify(pin, null, 2)}\n`);
  console.log(`Pinned Hermes ${version.version} (${version.releaseDate}) from ${dir}`);
} finally {
  await hermes.stop();
}
