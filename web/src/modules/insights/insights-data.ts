// Reading Hermes for Observe › Insights and the budgets beside it (M5 #05). Nothing is kept beyond what the page shows (D1): usage is asked of Hermes for the
// chosen period every time it changes or Hermes says its sessions moved. Only the budget definitions and their alerts live in Caduceus.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CADUCEUS_SESSION_SOURCE } from '@caduceus/contracts/caduceus-api';
import type { InsightsGetResult, SessionCreateResult } from '@caduceus/contracts/hermes/gateway';
import { gatewayConnection, useBackend, useGatewayEvent, useLiveLoad } from '../../gateway.ts';
import { fetchTiered } from '../../tiered.ts';
import { createBudgetsClient, type BudgetsClient } from './budgets-model.ts';
import { combine, readQuota, readSessions, readUsage, usagePath, type Insights, type ProfileUsage, type Quota, type SessionRow } from './insights-model.ts';
import type { BudgetStatus } from '@caduceus/contracts/budgets';

async function readJson(route: string): Promise<unknown> {
  const res = await fetch(route);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The session list is read in pages of 500 (Hermes's most) for the source and hour-of-day views, at most this many pages. */
const SESSION_PAGES = 4;

export interface SessionsView {
  rows: SessionRow[];
  /** More sessions started in the period than were read: the views that come from the list show the newest ones. */
  truncated: boolean;
}

export interface InsightsData {
  insights: Insights;
  sessions: SessionsView | undefined;
  /** Profiles Hermes could not read usage for, so their spend is not in the totals. */
  unread: string[];
  /** Sessions and messages in the period, from the gateway's `insights.get`; `undefined` when it did not answer. */
  activity: { sessions: number; messages: number } | undefined;
}

async function loadSessions(scope: string, since: number): Promise<SessionsView | undefined> {
  const rows: SessionRow[] = [];
  let total = 0;
  try {
    for (let page = 0; page < SESSION_PAGES; page++) {
      const read = readSessions(await readJson(`/api/profiles/sessions?order=created&min_messages=0&limit=500&offset=${page * 500}&archived=include&profile=${encodeURIComponent(scope)}`));
      rows.push(...read.rows);
      total = read.total;
      if (read.rows.length < 500 || read.rows.some((row) => row.startedAt < since)) break;
    }
  } catch {
    return undefined;
  }
  return { rows, truncated: rows.length < total && rows.every((row) => row.startedAt >= since) };
}

async function loadActivity(days: number, profiles: readonly string[]): Promise<InsightsData['activity']> {
  const { client } = gatewayConnection();
  try {
    const answers = await Promise.all(profiles.map((profile) => client.request<InsightsGetResult>('insights.get', { days, profile })));
    return { sessions: answers.reduce((sum, answer) => sum + (answer.sessions ?? 0), 0), messages: answers.reduce((sum, answer) => sum + (answer.messages ?? 0), 0) };
  } catch {
    return undefined;
  }
}

export type Loaded<T> = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; value: T };

/**
 * The usage of `profiles` over the last `days` days, read live: again when Hermes says sessions started or stopped, and after a reconnect. `scope` is what the
 * session list is asked for (`all` or one profile's name).
 */
export function useInsights(days: number, profiles: readonly string[], scope: string): { data: Loaded<InsightsData>; reload(): void } {
  const [data, setData] = useState<Loaded<InsightsData>>({ state: 'loading' });
  const latest = useRef(0);
  const ready = useBackend().status?.state === 'ready';
  const key = profiles.join('\n');

  const load = useCallback(() => {
    if (!ready || profiles.length === 0) return;
    const ask = ++latest.current;
    const since = Date.now() / 1000 - days * 86_400;
    void (async () => {
      const results = await Promise.all(
        profiles.map(async (profile): Promise<ProfileUsage | undefined> => {
          try {
            return readUsage(profile, await readJson(usagePath(profile, days)));
          } catch {
            return undefined;
          }
        }),
      );
      const [sessions, activity] = await Promise.all([loadSessions(scope, since), loadActivity(days, profiles)]);
      if (ask !== latest.current) return;
      const usages = results.filter((usage): usage is ProfileUsage => usage !== undefined);
      if (usages.length === 0) {
        setData({ state: 'failed', message: 'Hermes did not answer for any profile, so there is nothing to chart yet.' });
        return;
      }
      setData({ state: 'ready', value: { insights: combine(usages), sessions, unread: profiles.filter((_, index) => results[index] === undefined), activity } });
    })();
    // `profiles` is keyed by `key`: a new array with the same names is not a new question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, days, scope]);

  useEffect(() => {
    // A period or a scope that changed shows the old charts until the new ones are in, never a half-filled mix.
    load();
    return () => {
      latest.current += 1;
    };
  }, [load]);
  useLiveLoad(() => load());
  useGatewayEvent('sessions.changed', () => load());
  return { data, reload: load };
}

export type QuotaState = { state: 'loading' } | { state: 'none' } | { state: 'ready'; quota: Quota };

/**
 * The provider quota of `profile`, from `session.usage`. Hermes answers account limits for a session, so a session is opened on the profile (no prompt is sent
 * and no chat is made) and closed again; a provider with no account limits, or a session that cannot be opened, is "not available".
 */
export function useQuota(profile: string | undefined): QuotaState {
  const [quota, setQuota] = useState<QuotaState>({ state: 'loading' });
  const ready = useBackend().status?.state === 'ready';
  useEffect(() => {
    if (!ready || profile === undefined) return;
    let current = true;
    setQuota({ state: 'loading' });
    void (async () => {
      const { client } = gatewayConnection();
      let sessionId: string | undefined;
      let lines: unknown;
      try {
        const created = await client.request<SessionCreateResult>('session.create', { source: CADUCEUS_SESSION_SOURCE, profile });
        sessionId = created.session_id;
        lines = (await client.request<{ account_lines?: unknown }>('session.usage', { session_id: sessionId, profile })).account_lines;
      } catch {
        lines = undefined;
      } finally {
        if (sessionId) void client.request('session.close', { session_id: sessionId }).catch(() => undefined);
      }
      if (!current) return;
      const read = readQuota(lines);
      setQuota(read ? { state: 'ready', quota: read } : { state: 'none' });
    })();
    return () => {
      current = false;
    };
  }, [ready, profile]);
  return quota;
}

/** The budgets with this period's spend, and the client that changes them. They are read again when sessions move: that is when spend does. */
export function useBudgets(): { budgets: Loaded<BudgetStatus[]>; client: BudgetsClient; reload(): Promise<void> } {
  const client = useMemo(() => createBudgetsClient({ send: fetchTiered, read: readJson }), []);
  const [budgets, setBudgets] = useState<Loaded<BudgetStatus[]>>({ state: 'loading' });
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const ask = ++latest.current;
    try {
      const value = await client.list();
      if (ask === latest.current) setBudgets({ state: 'ready', value });
    } catch {
      if (ask === latest.current) setBudgets({ state: 'failed', message: 'Caduceus did not answer, so the budgets are not shown.' });
    }
  }, [client]);
  useEffect(() => void reload(), [reload]);
  useGatewayEvent('sessions.changed', () => void reload());
  return { budgets, client, reload };
}
