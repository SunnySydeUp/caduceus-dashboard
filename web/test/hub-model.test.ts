import { describe, expect, test } from 'vitest';
import { combineResults, forceCommand, installGate, installResult, readActionLog, hubSearchParams, officialMatches, pageOf, parseHubPreview, parseHubScan, readHubView, type HubSkill, type OfficialSkill } from '../src/modules/skills/hub-model.ts';

// Agents › Skills › Hub: the query, the source and the page live in the URL, so a link or a reload shows the same results.
describe('the hub view in the URL', () => {
  test('is read from the query with defaults for what is missing or not understood, and written back with only what differs from them', () => {
    expect(readHubView({})).toEqual({ q: '', source: 'all', page: 1 });
    expect(readHubView({ q: 'git', source: 'official', page: '3' })).toEqual({ q: 'git', source: 'official', page: 3 });
    // A page that is not a whole number from 1 reads as the first page; a source or a query that is not text is the default.
    expect(readHubView({ page: '0' }).page).toBe(1);
    expect(readHubView({ page: '2.5' }).page).toBe(1);
    expect(readHubView({ page: 'x', source: 7, q: ['a'] })).toEqual({ q: '', source: 'all', page: 1 });

    expect(hubSearchParams({ q: '', source: 'all', page: 1 })).toEqual({});
    expect(hubSearchParams({ q: '  ', source: 'all', page: 1 })).toEqual({});
    expect(hubSearchParams({ q: 'git', source: 'github', page: 2 })).toEqual({ q: 'git', source: 'github', page: '2' });
    // A round trip gives the view back.
    const view = { q: 'sql review', source: 'skills-sh', page: 4 };
    expect(readHubView(hubSearchParams(view))).toEqual(view);
  });
});

const skill = (name: string, over: Partial<HubSkill> = {}): HubSkill => ({ name, description: '', source: 'github', identifier: `example/${name}`, trust: 'community', tags: [], category: '', ...over });
const official = (name: string, over: Partial<OfficialSkill> = {}): OfficialSkill => ({ ...skill(name, { source: 'official', identifier: `official/writing/${name}`, trust: 'builtin', category: 'writing' }), installed: false, ...over });

