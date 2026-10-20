import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

// The web app's tests alone, for machines without Hermes (CI). They need none: the global setup that prepares the shared Hermes installs
// (`run-temp-root.ts`, which runs `hermes --version`) is for the server tests, so it is left out here.
export default defineConfig({
  ...base,
  test: { ...base.test, include: ['web/test/**/*.test.ts'], globalSetup: [] },
});
