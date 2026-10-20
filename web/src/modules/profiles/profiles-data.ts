// Reading Hermes for Agents › Profiles. Only GETs live here (the scan in `profiles-active-write.test.ts` holds this file to
// it); every change goes through `profile-actions.ts` and `make-default.ts`. Nothing is kept beyond what the page shows.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGatewayEvent, useLiveLoad } from '../../gateway.ts';
import { overviewMetrics, parseProfiles, type GatewayStatus, type OverviewMetrics, type ProfileCard } from './profiles-model.ts';

async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Hermes's profiles with its sticky default marked. Throws when Hermes cannot be asked. */
export async function fetchProfileCards(): Promise<ProfileCard[]> {
  const [list, active] = await Promise.all([read('/api/profiles'), read('/api/profiles/active').catch(() => undefined)]);
  return parseProfiles(list, active);
}

/** One profile's gateway status from Hermes's status endpoint; `undefined` when Hermes did not answer. */
export async function fetchGatewayStatus(name: string): Promise<GatewayStatus | undefined> {
  return (await read(`/api/status?profile=${encodeURIComponent(name)}`).catch(() => undefined)) as GatewayStatus | undefined;
}

export interface Overview {
  metrics: OverviewMetrics;
  /** What Hermes did not answer, in words ("usage analytics"): those numbers read as zeros and the page says so. */
  missing: string[];
}

/** The Overview numbers of a profile: usage analytics (by profile), Kanban stats and assignees, MCP servers. Nothing is stored. */
export async function fetchOverview(card: ProfileCard): Promise<Overview> {
  const name = encodeURIComponent(card.name);
  const sources = [
    ['usage analytics', `/api/analytics/usage?profile=${name}`],
    ['Kanban stats', '/api/plugins/kanban/stats'],
    ['Kanban assignees', '/api/plugins/kanban/assignees'],
    ['MCP servers', `/api/mcp/servers?profile=${name}`],
  ] as const;
  const answers = await Promise.all(sources.map(([, path]) => read(path).then((body) => ({ body }), () => undefined)));
  const [usage, stats, assignees, mcpServers] = answers.map((answer) => answer?.body);
  return {
    metrics: overviewMetrics({ usage, stats, assignees, profile: card.name, mcpServers, skillCount: card.skillCount }),
    missing: sources.filter((_, index) => answers[index] === undefined).map(([label]) => label),
  };
}

export interface ProfilesView {
  /** `undefined` until Hermes has answered. They stay while a newer list is asked for. */
  cards: ProfileCard[] | undefined;
  /** Each profile's gateway status as Hermes's status endpoint last said (absent: not asked yet, or not answered). */
  statuses: Readonly<Record<string, GatewayStatus | undefined>>;
  /** The last ask failed: Hermes did not answer. */
  failed: boolean;
  reload(): Promise<void>;
}

/**
 * The profiles and their gateway status, loaded again whenever something they are made of may have changed, with no timer: at
 * every `gateway.ready` (first connect, reconnects, a Hermes restart), when Hermes says its platforms moved
 * (`platforms.changed`: a gateway started, stopped or connected a channel), and when the tab comes back into view.
 */
export function useProfiles(): ProfilesView {
  const [cards, setCards] = useState<ProfileCard[]>();
  const [statuses, setStatuses] = useState<Record<string, GatewayStatus | undefined>>({});
  const [failed, setFailed] = useState(false);
  /** Which load is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await fetchProfileCards();
      if (request !== latest.current) return;
      setCards(next);
      setFailed(false);
      const answers = await Promise.all(next.map(async (card) => [card.name, await fetchGatewayStatus(card.name)] as const));
      if (request === latest.current) setStatuses(Object.fromEntries(answers));
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

  return { cards, statuses, failed, reload };
}