describe('pages of results', () => {
  test('hold ten at a time, count the pages, and a page past the end is the last one', () => {
    const items = Array.from({ length: 23 }, (_, index) => index + 1);
    expect(pageOf(items, 1)).toEqual({ items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page: 1, pages: 3, total: 23 });
    expect(pageOf(items, 3)).toEqual({ items: [21, 22, 23], page: 3, pages: 3, total: 23 });
    expect(pageOf(items, 9).page).toBe(3);
    expect(pageOf([], 1)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
    expect(pageOf(Array.from({ length: 10 }, (_, index) => index), 1).pages).toBe(1);
  });
});

describe('the official list as search results', () => {
  test('an empty query keeps all of it; a query matches the name, description, tags and category, in any case', () => {
    const list = [official('press-release', { description: 'Draft a press release.', tags: ['pr'] }), official('changelog', { description: 'Pull requests into notes.', tags: ['Git'] }), official('deploy-check', { category: 'devops' })];
    expect(officialMatches(list, '').map((entry) => entry.name)).toEqual(['press-release', 'changelog', 'deploy-check']);
    expect(officialMatches(list, '  ').length).toBe(3);
    expect(officialMatches(list, 'RELEASE').map((entry) => entry.name)).toEqual(['press-release']);
    expect(officialMatches(list, 'git').map((entry) => entry.name)).toEqual(['changelog']);
    expect(officialMatches(list, 'devops').map((entry) => entry.name)).toEqual(['deploy-check']);
    expect(officialMatches(list, 'notes').map((entry) => entry.name)).toEqual(['changelog']);
    expect(officialMatches(list, 'zzz')).toEqual([]);
  });

  test('joins Hermes\'s search results once each: by identifier, the official entry first, and a search hit that is the same skill adds nothing', () => {
    const merged = combineResults([official('changelog')], [skill('git-flow'), skill('changelog', { source: 'official', identifier: 'official/writing/changelog', trust: 'builtin' }), skill('sql-review')]);
    expect(merged.map((entry) => entry.identifier)).toEqual(['official/writing/changelog', 'example/git-flow', 'example/sql-review']);
  });
});

describe('Hermes\'s answers when it has no such skill', () => {
  // Asking Hermes for a skill it cannot resolve takes it half a minute of retries against the hub's sources, so this is read from its error answer (404 `{ "detail": … }`) instead.
  test('are no preview and no scan, never an empty one that could be taken for a pass', () => {
    const missing = { detail: 'Skill not found: official/devops/not-there' };
    expect(parseHubPreview(missing)).toBeUndefined();
    expect(parseHubScan(missing)).toBeUndefined();
    expect(parseHubScan(undefined)).toBeUndefined();
  });

  test('a verdict or a policy Caduceus does not know is read as the worst one', () => {
    const scan = parseHubScan({ name: 'x', verdict: 'mystery', policy: 'maybe', trust_level: 'weird', findings: [], severity_counts: {} })!;
    expect(scan).toMatchObject({ verdict: 'dangerous', policy: 'block', trust: 'community' });
  });
});

describe('what the security scan allows', () => {
  // Hermes's answers, as the scan endpoint gave them for a skill from a local official fixture (builtin) and for a skill served from a community source.
  const scanOf = (over: Record<string, unknown>) => parseHubScan({ name: 'git-flow', verdict: 'safe', summary: 'git-flow: clean scan', policy: 'allow', policy_reason: 'Allowed (community source, safe verdict)', trust_level: 'community', findings: [], severity_counts: { critical: 0, high: 0, medium: 0, low: 0 }, ...over })!;

  test('a clean scan that Hermes allows opens Install, and a skill that is installed has nothing to install', () => {
    expect(installGate(scanOf({}), { installed: false })).toEqual({ kind: 'ready' });
    expect(installGate(scanOf({}), { installed: true })).toEqual({ kind: 'installed' });
  });

  test('a verdict that is not safe, which Hermes still allows, needs the owner to override it explicitly', () => {
    expect(installGate(scanOf({ verdict: 'dangerous', trust_level: 'builtin', policy_reason: 'Allowed (builtin source, dangerous verdict)' }), { installed: false })).toEqual({ kind: 'override' });
    expect(installGate(scanOf({ verdict: 'caution', trust_level: 'trusted' }), { installed: false })).toEqual({ kind: 'override' });
  });

  test('a policy that blocks it, or would ask, is the end of it here: Hermes\'s install endpoint cannot be told to force, so the reason is shown and the command line is the way', () => {
    const blocked = scanOf({ verdict: 'caution', policy: 'block', policy_reason: 'Blocked (community source + caution verdict, 2 findings). Use --force to override.' });
    expect(installGate(blocked, { installed: false })).toEqual({ kind: 'blocked', reason: 'Blocked (community source + caution verdict, 2 findings). Use --force to override.', canForce: true });
    const hard = scanOf({ verdict: 'dangerous', policy: 'block', policy_reason: 'Blocked (community source + dangerous verdict, 3 findings). --force does not override a dangerous verdict.' });
    expect(installGate(hard, { installed: false })).toMatchObject({ kind: 'blocked', canForce: false });
    expect(installGate(scanOf({ verdict: 'dangerous', policy: 'ask', policy_reason: 'Requires confirmation' }), { installed: false })).toMatchObject({ kind: 'blocked' });
  });

  test('the command line that forces an install names the profile and quotes the identifier for a shell', () => {
    expect(forceCommand('coder', 'example/skills/git-flow')).toBe("hermes -p coder skills install 'example/skills/git-flow' --force");
    expect(forceCommand('coder', "https://x.test/a b/it's.md")).toBe("hermes -p coder skills install 'https://x.test/a b/it'\\''s.md' --force");
  });
});

describe('how an install or an update ended', () => {
  // `hermes skills install` can print "Not installed" and still exit with 0, so the exit code alone does not say it worked: the profile's list does.
  const ended = (exit_code: number | null, lines: string[]) => readActionLog({ running: false, exit_code, lines });

  test('a log that is still running, or that says nothing, is not an ending', () => {
    expect(readActionLog({ running: true, exit_code: null, lines: ['a'] })).toEqual({ running: true, exitCode: null, lines: ['a'] });
    expect(readActionLog({}).running).toBe(true);
    expect(readActionLog(undefined).running).toBe(true);
  });

  test('exit 0 with the skill in the profile is done; exit 0 without it, and a non-zero exit, are failures that say what Hermes printed last', () => {
    expect(installResult(ended(0, ['Fetching: official/x', 'Installed: x']), true)).toEqual({ ok: true });
    expect(installResult(ended(0, ['Fetching: official/x', 'Not installed: blocked by the scan', '']), false)).toEqual({ ok: false, message: 'Hermes finished but the skill is not installed. It said: Not installed: blocked by the scan' });
    expect(installResult(ended(1, ['Traceback', 'RuntimeError: no network']), false)).toEqual({ ok: false, message: 'Hermes stopped with exit code 1. It said: RuntimeError: no network' });
    expect(installResult(ended(2, []), false)).toEqual({ ok: false, message: 'Hermes stopped with exit code 2.' });
    expect(installResult(ended(null, ['x']), false)).toMatchObject({ ok: false });
  });
});
