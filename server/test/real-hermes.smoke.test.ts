import { afterEach, expect, test } from 'vitest';
import { launchHermesBackend, type HermesBackend } from '../src/hermes-backend.ts';

// Opt-in (`npm run smoke:real`): proves the fake Hermes matches the real launcher contract.
// Launches one private `hermes serve` on loopback; never touches the running dashboard or gateway.
let backend: HermesBackend | undefined;
afterEach(async () => {
  await backend?.stop();
});

test.skipIf(!process.env.HERMES_REAL_SMOKE)(
  'real `hermes serve` honours the launch contract the fake Hermes imitates',
  { timeout: 60_000 },
  async () => {
    backend = launchHermesBackend({ command: 'hermes' });
    await backend.ready();

    const status = await (await backend.fetch('/api/status')).json();
    const profiles = await backend.fetch('/api/profiles');

    expect(typeof status.version).toBe('string');
    expect(typeof status.gateway_state).toBe('string');
    expect(profiles.status).toBe(200);
    expect(Array.isArray((await profiles.json()).profiles)).toBe(true);
  },
);
