import { describe, expect, test } from 'vitest';
import { causeOf, writeGate } from '../src/offline.ts';

// Whether this page can reach Caduceus, and so whether it may offer to change anything (M0 #12). Changes that cannot be
// queued are switched off, with the reason said in words (mobile-and-interaction §7).
describe('whether a change can be made', () => {
  test('is allowed while the device is online and Caduceus answers', () => {
    expect(writeGate({ online: true, reachable: true })).toEqual({ allowed: true });
    expect(causeOf({ online: true, reachable: true })).toBeUndefined();
  });

  test('is off while the device has no network, and says so and what to do about it', () => {
    expect(writeGate({ online: false, reachable: true })).toEqual({
      allowed: false,
      cause: 'offline',
      reason: 'You are offline, so this change cannot be saved. Make it again when you are back online.',
    });
  });

  test('is off while Caduceus does not answer, though the device has a network', () => {
    expect(writeGate({ online: true, reachable: false })).toEqual({
      allowed: false,
      cause: 'unreachable',
      reason: 'Caduceus is not reachable, so this change cannot be saved. It will work again when Caduceus answers.',
    });
  });

  test('blames the network first when both are down: no network is why Caduceus does not answer', () => {
    expect(causeOf({ online: false, reachable: false })).toBe('offline');
  });
});
