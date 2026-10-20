// Reading Hermes for Connect › Gateway. Only GETs live here; the actions are in `../../gateway-actions.ts`. Every load asks Hermes
// again and nothing is kept beyond what the page shows (D1).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GatewayFacts } from '@caduceus/contracts/caduceus-api';
import { useGatewayEvent, useLiveLoad } from '../../gateway.ts';
import { fetchGatewayFacts } from '../../restart-to-apply.ts';
import { fetchGatewayStatus, fetchProfileCards } from '../profiles/profiles-data.ts';
import type { GatewayStatus, ProfileCard } from '../profiles/profiles-model.ts';
import { configuredChannels, type GatewayTopology } from './gateway-model.ts';

async function readJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface GatewaysView {
  /** `undefined` until Hermes has answered. They stay while a newer list is asked for. */
  cards: ProfileCard[] | undefined;
  statuses: Readonly<Record<string, GatewayStatus | undefined>>;
  topology: GatewayTopology | undefined;
  facts: GatewayFacts | undefined;
  /** How many channels Hermes says are set up; `undefined` when it did not say. */
  channels: number | undefined;
  /** The last ask failed: Hermes did not answer. */
  failed: boolean;
  reload(): Promise<void>;
}

/**
 * The profiles with their gateway status, the gateway processes, and what Caduceus adds (start times, restarts waiting). They load
 * again whenever something they are made of may have changed, with no timer: at every `gateway.ready`, when Hermes says its
 * platforms moved (`platforms.changed`: a gateway started, stopped or connected a channel) and when the tab comes back into view.
 */
export function useGateways(): GatewaysView {
  const [state, setState] = useState<Omit<GatewaysView, 'failed' | 'reload'>>({ cards: undefined, statuses: {}, topology: undefined, facts: undefined, channels: undefined });
  const [failed, setFailed] = useState(false);
  /** Which load is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const [cards, topology, facts, platforms] = await Promise.all([
        fetchProfileCards(),
        readJson('/api/status').catch(() => undefined),
        fetchGatewayFacts(),
        readJson('/api/messaging/platforms').catch(() => undefined),
      ]);
      const answers = await Promise.all(cards.map(async (card) => [card.name, await fetchGatewayStatus(card.name)] as const));
      if (request !== latest.current) return;
      setState({ cards, statuses: Object.fromEntries(answers), topology: topology as GatewayTopology | undefined, facts, channels: configuredChannels(platforms) });
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, []);

  useLiveLoad(() => void reload());
  useGatewayEvent('platforms.changed', () => void reload());
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);

  return { ...state, failed, reload };
}

/** Hermes's migration plan; `undefined` until it has answered, `null` when it could not be asked. */
export interface PlanView {
  plan: unknown;
  failed: boolean;
  reload(): Promise<void>;
}

export function useMigrationPlan(): PlanView {
  const [plan, setPlan] = useState<unknown>();
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await readJson('/api/gateway/migrate/plan');
      if (request !== latest.current) return;
      setPlan(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, []);
  useLiveLoad(() => void reload());
  useGatewayEvent('platforms.changed', () => void reload());
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);
  return { plan, failed, reload };
}
