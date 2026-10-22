// What the sessions list knows about Hermes's sessions, free of the DOM and of React (M1 #13): how a row of Hermes's list reads, which
// date group it falls in, what its last-activity label says and, in `sessions-view.ts`, which rows a filter keeps. Every fact is derived from
// what Hermes answered on this load: Caduceus keeps no session row (D1).
import type { Project } from './sessions-projects.ts';

/** A session as the list shows it: the parts of Hermes's list row the screen uses, read defensively (a field Hermes does not send is as if it were empty). */
export interface SessionItem {
  /** The stored session id. */
  id: string;
  title: string;
  /** The first words of the conversation, which stand in for a title Hermes has not made yet. */
  preview: string;
  /** Where the session came from (`cli`, `telegram`, `cron`, …); empty when Hermes did not say. */
  source: string;
  startedAt: number;
  /** Seconds since the epoch of the last message (the start when there is none). */
  lastActive: number;
  messageCount: number;
  pinned: boolean;
  /** Hermes's own read marker: the session has activity newer than the last time it was marked read. */
  unread: boolean;
  /** The session ended with an error or a crash; see `endedBadly`. */
  failed: boolean;
  /** The profile that owns the session; only the cross-profile list says. */
  profile: string | undefined;
  /** Hermes's archive flag: the session is out of the default list. */
  archived: boolean;
  /** The folder the session works in; empty when Hermes has none. A project owns the sessions whose folder is one of its own. */
  cwd: string;
  tokens: number;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Hermes writes no "failed" flag on a list row. A session that stopped for a reason that names an error, a failure, a crash or a timeout
 * (`end_reason`) is the failure the list can know without reading a transcript; an automatic close (`idle_timeout`, `ws_disconnect`) is not.
 */
const FAILED_END = /error|fail|crash|exception|abort|^timeout$/i;
const endedBadly = (reason: unknown): boolean => FAILED_END.test(text(reason));

function parseItem(raw: unknown): SessionItem | undefined {
  const row = record(raw);
  const id = text(row.id);
  if (id === '') return undefined;
  const startedAt = count(row.started_at);
  return {
    id,
    title: text(row.title).trim(),
    preview: text(row.preview).trim(),
    source: text(row.source),
    startedAt,
    lastActive: count(row.last_active) || startedAt,
    messageCount: count(row.message_count),
    pinned: row.pinned === true,
    archived: row.archived === true,
    cwd: text(row.cwd),
    unread: row.unread === true,
    failed: endedBadly(row.end_reason),
    profile: typeof row.profile === 'string' && row.profile !== '' ? row.profile : undefined,
    tokens: count(row.input_tokens) + count(row.output_tokens),
  };
}

/** One page of Hermes's list (`GET /api/sessions` or `GET /api/profiles/sessions`). */
export interface SessionPage {
  items: SessionItem[];
  /** How many sessions Hermes has under the filter it was asked for, not how many this page holds. */
  total: number;
  /** The cross-profile list: how many sessions each profile has. */
  profileTotals: Record<string, number> | undefined;
  /** The cross-profile list: the profiles Hermes could not read, in its words. */
  errors: string[];
}

export function parseSessions(body: unknown): SessionPage {
  const { sessions, total, profile_totals: profileTotals, errors } = record(body);
  const items = (Array.isArray(sessions) ? sessions : []).flatMap((row) => parseItem(row) ?? []);
  const totals = Object.entries(record(profileTotals)).filter((entry): entry is [string, number] => typeof entry[1] === 'number');
  return {
    items,
    total: typeof total === 'number' ? total : items.length,
    profileTotals: profileTotals === undefined ? undefined : Object.fromEntries(totals),
    errors: (Array.isArray(errors) ? errors : []).map((error) => (typeof error === 'string' ? error : JSON.stringify(error))),
  };
}

export type GroupId = 'pinned' | 'today' | 'yesterday' | 'week' | 'older';

export const GROUP_LABELS: Record<GroupId, string> = { pinned: 'Pinned', today: 'Today', yesterday: 'Yesterday', week: 'This week', older: 'Older' };

export interface SessionGroup {
  /** A date group (`GroupId`), or `project:<id>` / `no-project` when the list is grouped by project. */
  id: string;
  label: string;
  items: SessionItem[];
  /** The project this group is, when the list is grouped by project and this is one. */
  project?: Project;
}

/** Where the viewer is: the instant it is now, and the time zone the calendar days are counted in. */
export interface Clock {
  /** Seconds since the epoch. */
  now: number;
  /** An IANA zone name; the device's own when it is left out. */
  timeZone?: string;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day of an instant in a time zone, as a number of days that two days apart differ by two whatever the clocks did in between. */
function calendarDay(seconds: number, timeZone: string | undefined): number {
  const key = timeZone ?? '';
  let format = dayFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    dayFormats.set(key, format);
  }
  const part = (type: string) => Number(format.formatToParts(seconds * 1000).find((candidate) => candidate.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}

/** How many calendar days before today an instant was. */
export const daysAgo = (seconds: number, { now, timeZone }: Clock): number => calendarDay(now, timeZone) - calendarDay(seconds, timeZone);

/** Pinned sessions first; then Today, Yesterday, This week (two to six days ago) and Older, each newest first. Groups with nothing in them are left out. */
export function groupSessions(items: readonly SessionItem[], clock: Clock): SessionGroup[] {
  const groups: Record<GroupId, SessionItem[]> = { pinned: [], today: [], yesterday: [], week: [], older: [] };
  for (const item of items) {
    const ago = daysAgo(item.lastActive, clock);
    groups[item.pinned ? 'pinned' : ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : ago < 7 ? 'week' : 'older'].push(item);
  }
  groups.pinned.sort((a, b) => b.lastActive - a.lastActive);
  return (Object.keys(groups) as GroupId[]).filter((id) => groups[id].length > 0).map((id) => ({ id, label: GROUP_LABELS[id], items: groups[id] }));
}

/** What a row says about when the session was last active: the time today, "Yesterday", the weekday this week, the date after that (with the year when it is another one), as the locale writes them. */
export function activityLabel(seconds: number, clock: Clock & { locale?: string }): string {
  const { locale, timeZone } = clock;
  const ago = daysAgo(seconds, clock);
  const at = new Date(seconds * 1000);
  if (ago <= 0) return new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(at);
  if (ago === 1) return 'Yesterday';
  if (ago < 7) return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(at);
  const sameYear = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at) === new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(clock.now * 1000);
  return new Intl.DateTimeFormat(locale, { timeZone, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(at);
}

/** The sources that are not a person talking to Hermes: scheduled jobs, Kanban workers, webhooks and the API server. The Automation kind is these, and the Chats kind is everything else. */
export const AUTOMATION_SOURCES: readonly string[] = ['cron', 'kanban', 'webhook', 'api_server'];

/** Which kind of session the list shows: every session (chats and automation in one list, the default), only the chats, or only the automation. */
export type SessionsTab = 'all' | 'chats' | 'automation';

/** The filters that are on, as the address carries them (`?tab=automation&source=cron&failed=1&quiet=1&all=1`). */
export interface SessionsView {
  tab: SessionsTab;
  /** Only sessions from this source (Hermes's `source`). */
  source?: string;
  /** Only sessions that ended badly. */
  failed: boolean;
  /** Leave out the API server's short, throwaway sessions. */
  quiet: boolean;
  /** Every profile, which is the default; `false` narrows the list to this tab's profile only. */
  all: boolean;
  /** The archive: only the sessions the owner has archived (Hermes lists them apart). */
  archived?: true;
  /** How the list is grouped: by Hermes's projects instead of by date. */
  group?: 'project';
}

const flag = (value: unknown): boolean => value === '1' || value === 1 || value === true;
const off = (value: unknown): boolean => value === '0' || value === 0 || value === false;

/** Whose sessions a list shows when the address does not say: every profile's (the Chat list), or only the tab's own agent (Talk's list under its name). */
export type ListScope = 'everyone' | 'agent';

/** Reads the view from the address's query; anything damaged is as if it were not there. */
export function readSessionsView(search: Record<string, unknown>, scope: ListScope = 'everyone'): SessionsView {
  const source = typeof search.source === 'string' && search.source.trim() !== '' ? search.source.trim() : undefined;
  return {
    tab: search.tab === 'automation' || search.tab === 'chats' ? search.tab : 'all',
    ...(source === undefined ? {} : { source }),
    failed: flag(search.failed),
    quiet: flag(search.quiet),
    all: scope === 'everyone' ? !off(search.all) : flag(search.all),
    ...(flag(search.archived) ? { archived: true as const } : {}),
    ...(search.group === 'project' ? { group: 'project' as const } : {}),
  };
}

/** The query that carries a view; the default view (every kind, nothing narrowed, and the scope's own default of whose sessions) is no query at all. Narrowing the Chat list to this tab's profile is `all=0`; widening Talk's is `all=1`. */
export function sessionsSearch({ tab, source, failed, quiet, all, archived, group }: SessionsView, scope: ListScope = 'everyone'): Record<string, string> {
  return {
    ...(tab === 'all' ? {} : { tab }),
    ...(source === undefined ? {} : { source }),
    ...(failed ? { failed: '1' } : {}),
    ...(quiet ? { quiet: '1' } : {}),
    ...(all === (scope === 'everyone') ? {} : { all: all ? '1' : '0' }),
    ...(archived ? { archived: '1' } : {}),
    ...(group === undefined ? {} : { group }),
  };
}

export const isInTab = (source: string, tab: SessionsTab): boolean => tab === 'all' || AUTOMATION_SOURCES.includes(source) === (tab === 'automation');

/** The view with another tab. A source that belongs to the tab being left would leave nothing to see, so it goes. */
export function withTab(view: SessionsView, tab: SessionsTab): SessionsView {
  const { source, ...rest } = view;
  return { ...rest, tab, ...(source !== undefined && isInTab(source, tab) ? { source } : {}) };
}

/** A session that is API noise: the API server opened it, it holds a prompt and a reply at most, and it was over within a minute. */
export const isApiNoise = ({ source, messageCount, startedAt, lastActive }: SessionItem): boolean => source === 'api_server' && messageCount <= 2 && lastActive - startedAt <= 60;

/** The sessions of `items` that pass every filter of `view`, in their order. Hermes filtered by tab and source already; they hold again, harmlessly. */
export function selectSessions(items: readonly SessionItem[], view: SessionsView): SessionItem[] {
  return items.filter((item) => isInTab(item.source, view.tab) && (view.source === undefined || item.source === view.source) && (!view.failed || item.failed) && (!view.quiet || !isApiNoise(item)));
}

/** Hermes's read of one page of the list under `view`: the tab's profile, or every profile. Failed-only and API noise have no parameter there; `selectSessions` applies them. */
export function listPath(view: SessionsView, { profile, offset, limit }: { profile: string; offset: number; limit: number }): string {
  const query = new URLSearchParams({ order: 'recent', min_messages: '1', limit: String(limit), offset: String(offset), profile: view.all ? 'all' : profile });
  if (view.source !== undefined) query.set('source', view.source);
  if (view.archived) query.set('archived', 'only');
  if (view.tab !== 'all') query.set(view.tab === 'automation' ? 'sources' : 'exclude_sources', AUTOMATION_SOURCES.join(','));
  return `${view.all ? '/api/profiles/sessions' : '/api/sessions'}?${query}`;
}

const MOVES: Record<string, -1 | 1> = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 };

/** The row the keyboard moves to from `current`: j or ↓ the next, k or ↑ the one before, Home and End the ends. With no current row (or one that is gone) the first is the place to begin. */
export function moveSelection(ids: readonly string[], current: string | undefined, key: string): string | undefined {
  if (ids.length === 0) return undefined;
  const at = current === undefined ? -1 : ids.indexOf(current);
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids.at(-1);
  const step = MOVES[key];
  if (step === undefined) return current !== undefined && at >= 0 ? current : ids[0];
  if (at < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, at + step))];
}

/** How Hermes is working on a session that is hosted now: running a turn, or stopped on a question or an approval for the owner. */
export type LiveKind = 'running' | 'waiting';

/**
 * The stored ids of the sessions Hermes is working on, from `session.active_list`. A hosted session that is only open (`idle`), or whose agent is
 * still being built (`starting`, `resuming`: what any session being opened goes through) is not live.
 * `id` is the gateway's own session id; the stored one is `session_key` (and `id` is all there is for a session with no key yet).
 */
export function liveSessions(result: unknown): Record<string, LiveKind> {
  const { sessions } = record(result);
  const live: Record<string, LiveKind> = {};
  for (const raw of Array.isArray(sessions) ? sessions : []) {
    const row = record(raw);
    const status = text(row.status);
    if (status !== 'working' && status !== 'streaming' && status !== 'waiting') continue;
    live[text(row.session_key) || text(row.id)] = status === 'waiting' ? 'waiting' : 'running';
  }
  return live;
}

/** What the header strip says: Hermes's session counts and the week's token use. */
export interface SessionStats {
  /** Sessions not archived. */
  sessions: number;
  archived: number;
  messages: number;
  bySource: Record<string, number>;
  /** Input and output tokens over the last week; absent when Hermes did not say. */
  tokens: number | undefined;
}

/** Hermes's `GET /api/sessions/stats` and the `totals` of `GET /api/analytics/usage?days=7`, either of which may be missing. */
export function parseStats(stats: unknown, usage: unknown): SessionStats {
  const { active_store: sessions, archived, messages, by_source: bySource } = record(stats);
  const { total_input: input, total_output: output } = record(record(usage).totals);
  return {
    sessions: count(sessions),
    archived: count(archived),
    messages: count(messages),
    bySource: Object.fromEntries(Object.entries(record(bySource)).filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
    tokens: typeof input === 'number' || typeof output === 'number' ? count(input) + count(output) : undefined,
  };
}

const plural = (n: number, noun: string): string => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

/** 950, 12.3k, 1.5M. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function statsLine({ sessions, messages, tokens }: SessionStats): string {
  return [plural(sessions, 'session'), plural(messages, 'message'), ...(tokens === undefined ? [] : [`${compact(tokens)} tokens this week`])].join(' · ');
}

/** One thing the list draws: the heading of a group, or a session. `key` is stable while the list changes under it. */
export type ListEntry = { kind: 'header'; id: string; label: string; key: string; project?: Project; count: number } | { kind: 'row'; item: SessionItem; key: string };

/** The groups as one list of entries, a header before the rows of each group, so that the page can draw a window of it. */
export function flattenGroups(groups: readonly SessionGroup[]): ListEntry[] {
  return groups.flatMap((group): ListEntry[] => [
    { kind: 'header', id: group.id, label: group.label, key: `header:${group.id}`, count: group.items.length, ...(group.project === undefined ? {} : { project: group.project }) },
    ...group.items.map((item): ListEntry => ({ kind: 'row', item, key: item.id })),
  ]);
}

/** How far a pull has to go (px of the list moving down, after resistance) before letting go refreshes, and how far it can go. */
export const PULL_THRESHOLD = 64;
export const PULL_MAX = 112;

/** What a finger that went down at `startY` and is at `y` pulls the list down by: half the way (it resists), nothing unless the list was at its top, and never past `PULL_MAX`. */
export function pull({ startY, y, atTop }: { startY: number; y: number; atTop: boolean }): { distance: number; armed: boolean } {
  const distance = atTop ? Math.min(PULL_MAX, Math.max(0, (y - startY) / 2)) : 0;
  return { distance, armed: distance >= PULL_THRESHOLD };
}

/** The icons a source can have: names of the app's icon set (`icons.tsx`, a React module this one does not import). */
export type SourceIcon = 'terminal' | 'monitor' | 'chat' | 'telegram' | 'discord' | 'clock' | 'work' | 'webhook' | 'server' | 'code';

const SOURCES: Record<string, { label: string; icon: SourceIcon }> = {
  cli: { label: 'Terminal', icon: 'terminal' },
  tui: { label: 'Terminal', icon: 'terminal' },
  desktop: { label: 'Desktop', icon: 'monitor' },
  caduceus: { label: 'Caduceus', icon: 'chat' },
  telegram: { label: 'Telegram', icon: 'telegram' },
  discord: { label: 'Discord', icon: 'discord' },
  cron: { label: 'Scheduled', icon: 'clock' },
  kanban: { label: 'Kanban', icon: 'work' },
  webhook: { label: 'Webhook', icon: 'webhook' },
  api_server: { label: 'API', icon: 'server' },
  acp: { label: 'Editor', icon: 'code' },
};

/** What a source is called: its own name for the ones Hermes ships, the source's words for one it adds later. */
export function sourceLabel(source: string): string {
  if (source === '') return 'Hermes';
  return SOURCES[source]?.label ?? source.charAt(0).toUpperCase() + source.slice(1).replace(/_/g, ' ');
}

export const sourceIcon = (source: string): SourceIcon => SOURCES[source]?.icon ?? 'chat';
