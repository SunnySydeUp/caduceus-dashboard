// Raises and clears the resource-pressure banner (`pressure-watch.ts`) while the shell is mounted. Hermes's own signal is in its public status, which
// is read again whenever something that costs memory or disk may have happened (a connection, a session starting or stopping, a platform moving, the tab
// coming back) and not more often than Hermes samples it; there is no timer.
import { useEffect, useRef } from 'react';
import { readPressure } from '@caduceus/contracts/pressure';
import { useGatewayEvent, useLiveLoad } from '../gateway.ts';
import { clearBanner, setBanner } from './banners.ts';
import { NO_PRESSURE_YET, watchPressure, type PressureWatch } from './pressure-watch.ts';

/** Hermes's gateway writes its memory sample every 30 s: asking more often only hears the same sample again. */
const SAMPLE_EVERY_MS = 30_000;

export function usePressureBanner(): void {
  const watch = useRef<PressureWatch>(NO_PRESSURE_YET);
  /** The banner on screen now, so that one from an earlier episode goes when a new one comes. */
  const shown = useRef<string>(undefined);
  const askedAt = useRef(0);
  const latest = useRef(0);
  const refresh = useRef<(force: boolean) => Promise<void>>(undefined);
  refresh.current = async (force) => {
    if (!force && Date.now() - askedAt.current < SAMPLE_EVERY_MS) return;
    askedAt.current = Date.now();
    const ask = ++latest.current;
    const status: unknown = await fetch('/api/status').then(
      (res) => (res.ok ? res.json() : undefined),
      () => undefined,
    );
    // Hermes did not answer (it is down or restarting): the connection banners say so, and what is known about pressure stays as it was.
    if (status === undefined || ask !== latest.current) return;
    const step = watchPressure(watch.current, readPressure(status));
    if (step.hold) return;
    watch.current = step.watch;
    if (shown.current !== undefined && shown.current !== step.banner?.id) clearBanner(shown.current);
    shown.current = step.banner?.id;
    if (step.banner) setBanner(step.banner);
  };

  // At every `gateway.ready` (the first connect, each reconnect, a Hermes restart) the sample is read afresh.
  useLiveLoad(() => void refresh.current?.(true));
  useGatewayEvent('sessions.changed', () => void refresh.current?.(false));
  useGatewayEvent('platforms.changed', () => void refresh.current?.(false));
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void refresh.current?.(false);
    document.addEventListener('visibilitychange', visible);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      latest.current++;
      if (shown.current !== undefined) clearBanner(shown.current);
      shown.current = undefined;
      watch.current = NO_PRESSURE_YET;
    };
  }, []);
}
