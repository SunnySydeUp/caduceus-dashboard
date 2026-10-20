// Test harness for the browser seam: Caduceus server + built web app + fake Hermes on a fixed port.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../server/src/caduceus-server.ts';
import { FAKE_HERMES_ROUTES, launchFakeHermes } from '../server/test/fixtures/fake-hermes.ts';
import { ownerCookie } from '../server/test/fixtures/owner.ts';

// Must stay longer than the page needs to notice that its gateway connection dropped and ask Caduceus why, so the
// browser tests can see "Hermes restarting" before the backend is back. It is real time on purpose: these tests exercise the whole stack.
const RESTART_DELAY_MS = 1_500;
/** Set by playwright.config.ts: this run's throwaway directory, removed when the harness stops. */
const STATE_DIR = process.env.FAKE_HERMES_STATE_DIR!;

const backend = launchFakeHermes({ restartDelaysMs: [RESTART_DELAY_MS] });
const server = await startCaduceusServer({
  backend,
  // The fake Hermes has no home, so the Caduceus store gets a throwaway root home of its own.
  hermesRoot: path.join(STATE_DIR, 'hermes-root'),
  // The policy proxy denies what the pinned contract does not name; the fake Hermes's own routes are named here.
  extraRoutes: FAKE_HERMES_ROUTES,
  port: Number(process.env.E2E_PORT),
  // The built app. `E2E_WEB_ROOT` points at a build made elsewhere (`vite build --outDir`), so that a run never needs `web/dist`, which a running Caduceus may be serving.
  webRoot: process.env.E2E_WEB_ROOT ?? fileURLToPath(new URL('../web/dist', import.meta.url)),
});

// The browser tests run as the test-only owner (password `TEST_OWNER_PASSWORD`), set up here from this Mac
// exactly as the owner would, and start signed in through this Playwright storage state.
const [name, value] = (await ownerCookie(server.url)).split('=');
const cookie = { name, value, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Strict' };
fs.writeFileSync(path.join(STATE_DIR, 'owner-storage-state.json'), JSON.stringify({ cookies: [cookie], origins: [] }));
process.stdout.write(`harness ready at ${server.url}\n`);

process.on('SIGTERM', async () => {
  await server.close();
  await backend.stop();
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  process.exit(0);
});
