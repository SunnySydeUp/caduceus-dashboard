import { describe, expect, test } from 'vitest';
import { setupChecks, type SetupInput } from '../src/modules/onboarding/setup-checks.ts';

// What the wizard's first step says of Hermes (from `setup.status` and `setup.runtime_check`) and of Caduceus's own state.
const healthy: SetupInput = {
  hermesReachable: true,
  status: { provider_configured: true, ready: true },
  runtime: { ok: true, provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
  gateway: { running: true },
  connection: 'https',
  installed: true,
  passkeys: 2,
};

const byId = (input: SetupInput) => Object.fromEntries(setupChecks(input).map((check) => [check.id, check]));

describe('setupChecks', () => {
  test('lists every check once, in the order the wizard shows them, and passes them all on a set-up install', () => {
    const checks = setupChecks(healthy);
    expect(checks.map((check) => check.id)).toEqual(['hermes', 'provider', 'gateway', 'https', 'install', 'passkey']);
    expect(checks.map((check) => check.state)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(byId(healthy).provider!.detail).toBe('openrouter is ready with anthropic/claude-sonnet-4.');
  });

  test('a provider fails with Hermes\'s own words: its strict check first, then the loose one, and says so when Hermes cannot be asked', () => {
    const failing = { ...healthy, runtime: { ok: false, provider: 'anthropic', error: 'No usable credentials found for anthropic.' } };
    expect(byId(failing).provider).toMatchObject({ state: 'fail', detail: 'No usable credentials found for anthropic.', fix: { to: '/system/keys' } });

    const none = { ...healthy, status: { provider_configured: false }, runtime: undefined };
    expect(byId(none).provider).toMatchObject({ state: 'fail', detail: 'No provider is configured yet.' });

    const unknown = { ...healthy, status: undefined, runtime: undefined };
    expect(byId(unknown).provider).toMatchObject({ state: 'fail', detail: 'Hermes did not say whether a provider is configured.' });

    const free = { ...healthy, runtime: { ok: true, provider: 'nous', model: 'hermes-4', free_tier_route: true } };
    expect(byId(free).provider!.detail).toBe('nous is ready with hermes-4, on Hermes\u2019s free tier.');
  });

  test('when Hermes does not answer, that one fails and nothing Hermes would say is trusted', () => {
    const down: SetupInput = { ...healthy, hermesReachable: false, status: undefined, runtime: undefined, gateway: undefined };
    const checks = byId(down);
    expect(checks.hermes).toMatchObject({ state: 'fail', fix: { to: '/observe/health' } });
    expect(checks.provider!.state).toBe('fail');
    expect(checks.gateway).toMatchObject({ state: 'fail', detail: 'Hermes did not say whether the gateway is running.' });
    // What Caduceus knows itself is still shown.
    expect(checks.https!.state).toBe('pass');
  });

  test('the gateway, the connection, the install and the passkey each fail with a fix that leads to where it is done', () => {
    const checks = byId({ ...healthy, gateway: { running: false }, connection: 'insecure', installed: false, passkeys: 0 });
    expect(checks.gateway).toMatchObject({ state: 'fail', fix: { to: '/connect/gateway' } });
    expect(checks.https).toMatchObject({ state: 'fail' });
    expect(checks.install).toMatchObject({ state: 'fail', fix: { to: '/settings/install' } });
    expect(checks.passkey).toMatchObject({ state: 'fail', fix: { to: '/system/security' } });
    expect(byId({ ...healthy, passkeys: undefined }).passkey).toMatchObject({ state: 'fail', detail: 'Caduceus could not read your passkeys.' });
  });

  test('the Hermes checks are required and the rest are advice; this Mac over localhost passes the connection check and says a phone needs HTTPS', () => {
    const checks = byId({ ...healthy, connection: 'local' });
    expect([checks.hermes, checks.provider].map((check) => check.need)).toEqual(['required', 'required']);
    expect([checks.gateway, checks.https, checks.install, checks.passkey].map((check) => check.need)).toEqual(['recommended', 'recommended', 'recommended', 'recommended']);
    expect(checks.https).toMatchObject({ state: 'pass' });
    expect(checks.https!.detail).toMatch(/phone.*HTTPS/);
  });
});
