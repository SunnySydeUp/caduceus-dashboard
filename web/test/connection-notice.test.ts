import { describe, expect, it } from 'vitest';
import { connectionBanner, type ConnectionFacts } from '../src/shell/connection-notice.ts';

const HEALTHY: ConnectionFacts = { online: true, state: 'connected', attempt: 0, reason: undefined, backendState: 'ready', unreachable: false };
const facts = (change: Partial<ConnectionFacts>): ConnectionFacts => ({ ...HEALTHY, ...change });

describe('the connection banner', () => {
  it('says nothing while the link is good, or while the first connection is still being made', () => {
    expect(connectionBanner(HEALTHY)).toBeUndefined();
    expect(connectionBanner(facts({ state: 'reconnecting', attempt: 0 }))).toBeUndefined();
  });

  it('keeps saying the device is offline for as long as it is, whatever the gateway then reports', () => {
    const said = new Set<string>();
    for (const attempt of [0, 1, 5, 40]) {
      for (const state of ['connected', 'reconnecting', 'offline'] as const) {
        for (const unreachable of [false, true]) {
          const banner = connectionBanner(facts({ online: false, state, attempt, unreachable, backendState: unreachable ? undefined : 'stopped', reason: 'Caduceus is not reachable.' }));
          said.add(`${banner?.title} | ${banner?.stripTitle}`);
          expect(banner?.title).not.toMatch(/attempt|reach/i);
          expect(banner?.body).not.toMatch(/attempt/i);
        }
      }
    }
    expect([...said]).toEqual(['You are offline | Offline']);
  });

  it('says Hermes cannot be reached only once the device is online and the server does not answer, with the attempt in the body and not the title', () => {
    const banner = connectionBanner(facts({ state: 'offline', attempt: 5, unreachable: true, reason: 'Caduceus is not reachable.' }));
    expect(banner?.title).toBe('Can’t reach Hermes');
    expect(banner?.title).not.toMatch(/\d/);
    expect(banner?.body).toContain('attempt 5');
    expect(banner?.tone).toBe('warning');
  });

  it('gives the phone strip a short title that is never longer than the full one', () => {
    const banners = [
      connectionBanner(facts({ online: false })),
      connectionBanner(facts({ state: 'offline', attempt: 2, unreachable: true })),
      connectionBanner(facts({ state: 'offline', attempt: 2, backendState: 'stopped' })),
      connectionBanner(facts({ state: 'reconnecting', attempt: 3, backendState: 'starting', reason: 'Hermes is starting.' })),
      connectionBanner(facts({ state: 'reconnecting', attempt: 3, reason: 'The connection dropped.' })),
    ];
    for (const banner of banners) {
      expect(banner).toBeDefined();
      expect((banner?.stripTitle ?? banner?.title ?? '').length).toBeLessThanOrEqual(banner?.title.length ?? 0);
    }
  });
});
