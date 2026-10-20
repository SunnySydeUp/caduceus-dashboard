import { describe, expect, test } from 'vitest';
import type { SubsystemId } from '@caduceus/contracts/caduceus-api';
import { createRepairHistory, RECURRENCE_WINDOW_MS } from '../src/repair-recurrence.ts';

// What counts as "the same failure again": a Repair that was gone from a report that could check it, and is back. Pure: the clock is an argument.
const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-07T09:00:00.000Z');
const ALL: SubsystemId[] = ['gateway', 'scheduler'];

/** One report's worth of what the history is told: the Repairs that are open, and the subsystems that could be checked. */
const seen = (ids: [string, SubsystemId][], known: SubsystemId[] = ALL) => ({ open: ids.map(([id, subsystem]) => ({ id, subsystem })), known });

describe('the history of Repairs', () => {
  test('flags a Repair from its second separate appearance, counting each one, and not before', () => {
    const history = createRepairHistory();

    expect(history.observe(seen([['gateway-not-running', 'gateway']]), T0).get('gateway-not-running')).toBeUndefined();
    expect(history.observe(seen([]), T0 + HOUR).get('gateway-not-running')).toBeUndefined();
    expect(history.observe(seen([['gateway-not-running', 'gateway']]), T0 + 2 * HOUR).get('gateway-not-running')).toEqual({ times: 2, windowHours: 24 });
    history.observe(seen([]), T0 + 3 * HOUR);
    expect(history.observe(seen([['gateway-not-running', 'gateway']]), T0 + 4 * HOUR).get('gateway-not-running')).toEqual({ times: 3, windowHours: 24 });
  });

  test('counts a failure that stays as one appearance, however often it is seen', () => {
    const history = createRepairHistory();
    for (let n = 0; n < 5; n++) history.observe(seen([['gateway-not-running', 'gateway']]), T0 + n * HOUR);

    expect(history.observe(seen([['gateway-not-running', 'gateway']]), T0 + 6 * HOUR).size).toBe(0);
  });

  test('forgets an appearance as old as the window, and keeps one a moment younger', () => {
    const aged = (returnsAt: number) => {
      const history = createRepairHistory();
      history.observe(seen([['gateway-not-running', 'gateway']]), T0);
      history.observe(seen([]), T0 + HOUR);
      return history.observe(seen([['gateway-not-running', 'gateway']]), returnsAt).get('gateway-not-running');
    };

    expect(aged(T0 + RECURRENCE_WINDOW_MS - 1)).toEqual({ times: 2, windowHours: 24 });
    expect(aged(T0 + RECURRENCE_WINDOW_MS)).toBeUndefined();
  });

  test('does not take a check that could not be made for a Repair that went away', () => {
    const history = createRepairHistory();
    history.observe(seen([['gateway-not-running', 'gateway']]), T0);
    // The gateway could not be checked this time (Hermes did not answer), so its Repair is not in the report; it has not cleared.
    history.observe(seen([], ['scheduler']), T0 + HOUR);

    expect(history.observe(seen([['gateway-not-running', 'gateway']]), T0 + 2 * HOUR).get('gateway-not-running')).toBeUndefined();
  });

  test('keeps each Repair’s count to itself', () => {
    const history = createRepairHistory();
    history.observe(seen([['gateway-not-running', 'gateway'], ['scheduler-stale', 'scheduler']]), T0);
    history.observe(seen([['scheduler-stale', 'scheduler']]), T0 + HOUR);

    const now = history.observe(seen([['gateway-not-running', 'gateway'], ['scheduler-stale', 'scheduler']]), T0 + 2 * HOUR);

    expect([...now.keys()]).toEqual(['gateway-not-running']);
  });
});
