import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// E2E_PORT lets parallel worktrees run the suite side by side.
const PORT = Number(process.env.E2E_PORT ?? 4317);
// The run's throwaway directory (the harness removes it when it stops). The fake Hermes records `{ pid, token }`
// per launch here, which tests read to kill Hermes and to know the secret; the harness keeps its Caduceus store here.
const FAKE_HERMES_STATE_DIR = (process.env.FAKE_HERMES_STATE_DIR ??= fs.mkdtempSync(
  path.join(os.tmpdir(), 'caduceus-e2e-'),
));

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  // Every page starts signed in as the harness's test-only owner (see e2e/harness.ts).
  use: { baseURL: `http://127.0.0.1:${PORT}`, storageState: path.join(FAKE_HERMES_STATE_DIR, 'owner-storage-state.json') },
  projects: [
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npx tsx e2e/harness.ts',
    url: `http://127.0.0.1:${PORT}/_caduceus/api/auth/session`,
    // Printed only once the owner's storage state is written.
    wait: { stdout: /harness ready at/ },
    env: { E2E_PORT: String(PORT), FAKE_HERMES_STATE_DIR },
    reuseExistingServer: false,
    // Playwright's default is SIGKILL, which skips the harness's clean-up (stopping Hermes, removing the run's directory).
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
