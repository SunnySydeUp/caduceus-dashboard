// Reading Hermes for Connect › Pairing. Only GETs live here; every change goes through `pairing-actions.ts`. Every load asks Hermes
// again and nothing is kept beyond what the page shows (D1).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGatewayEvent, useLiveLoad } from '../../gateway.ts';
import { pairingListPath, parsePairing, type ApprovedUser, type PendingRequest } from './pairing-model.ts';

export interface PairingView {
  /** `undefined` until Hermes has answered. They stay while a newer list is asked for. */
  pending: PendingRequest[] | undefined;
  approved: ApprovedUser[] | undefined;
  /** The last ask failed: Hermes did not answer. */
  failed: boolean;
  reload(): Promise<void>;
}

/**
 * Hermes's pairing lists for `profile`. They load again with no timer, whenever something they are made of may have changed: at
 * every `gateway.ready`, when Hermes says pairing moved (`pairing.changed`: a stranger wrote to a bot, or a request was answered
 * somewhere else) and when the tab comes back into view.
 */
export function usePairing(profile: string | undefined): PairingView {
  const [lists, setLists] = useState<{ pending: PendingRequest[] | undefined; approved: ApprovedUser[] | undefined }>({ pending: undefined, approved: undefined });
  const [failed, setFailed] = useState(false);
  /** Which load is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!profile) return;
    const request = ++latest.current;
    try {
      const res = await fetch(pairingListPath(profile));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = parsePairing(await res.json());
      if (request !== latest.current) return;
      setLists(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [profile]);

  useEffect(() => {
    // Another profile is another store: the last one's requests must not show as this one's while it loads.
    setLists({ pending: undefined, approved: undefined });
    void reload();
  }, [reload]);
  useLiveLoad(() => void reload());
  useGatewayEvent('pairing.changed', () => void reload());
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);

  return { ...lists, failed, reload };
}
