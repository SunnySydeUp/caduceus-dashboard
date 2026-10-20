import { describe, expect, test } from 'vitest';
import { readPressure } from '@caduceus/contracts/pressure';
import { NO_PRESSURE_YET, watchPressure, type PressureWatch } from '../src/shell/pressure-watch.ts';

// The app-wide resource-pressure banner (M5 #07): Hermes's own signal (`memory` and `disk` in its status) decides, and a banner the owner dismissed
// stays dismissed until a new episode of pressure begins. Pure: the hook in the shell only applies what this decides.
const status = (memory: Record<string, unknown>, disk: Record<string, unknown> = { pressure: 'ok' }) => ({ memory, disk });
const memory = (pressure: string, extra: Record<string, unknown> = {}) => status({ pressure, system_total_mb: 16_384, system_available_mb: 1_200, boot_id: 'boot-1', ...extra });

/** Runs a series of Hermes statuses through the watch, returning what is on screen after each: the banner's id, or `none`. A step that holds leaves the screen as it was. */
function run(...statuses: unknown[]): { watch: PressureWatch; ids: string[] } {
  let watch = NO_PRESSURE_YET;
  let onScreen = 'none';
  const ids = statuses.map((answer) => {
    const step = watchPressure(watch, readPressure(answer));
    watch = step.watch;
    if (!step.hold) onScreen = step.banner?.id ?? 'none';
    return onScreen;
  });
  return { watch, ids };
}

describe('the resource-pressure banner', () => {
  test('shows nothing while Hermes reports no pressure', () => {
    expect(run(memory('ok'), memory('ok')).ids).toEqual(['none', 'none']);
  });

  test('says what Hermes reports, in its numbers, and leads to Health', () => {
    const { banner } = watchPressure(NO_PRESSURE_YET, readPressure(memory('elevated')));

    expect(banner).toMatchObject({
      id: 'resource-pressure:1',
      tone: 'warning',
      icon: 'alert',
      title: 'Hermes is short of memory',
      body: 'Hermes reports elevated memory pressure: 1.2 GB of 16.0 GB is available. Agents may slow down or fail until it eases.',
      dismissible: true,
      actions: [{ label: 'Open Health', to: '/observe/health' }],
    });
  });

  test('is critical, and names both when memory and disk are both short', () => {
    const { banner } = watchPressure(NO_PRESSURE_YET, readPressure(status({ pressure: 'critical', system_total_mb: 16_384, system_available_mb: 40 }, { pressure: 'elevated', total_mb: 512_000, free_mb: 2_048 })));

    expect(banner).toMatchObject({ tone: 'danger', title: 'Hermes is short of memory and disk space' });
    expect(banner?.body).toBe(
      'Hermes reports critical memory pressure: 40 MB of 16.0 GB is available. Hermes reports elevated disk pressure: 2.0 GB of 500.0 GB is free. Agents may slow down or fail until it eases.',
    );
  });

  test('keeps one episode for as long as the pressure lasts, so a dismissal holds', () => {
    expect(run(memory('elevated'), memory('elevated'), memory('elevated')).ids).toEqual(['resource-pressure:1', 'resource-pressure:1', 'resource-pressure:1']);
  });

  test('is a new episode when the pressure came back after it went away', () => {
    expect(run(memory('elevated'), memory('ok'), memory('elevated')).ids).toEqual(['resource-pressure:1', 'none', 'resource-pressure:2']);
  });

  test('is a new episode when it gets worse, but not when it eases', () => {
    expect(run(memory('elevated'), memory('critical'), memory('elevated')).ids).toEqual(['resource-pressure:1', 'resource-pressure:2', 'resource-pressure:2']);
  });

  test('is a new episode when Hermes’s gateway restarted while the pressure went on (it has another boot id)', () => {
    expect(run(memory('elevated'), memory('elevated', { boot_id: 'boot-2' })).ids).toEqual(['resource-pressure:1', 'resource-pressure:2']);
  });

  test('holds what it knew when Hermes cannot tell for a moment: unknown is neither pressure nor relief', () => {
    const unknown = status({ pressure: 'unknown' }, { pressure: 'unknown' });

    expect(run(memory('elevated'), unknown, memory('elevated')).ids).toEqual(['resource-pressure:1', 'resource-pressure:1', 'resource-pressure:1']);
    expect(run(memory('ok'), unknown, memory('elevated')).ids).toEqual(['none', 'none', 'resource-pressure:1']);
  });

  test('follows the disk as it follows memory', () => {
    const { ids } = run(status({ pressure: 'ok' }, { pressure: 'critical', total_mb: 100_000, free_mb: 100 }), status({ pressure: 'ok' }, { pressure: 'ok' }));

    expect(ids).toEqual(['resource-pressure:1', 'none']);
  });
});
