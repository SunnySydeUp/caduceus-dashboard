import { describe, expect, it } from 'vitest';
import { connectionBanner, nextCantReachHold, type ConnectionFacts } from '../src/shell/connection-notice.ts';

const HEALTHY: ConnectionFacts = { online: true, state: 'connected', attempt: 0, reason: undefined, backendState: 'ready', unreachable: false, redialing: false, cantReachHeld: false };
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

  it('says the Mac cannot be reached only once the device is online and the server does not answer, with what to check and the attempt in the body, not the title', () => {
    const banner = connectionBanner(facts({ state: 'offline', attempt: 5, unreachable: true, reason: 'Caduceus is not reachable.' }));
    expect(banner?.title).toBe('Can’t reach your Mac');
    expect(banner?.title).not.toMatch(/\d/);
    expect(banner?.body).toContain('attempt 5');
    expect(banner?.body).toMatch(/asleep|awake|switched on|tailnet/i);
    expect(banner?.tone).toBe('warning');
  });

  it('blames Hermes, not the Mac, when the server answers and Hermes does not', () => {
    expect(connectionBanner(facts({ state: 'offline', attempt: 2, backendState: 'stopped' }))?.title).toBe('Hermes isn’t answering');
    expect(connectionBanner(facts({ state: 'offline', attempt: 2, reason: 'The connection dropped.' }))?.title).toBe('Hermes isn’t answering');
  });

  it('keeps the reconnecting words the browser check waits for', () => {
    expect(connectionBanner(facts({ state: 'reconnecting', attempt: 3, reason: 'The connection dropped.' }))?.title).toBe('Reconnecting to Hermes');
  });

  it('says "Reconnecting to Hermes", not "Can’t reach your Mac", while the first redial after the network came back is out', () => {
    const stale = { state: 'offline', attempt: 7, unreachable: true, reason: 'Caduceus is not reachable.' } as const;
    const banner = connectionBanner(facts({ ...stale, redialing: true }));
    expect(banner?.title).toBe('Reconnecting to Hermes');
    expect(banner?.body).not.toMatch(/attempt/i);
    expect(connectionBanner(facts({ ...stale, redialing: false }))?.title).toBe('Can’t reach your Mac');
    expect(connectionBanner(facts({ ...stale, online: false, redialing: true }))?.title).toBe('You are offline');
    expect(connectionBanner(facts({ redialing: true }))).toBeUndefined();
  });

  it('holds "Can’t reach your Mac" through the flips a failed redial makes, until a connection or the loss of the network ends it', () => {
    const down = { online: true, redialing: false, unreachable: true } as const;
    // The server does not answer with the device online: the words start.
    let held = nextCantReachHold(false, { ...down, state: 'offline' });
    expect(held).toBe(true);
    // Each redial flips the gateway to reconnecting and back: the words stay, and the banner keeps saying them.
    for (const state of ['reconnecting', 'offline', 'reconnecting', 'reconnecting', 'offline'] as const) {
      held = nextCantReachHold(held, { ...down, state });
      expect(held).toBe(true);
      const banner = connectionBanner(facts({ state, attempt: 4, unreachable: state === 'offline', cantReachHeld: held }));
      expect(banner?.title).toBe('Can’t reach your Mac');
    }
    // Without the hold, a redial in flight reads as reconnecting.
    expect(connectionBanner(facts({ state: 'reconnecting', attempt: 4 }))?.title).toBe('Reconnecting to Hermes');
    // A connection ends it; so does the network going away; so does a server that answers again while the gateway is still down.
    expect(nextCantReachHold(held, { ...down, state: 'connected' })).toBe(false);
    expect(nextCantReachHold(held, { ...down, online: false, state: 'reconnecting' })).toBe(false);
    expect(nextCantReachHold(held, { ...down, unreachable: false, state: 'offline' })).toBe(false);
  });

  it('does not start the hold from the stale words of the first redial after the network came back', () => {
    expect(nextCantReachHold(false, { online: true, state: 'offline', unreachable: true, redialing: true })).toBe(false);
    expect(nextCantReachHold(false, { online: true, state: 'reconnecting', unreachable: true, redialing: false })).toBe(false);
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
