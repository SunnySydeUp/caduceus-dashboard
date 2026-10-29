// The health report (`GET /_caduceus/api/health`) for the screens that show it: Health, Settings and Gateway. Every load is a fresh question to Caduceus,
// which asks Hermes again. Only the last report is kept, in memory, so a screen that opens again shows it (with when it was checked) until the new one comes.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HealthReport } from '@caduceus/contracts/caduceus-api';
import { useBackend, useGatewayEvent, useGatewayStatus, useLiveLoad } from './gateway.ts';
import { refreshReadOnly } from './policy-state.ts';

export interface HealthView {
  /** The latest report. It stays while a newer one is asked for, and when Caduceus cannot be reached, so check `unreachable`. */
  report: HealthReport | undefined;
  /** Caduceus did not answer the last ask: what the report shows is as old as its `checkedAt`. */
  unreachable: boolean;
  /** A report is being asked for. */
  checking: boolean;
  /** Asks again now. */
  check(): Promise<void>;
}

/** The last report this page loaded, so a screen that opens again shows it at once while the next is asked for. */
let lastReport: HealthReport | undefined;

/**
 * Loads the report, and loads it again whenever something it is made of may have changed, with no timer: at every
 * `gateway.ready` (the first connect, each reconnect, a Hermes restart), when Hermes says its gateway or its jobs moved
 * (`platforms.changed`, `cron.changed`), when the connection or the backend's lifecycle changes while the page is not
 * connected (Caduceus reports the backend even while Hermes is down), and when the tab comes back into view.
 */
export function useHealth(): HealthView {
  const [report, setReport] = useState<HealthReport | undefined>(lastReport);
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);
  /** Which load is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);

  const check = useCallback(async () => {
    const request = ++latest.current;
    setChecking(true);
    try {
      const res = await fetch('/_caduceus/api/health');
      if (!res.ok) throw new Error(`GET /_caduceus/api/health: HTTP ${res.status}`);
      const next: HealthReport = await res.json();
      if (request !== latest.current) return;
      lastReport = next;
      setReport(next);
      setUnreachable(false);
      // A contract mismatch turns read-only mode on at the server: the banner follows now, not at its next ask.
      void refreshReadOnly();
    } catch {
      if (request === latest.current) setUnreachable(true);
    } finally {
      if (request === latest.current) setChecking(false);
    }
  }, []);

  useLiveLoad(() => void check());
  useGatewayEvent('platforms.changed', () => void check());
  useGatewayEvent('cron.changed', () => void check());

  const connection = useGatewayStatus().state;
  const backend = useBackend().status?.state;
  useEffect(() => {
    // Connected, `useLiveLoad` has it. Otherwise the connection and the backend's lifecycle are the news.
    if (connection !== 'connected') void check();
  }, [connection, backend, check]);
  useEffect(() => {
    const seen = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [check]);

  return { report, unreachable, checking, check };
}
