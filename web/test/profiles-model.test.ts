import { describe, expect, test } from 'vitest';
import { availableTabs, tabPath } from '../src/modules/profiles/profile-tabs.ts';
import { cliCommand, deleteRefusal, gatewayView, overviewMetrics, parseProfiles, renameProblem, type ProfileCard } from '../src/modules/profiles/profiles-model.ts';

/** A profile as Hermes's `GET /api/profiles` lists it (only what Caduceus reads). */
const entry = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  is_default: name === 'default',
  model: null,
  provider: null,
  skill_count: 0,
  gateway_running: false,
  description: '',
  description_auto: false,
  display_name: '',
  ...extra,
});

const card = (name: string, extra: Partial<ProfileCard> = {}): ProfileCard => ({
  name,
  displayName: '',
  description: '',
  descriptionAuto: false,
  model: null,
  provider: null,
  skillCount: 0,
  gatewayRunning: false,
  isRoot: name === 'default',
  isDefault: name === 'default',
  path: '',
  ...extra,
});

describe('reading Hermes\'s profile list', () => {
  test('one card per profile, with the sticky default marked, and entries that are not profiles ignored', () => {
    const cards = parseProfiles(
      {
        profiles: [
          entry('default', { model: 'glm-5', provider: 'zai', skill_count: 58, gateway_running: true }),
          entry('coder', { description: 'Writes code', description_auto: true, display_name: 'Cody' }),
          { description: 'no name' },
          'nonsense',
        ],
      },
      { active: 'coder' },
    );

    expect(cards).toEqual([
      card('default', { model: 'glm-5', provider: 'zai', skillCount: 58, gatewayRunning: true, isDefault: false }),
      card('coder', { description: 'Writes code', descriptionAuto: true, displayName: 'Cody', isDefault: true }),
    ]);
  });

  test('a body Hermes did not shape as expected gives no cards rather than an error; the default falls back to "default"', () => {
    expect(parseProfiles(undefined, undefined)).toEqual([]);
    expect(parseProfiles({ profiles: 'x' }, {})).toEqual([]);
    expect(parseProfiles({ profiles: [entry('default')] }, { active: 7 })).toEqual([card('default')]);
  });
});

describe('Copy CLI command', () => {
  test('is the `hermes -p <name>` command that starts Hermes on that profile, exactly', () => {
    expect(cliCommand('coder')).toBe('hermes -p coder');
    expect(cliCommand('default')).toBe('hermes -p default');
    expect(cliCommand('my-agent_2')).toBe('hermes -p my-agent_2');
  });
});

describe('what may be deleted', () => {
  const all = [card('default', { isDefault: false }), card('coder', { isDefault: true }), card('writer')];

  test('the profile that is Hermes\'s default, and the one that is its root home, are refused with a reason', () => {
    expect(deleteRefusal(all[1], all)).toMatch(/default profile.*Make another profile the default first/);
    expect(deleteRefusal(all[0], all)).toMatch(/root profile.*cannot be deleted/);
  });

  test('the last profile is refused', () => {
    expect(deleteRefusal(card('only', { isDefault: false }), [card('only', { isDefault: false })])).toMatch(/only profile/);
  });

  test('any other profile may be deleted', () => {
    expect(deleteRefusal(all[2], all)).toBeUndefined();
  });
});

