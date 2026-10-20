// Agents › Skills › Hub, as pure logic (no DOM, no React): how Hermes's hub endpoints read, the hub's query as it lives in the URL, and
// the requests the page sends. Every source, skill and verdict is Hermes's; nothing here is kept between visits.

import type { HermesRequest } from './skills-model.ts';

/** How far Hermes trusts a source: `builtin` ships with Hermes, `trusted` is a curated repository, everything else is `community`. */
export type Trust = 'builtin' | 'trusted' | 'community';

export interface HubSkill {
  name: string;
  description: string;
  /** The id of the hub source it comes from (`official`, `github`, …). */
  source: string;
  /** What Hermes installs, previews and scans it by. */
  identifier: string;
  trust: Trust;
  tags: string[];
  /** The folder Hermes files it under in the official catalogue; empty for the other sources. */
  category: string;
}

export interface HubSource {
  id: string;
  label: string;
  /** Hermes says a search of this source on its own is worth running: false when the Hermes index already stands in for it. */
  searchable: boolean;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

/** One skill as Hermes sends it; what is not a skill with an identifier is left out. */
function parseSkill(item: unknown): HubSkill[] {
  const { name, description, source, identifier, trust_level: trust, tags, category } = record(item);
  if (typeof identifier !== 'string' || identifier === '') return [];
  return [
    {
      name: text(name) || identifier,
      description: text(description),
      source: text(source),
      identifier,
      trust: trust === 'builtin' || trust === 'trusted' ? trust : 'community',
      tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [],
      category: text(category),
    },
  ];
}

const parseSkills = (list: unknown): HubSkill[] => (Array.isArray(list) ? list.flatMap(parseSkill) : []);

const profileQuery = (profile: string) => `profile=${encodeURIComponent(profile)}`;

/** Hermes's hub sources for a profile, with the featured skills of its index and what the profile has installed. */
export const hubSourcesPath = (profile: string) => `/api/skills/hub/sources?${profileQuery(profile)}`;

export interface HubSources {
  sources: HubSource[];
  /** The index's skills in its own order: Hermes's "featured". Empty when the index is not available. */
  featured: HubSkill[];
  indexAvailable: boolean;
}

export function parseHubSources(body: unknown): HubSources {
  const { sources, featured, index_available: indexAvailable } = record(body);
  return {
    sources: (Array.isArray(sources) ? sources : []).flatMap((item): HubSource[] => {
      const { id, label, searchable } = record(item);
      return typeof id === 'string' && id !== '' ? [{ id, label: text(label) || id, searchable: searchable !== false }] : [];
    }),
    featured: parseSkills(featured),
    indexAvailable: indexAvailable === true,
  };
}

/** A search of the hub: `source` is a source id, or `all`. Hermes answers up to 50 skills, de-duplicated across its sources. */
export const hubSearchPath = (profile: string, { q, source }: { q: string; source: string }) => `/api/skills/hub/search?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source || 'all')}&limit=50&${profileQuery(profile)}`;

export interface HubSearch {
  skills: HubSkill[];
  /** The sources that did not answer in time: the results are without them. */
  timedOut: string[];
}

export function parseHubSearch(body: unknown): HubSearch {
  const { results, timed_out: timedOut } = record(body);
  return { skills: parseSkills(results), timedOut: Array.isArray(timedOut) ? timedOut.filter((id): id is string => typeof id === 'string') : [] };
}

/** Hermes's official catalogue: every optional skill that ships with Hermes, which it keeps on disk, so it is there when a network search is not. */
export const hubOfficialPath = (profile: string) => `/api/skills/hub/official?${profileQuery(profile)}`;

export interface OfficialSkill extends HubSkill {
  /** The profile has it installed. */
  installed: boolean;
}

export function parseHubOfficial(body: unknown): OfficialSkill[] {
  const { skills } = record(body);
  return (Array.isArray(skills) ? skills : []).flatMap((item) => parseSkill(item).map((skill) => ({ ...skill, installed: record(item).installed === true })));
}

/** The hub's query, the source it is limited to (`all` for every one) and the page of results shown. All three live in the URL. */
export interface HubView {
  q: string;
  source: string;
  page: number;
}

/** The view from the URL's query; what is missing or not understood reads as the default. */
export function readHubView(search: Record<string, unknown>): HubView {
  const { q, source, page } = search;
  const number = Number(page);
  return {
    q: typeof q === 'string' ? q : '',
    source: typeof source === 'string' && source !== '' ? source : 'all',
    page: Number.isInteger(number) && number >= 1 ? number : 1,
  };
}

/** The query for a view: only what differs from the default, so the hub's own address stays clean. */
export function hubSearchParams(view: HubView): Record<string, string> {
  return {
    ...(view.q.trim() !== '' && { q: view.q }),
    ...(view.source !== 'all' && { source: view.source }),
    ...(view.page > 1 && { page: String(view.page) }),
  };
}

const PAGE_SIZE = 10;

export interface Page<Item> {
  items: Item[];
  /** The page shown: the one asked for, or the last when that is past the end. */
  page: number;
  pages: number;
  total: number;
}

/** One page of `items`, ten to a page. */
export function pageOf<Item>(items: readonly Item[], page: number): Page<Item> {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const shown = Math.min(Math.max(1, page), pages);
  return { items: items.slice((shown - 1) * PAGE_SIZE, shown * PAGE_SIZE), page: shown, pages, total: items.length };
}

/** The official skills a query finds: it matches their name, description, tags and category, ignoring case. An empty query keeps them all. */
export function officialMatches(official: readonly OfficialSkill[], q: string): OfficialSkill[] {
  const needle = q.trim().toLowerCase();
  return official.filter((skill) => needle === '' || [skill.name, skill.description, skill.category, ...skill.tags].some((field) => field.toLowerCase().includes(needle)));
}

/** The official list's matches and Hermes's search results as one list: each skill once (by identifier), the official ones first. */
export function combineResults(official: readonly HubSkill[], searched: readonly HubSkill[]): HubSkill[] {
  const seen = new Set<string>();
  return [...official, ...searched].filter((skill) => !seen.has(skill.identifier) && seen.add(skill.identifier));
}

const identifierQuery = (profile: string, identifier: string) => `identifier=${encodeURIComponent(identifier)}&${profileQuery(profile)}`;

/** Hermes's preview of a hub skill: SKILL.md and its file list, read without installing. */
export const hubPreviewPath = (profile: string, identifier: string) => `/api/skills/hub/preview?${identifierQuery(profile, identifier)}`;

export interface HubPreview extends Omit<HubSkill, 'category'> {
  repo: string;
  /** The whole SKILL.md, frontmatter included. */
  skillMd: string;
  /** The files the skill would install, by their place in its folder. */
  files: string[];
}

/** The preview in Hermes's answer; `undefined` when Hermes has none (an error answer has no skill in it). */
export function parseHubPreview(body: unknown): HubPreview | undefined {
  const { repo, skill_md: skillMd, files } = record(body);
  const [skill] = parseSkill(body);
  if (!skill || typeof skillMd !== 'string') return undefined;
  const { category: _category, ...rest } = skill;
  return { ...rest, repo: text(repo), skillMd, files: Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [] };
}

/** Hermes's install-time security scan of a hub skill, run on a quarantined copy: nothing is installed by asking. */
export const hubScanPath = (profile: string, identifier: string) => `/api/skills/hub/scan?${identifierQuery(profile, identifier)}`;

export type Verdict = 'safe' | 'caution' | 'dangerous';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface ScanFinding {
  severity: Severity;
  category: string;
  file: string;
  line: number;
  description: string;
}

export interface HubScan {
  name: string;
  verdict: Verdict;
  summary: string;
  /** What Hermes's install policy does with this verdict from this source: `allow`, `ask` (it would need a confirmation Hermes cannot take here) or `block`. */
  policy: 'allow' | 'ask' | 'block';
  policyReason: string;
  trust: Trust;
  findings: ScanFinding[];
  counts: Record<Severity, number>;
}

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

/** The scan in Hermes's answer; `undefined` when there is none. A verdict Caduceus does not know is read as `dangerous`: it is never taken for a pass. */
export function parseHubScan(body: unknown): HubScan | undefined {
  const { name, verdict, summary, policy, policy_reason: policyReason, trust_level: trust, findings, severity_counts: counts } = record(body);
  if (typeof verdict !== 'string' || typeof policy !== 'string') return undefined;
  const found = (Array.isArray(findings) ? findings : []).flatMap((item): ScanFinding[] => {
    const { severity, category, file, line, description } = record(item);
    return SEVERITIES.includes(severity as Severity) ? [{ severity: severity as Severity, category: text(category), file: text(file), line: typeof line === 'number' ? line : 0, description: text(description) }] : [];
  });
  const count = (severity: Severity) => (typeof record(counts)[severity] === 'number' ? (record(counts)[severity] as number) : found.filter((finding) => finding.severity === severity).length);
  return {
    name: text(name),
    verdict: verdict === 'safe' || verdict === 'caution' ? verdict : 'dangerous',
    summary: text(summary),
    policy: policy === 'allow' || policy === 'ask' ? policy : 'block',
    policyReason: text(policyReason),
    trust: trust === 'builtin' || trust === 'trusted' ? trust : 'community',
    findings: found,
    counts: { critical: count('critical'), high: count('high'), medium: count('medium'), low: count('low') },
  };
}

/** What the owner can do about installing a scanned skill. */
export type InstallGate =
  | { kind: 'installed' }
  /** The scan is clean and Hermes allows it. */
  | { kind: 'ready' }
  /** Hermes allows it although the verdict is not safe: Install asks for an explicit override. */
  | { kind: 'override' }
  /** Hermes's policy refuses it. Its install endpoint takes no `force`, so only Hermes's command line can go on. */
  | { kind: 'blocked'; reason: string; canForce: boolean };

/** Whether Install may be pressed, from the scan Hermes ran and whether the profile has the skill already. */
export function installGate(scan: HubScan, { installed }: { installed: boolean }): InstallGate {
  if (installed) return { kind: 'installed' };
  if (scan.policy !== 'allow') return { kind: 'blocked', reason: scan.policyReason, canForce: !/does not override/i.test(scan.policyReason) };
  return { kind: scan.verdict === 'safe' ? 'ready' : 'override' };
}

/** The command that installs a skill past a blocking policy, which only Hermes's own command line can do. The identifier is quoted for a shell. */
export const forceCommand = (profile: string, identifier: string) => `hermes -p ${profile} skills install '${identifier.replaceAll("'", "'\\''")}' --force`;

/** Installs a hub skill into the profile (Tier 3). Hermes runs its own `hermes -p <profile> skills install <identifier> --yes` in the background and answers with the name of that action. */
export const installRequest = (profile: string, identifier: string): HermesRequest => ({
  method: 'POST',
  path: `/api/skills/hub/install?${profileQuery(profile)}`,
  body: { identifier, profile },
});

/** Updates every hub skill of the profile that has a newer version (Tier 3): Hermes's own `hermes -p <profile> skills update`, in the background. */
export const updateRequest = (profile: string): HermesRequest => ({
  method: 'POST',
  path: `/api/skills/hub/update?${profileQuery(profile)}`,
  body: { profile },
});

/** The name of the background action Hermes started, from its answer to an install or an update; `undefined` when it named none. */
export function startedAction(body: unknown): string | undefined {
  const { name } = record(body);
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/** The log of one of Hermes's background actions and whether it still runs: the last 500 lines it printed. */
export const actionLogPath = (name: string) => `/api/actions/${encodeURIComponent(name)}/status?lines=500`;

export interface ActionLog {
  running: boolean;
  /** The process's exit code once it has ended; `null` while it runs or when Hermes does not know it. */
  exitCode: number | null;
  lines: string[];
}

export function readActionLog(body: unknown): ActionLog {
  const { running, exit_code: exitCode, lines } = record(body);
  return {
    // Anything but a plain "not running" is taken as still running: a reply that says nothing must not end the wait.
    running: running !== false,
    exitCode: typeof exitCode === 'number' ? exitCode : null,
    lines: Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : [],
  };
}

/** How an install ended. Hermes's install can print "Not installed" and still exit 0, so success is the skill being in the profile's list afterwards, not the exit code. */
export function installResult(log: ActionLog, installedNow: boolean): { ok: true } | { ok: false; message: string } {
  if (log.exitCode === 0 && installedNow) return { ok: true };
  const last = log.lines.map((line) => line.trim()).filter((line) => line !== '').at(-1);
  const said = last ? ` It said: ${last}` : '';
  return { ok: false, message: log.exitCode === 0 ? `Hermes finished but the skill is not installed.${said}` : `Hermes stopped with exit code ${log.exitCode ?? 'unknown'}.${said}` };
}

/** Hermes's curator for a profile: the background maintainer of its skills. */
export const curatorPath = (profile: string) => `/api/curator?${profileQuery(profile)}`;

export interface CuratorStatus {
  /** Hermes's config has the curator on. */
  enabled: boolean;
  /** Paused by the owner: Hermes does not start its own review while it is. A manual run still works. */
  paused: boolean;
  intervalHours: number | undefined;
  /** When the last review ran (an ISO time), `undefined` if it never has. */
  lastRunAt: string | undefined;
  minIdleHours: number | undefined;
  staleAfterDays: number | undefined;
  archiveAfterDays: number | undefined;
}

const numeric = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The curator in Hermes's answer; `undefined` for an answer that is not one. */
export function parseCurator(body: unknown): CuratorStatus | undefined {
  const { enabled, paused, interval_hours: interval, last_run_at: lastRun, min_idle_hours: idle, stale_after_days: stale, archive_after_days: archive } = record(body);
  if (typeof enabled !== 'boolean' && typeof paused !== 'boolean') return undefined;
  return { enabled: enabled !== false, paused: paused === true, intervalHours: numeric(interval), lastRunAt: typeof lastRun === 'string' && lastRun !== '' ? lastRun : undefined, minIdleHours: numeric(idle), staleAfterDays: numeric(stale), archiveAfterDays: numeric(archive) };
}

/** Pauses or resumes the profile's curator (Tier 1). */
export const pauseRequest = (profile: string, paused: boolean): HermesRequest => ({ method: 'PUT', path: `/api/curator/paused?${profileQuery(profile)}`, body: { paused } });

/** Runs a curator review now (Tier 2): Hermes's own `hermes -p <profile> curator run`, in the background. It archives and rewrites skills. */
export const runCuratorRequest = (profile: string): HermesRequest => ({ method: 'POST', path: `/api/curator/run?${profileQuery(profile)}` });
