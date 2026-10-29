// Reading Hermes for Agents › Profiles. Only GETs live here (the scan in `profiles-active-write.test.ts` holds this file to
// it); every change goes through `profile-actions.ts` and `make-default.ts`. Nothing is kept beyond what the page shows.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGatewayEvent, useLiveLoad } from '../../gateway.ts';
import { listPath as skillsPath, parseSkills } from '../skills/skills-model.ts';
import { analyticsFailure } from '../models/usage.ts';
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
  /** What Hermes did not answer, in words ("usage analytics"): those numbers read as zeros and the page says so, with Retry. */
  missing: string[];
  /** What this Hermes has no route for: those numbers read as zeros, and asking again changes nothing. */
  unavailable: string[];
}

type Answer = { body: unknown } | { failure: 'unavailable' | 'failed' };

async function ask(path: string): Promise<Answer> {
  try {
    const res = await fetch(path);
    return res.ok ? { body: await res.json() } : { failure: analyticsFailure(res.status) };
  } catch {
    return { failure: 'failed' };
  }
}

/** The Overview numbers of a profile: usage analytics (by profile), Kanban stats and assignees, MCP servers, and the skills it lists. Nothing is stored. */
export async function fetchOverview(card: ProfileCard): Promise<Overview> {
  const name = encodeURIComponent(card.name);
  const sources = [
    ['usage analytics', `/api/analytics/usage?profile=${name}`],
    ['Kanban stats', '/api/plugins/kanban/stats'],
    ['Kanban assignees', '/api/plugins/kanban/assignees'],
    ['MCP servers', `/api/mcp/servers?profile=${name}`],
  ] as const;
  const [answers, skills] = await Promise.all([Promise.all(sources.map(([, path]) => ask(path))), ask(skillsPath(card.name))]);
  const [usage, stats, assignees, mcpServers] = answers.map((answer) => ('body' in answer ? answer.body : undefined));
  const failedWith = (kind: 'unavailable' | 'failed') => sources.filter((_, index) => 'failure' in answers[index] && answers[index].failure === kind).map(([label]) => label);
  return {
    // The skills number is the list the Skills screen shows; the profile list's own count is only the fallback when the list did not come.
    metrics: overviewMetrics({ usage, stats, assignees, profile: card.name, mcpServers, skillCount: 'body' in skills ? parseSkills(skills.body).length : card.skillCount }),
    missing: failedWith('failed'),
    unavailable: failedWith('unavailable'),
  };
}

/** How many skills Hermes lists for a profile: the same list the Skills screen shows. `undefined` when Hermes did not answer. */
export async function fetchSkillCount(name: string): Promise<number | undefined> {
  try {
    return parseSkills(await read(skillsPath(name))).length;
  } catch {
    return undefined;
  }
}

export interface ProfilesView {
  /** `undefined` until Hermes has answered. They stay while a newer list is asked for. */
  cards: ProfileCard[] | undefined;
  /** Each profile's gateway status as Hermes's status endpoint last said (absent: not asked yet, or not answered). */
  statuses: Readonly<Record<string, GatewayStatus | undefined>>;
  /** Each profile's skills as the Skills screen lists them. Hermes's own count in the profile list is a cached number that can lag, so this replaces it once it arrives. */
  skillCounts: Readonly<Record<string, number | undefined>>;
  /** The last ask failed: Hermes did not answer. */
  failed: boolean;
  reload(): Promise<void>;
}

/**
 * The profiles and their gateway status (and, for the list of profiles, their skill counts), loaded again whenever something they are made of may have changed, with no timer: at
 * every `gateway.ready` (first connect, reconnects, a Hermes restart), when Hermes says its platforms moved
 * (`platforms.changed`: a gateway started, stopped or connected a channel), and when the tab comes back into view.
 */
export function useProfiles({ withSkillCounts = false }: { withSkillCounts?: boolean } = {}): ProfilesView {
  const [cards, setCards] = useState<ProfileCard[]>();
  const [statuses, setStatuses] = useState<Record<string, GatewayStatus | undefined>>({});
  const [skillCounts, setSkillCounts] = useState<Record<string, number | undefined>>({});
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
      if (request !== latest.current) return;
      setStatuses(Object.fromEntries(answers));
      if (!withSkillCounts) return;
      const counts = await Promise.all(next.map(async (card) => [card.name, await fetchSkillCount(card.name)] as const));
      if (request === latest.current) setSkillCounts(Object.fromEntries(counts));
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [withSkillCounts]);

  useLiveLoad(() => void reload());
  useGatewayEvent('platforms.changed', () => void reload());
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);

  return { cards, statuses, skillCounts, failed, reload };
}
