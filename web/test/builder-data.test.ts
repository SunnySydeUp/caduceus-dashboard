import { describe, expect, test } from 'vitest';
import { deliveryTargetsPath } from '../src/modules/work/builder-data.ts';

// Where a job can deliver depends on the platforms of the profile that owns it (Hermes 0.22 answers `GET /api/cron/delivery-targets` per profile).
describe('the delivery targets of a job’s profile', () => {
  test('are asked of the profile the job belongs to, and of Hermes’s current one when no profile is chosen yet', () => {
    expect(deliveryTargetsPath('coder')).toBe('/api/cron/delivery-targets?profile=coder');
    expect(deliveryTargetsPath('my profile')).toBe('/api/cron/delivery-targets?profile=my%20profile');
    expect(deliveryTargetsPath('')).toBe('/api/cron/delivery-targets');
  });
});
