import { describe, expect, test } from 'vitest';
import { analyticsFailure } from '../src/modules/models/usage.ts';

describe('a refused read of Hermes’s analytics', () => {
  test('is “not available in this Hermes” when the route is missing, and “failed, retry” for anything else', () => {
    expect([404, 405, 501].map(analyticsFailure)).toEqual(['unavailable', 'unavailable', 'unavailable']);
    expect([500, 502, 503, 401, 408].map(analyticsFailure)).toEqual(['failed', 'failed', 'failed', 'failed', 'failed']);
  });
});
