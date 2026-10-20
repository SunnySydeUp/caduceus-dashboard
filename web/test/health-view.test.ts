import { describe, expect, test } from 'vitest';
import type { HealthReport, Repair, Subsystem, SubsystemId, SubsystemState } from '@caduceus/contracts/caduceus-api';
import { healthSummary, recurringText } from '../src/health-view.ts';

const subsystem = (id: SubsystemId, state: SubsystemState): Subsystem => ({ id, name: id, state, reason: '', checkedAt: '2026-10-07T09:00:00.000Z', facts: [] });
const repair = (id: string, severity: Repair['severity']): Repair => ({ id, severity, subsystem: 'backend', title: id, cause: '' });
const report = (states: SubsystemState[], repairs: Repair[] = []): HealthReport => ({
  checkedAt: '2026-10-07T09:00:00.000Z',
  subsystems: states.map((state, n) => subsystem(['caduceus', 'backend', 'gateway', 'scheduler', 'dispatcher', 'providers', 'host'][n] as SubsystemId, state)),
  repairs,
});

describe('the health summary', () => {
  test('says there is nothing to repair when every subsystem is healthy', () => {
    expect(healthSummary(report(['ok', 'ok', 'ok']))).toEqual({ repairs: 0, healthy: 3, total: 3, text: 'No open issues · all 3 subsystems healthy' });
  });

  test('counts the issues to repair and the subsystems that are healthy, which an unknown one is not', () => {
    const summary = healthSummary(report(['ok', 'degraded', 'down', 'unknown', 'ok'], [repair('a', 'warning')]));

    expect(summary).toEqual({ repairs: 1, healthy: 2, total: 5, text: '1 issue to repair · 2 of 5 subsystems healthy' });
    expect(healthSummary(report(['ok', 'down'], [repair('a', 'critical'), repair('b', 'info')])).text).toBe('2 issues to repair · 1 of 2 subsystems healthy');
  });
});

describe('how a recurring failure is said', () => {
  test('says how many separate times it appeared and in what window, in words', () => {
    expect(recurringText({ times: 2, windowHours: 24 })).toBe('Came back: seen 2 times in the last 24 hours');
    expect(recurringText({ times: 5, windowHours: 1 })).toBe('Came back: seen 5 times in the last hour');
  });
});