describe('the overview numbers', () => {
  const usage = { totals: { total_sessions: 12, total_input: 1500, total_output: 500, total_api_calls: 40 }, period_days: 30 };
  const stats = { by_status: { done: 9 }, by_assignee: { coder: { done: 6, blocked: 2, running: 1, ready: 3, todo: 2 } } };

  test('sessions and tokens come from the profile\'s usage analytics; runs and success rate from the Kanban tasks assigned to it', () => {
    expect(overviewMetrics({ usage, stats, assignees: undefined, profile: 'coder', mcpServers: { servers: [{}, {}] }, skillCount: 58 })).toEqual({
      sessions: 12,
      tokens: 2000,
      skills: 58,
      mcpServers: 2,
      // Started: running + blocked + review + done. Finished: done + blocked.
      runs: 9,
      successRate: 6 / 8,
      queued: 5,
    });
  });

  test('the assignees list, when it names the profile, is the source of its counts', () => {
    const assignees = { assignees: [{ name: 'coder', on_disk: true, counts: { done: 3, blocked: 1 } }] };
    const metrics = overviewMetrics({ usage, stats, assignees, profile: 'coder', mcpServers: undefined, skillCount: 0 });
    expect(metrics).toMatchObject({ runs: 4, successRate: 0.75, queued: 0 });
  });

  test('a profile with no runs, no sessions, no tokens and no answers shows zeros, never an error', () => {
    const zeros = { sessions: 0, tokens: 0, skills: 0, mcpServers: 0, runs: 0, successRate: 0, queued: 0 };
    expect(overviewMetrics({ usage: undefined, stats: undefined, assignees: undefined, profile: 'new', mcpServers: undefined, skillCount: 0 })).toEqual(zeros);
    // What Hermes answers for a profile with an empty history: nulls, not numbers.
    const empty = { totals: { total_sessions: 0, total_input: null, total_output: null } };
    expect(overviewMetrics({ usage: empty, stats: { by_status: {}, by_assignee: {} }, assignees: { assignees: [{ name: 'new', counts: {} }] }, profile: 'new', mcpServers: { servers: [] }, skillCount: 0 })).toEqual(zeros);
  });
});

describe('a profile\'s live gateway status', () => {
  test('running is Running; a gateway that is up but not yet running shows its state; down is Stopped; unknown says so', () => {
    expect(gatewayView({ gateway_running: true, gateway_state: 'running' })).toEqual({ badge: 'online', label: 'Running' });
    expect(gatewayView({ gateway_running: true, gateway_state: null })).toEqual({ badge: 'online', label: 'Running' });
    expect(gatewayView({ gateway_running: true, gateway_state: 'draining' })).toEqual({ badge: 'degraded', label: 'Draining' });
    expect(gatewayView({ gateway_running: false, gateway_state: 'stopped' })).toEqual({ badge: 'offline', label: 'Stopped' });
    expect(gatewayView({ gateway_running: false, gateway_state: 'startup_failed' })).toEqual({ badge: 'failed', label: 'Failed to start' });
    expect(gatewayView(undefined)).toEqual({ badge: 'stale', label: 'Status unknown' });
  });
});

describe('a new name for a profile', () => {
  const names = ['default', 'coder', 'writer'];

  test('is checked against Hermes\'s rule and the names taken, before Hermes is asked', () => {
    expect(renameProblem('coder', 'coder-2', names)).toBeUndefined();
    expect(renameProblem('coder', '  Coder-2 ', names)).toBeUndefined();
    expect(renameProblem('coder', '', names)).toBe('Enter a name.');
    expect(renameProblem('coder', 'coder', names)).toBe('Choose a different name.');
    expect(renameProblem('coder', 'writer', names)).toBe('A profile called “writer” already exists.');
    expect(renameProblem('coder', 'default', names)).toBe('“default” is reserved.');
    expect(renameProblem('coder', 'has space', names)).toMatch(/lowercase letters, numbers, - or _/);
    expect(renameProblem('coder', '-dash', names)).toMatch(/starting with a letter or number/);
    expect(renameProblem('coder', 'x'.repeat(65), names)).toMatch(/up to 64 characters/);
    expect(renameProblem('coder', 'root', names)).toBe('“root” is reserved.');
  });

  test('the root profile takes any display name, which Hermes keeps beside its fixed id', () => {
    expect(renameProblem('default', 'Hermes Prime', names, { root: true })).toBeUndefined();
    expect(renameProblem('default', '   ', names, { root: true })).toBe('Enter a name.');
  });
});

describe('the tabs of a profile\'s detail', () => {
  test('only the tabs whose screens exist are listed, in the order of the information architecture, and Overview is the profile\'s own address', () => {
    expect(availableTabs(['danger', 'identity', 'overview']).map((tab) => tab.label)).toEqual(['Overview', 'Identity', 'Danger zone']);
    expect(availableTabs(['model', 'skills', 'overview', 'files']).map((tab) => tab.id)).toEqual(['overview', 'skills', 'model', 'files']);
    expect(tabPath('coder', 'overview')).toBe('/agents/profiles/coder');
    expect(tabPath('coder', 'danger')).toBe('/agents/profiles/coder/danger');
  });
});
