import { describe, expect, test } from 'vitest';
import { bySource, cacheShare, clampDays, combine, daysFromSearch, costOf, dailySeries, heatmap, hourOfDay, readQuota, readSessions, readUsage, usagePath } from '../src/modules/insights/insights-model.ts';

// Observe › Insights over a stub upstream: answers shaped as Hermes 0.21.4 serves them (`GET /api/analytics/usage` per profile, `GET /api/profiles/sessions`,
// `session.usage`'s account lines), with numbers chosen so the expected values below are plain sums.
const defaultAnswer = {
  period_days: 30,
  totals: { total_input: 1500, total_output: 600, total_cache_read: 500, total_reasoning: 90, total_estimated_cost: 3.5, total_actual_cost: 0, total_sessions: 4, total_api_calls: 20 },
  daily: [
    { day: '2026-10-12', input_tokens: 1000, output_tokens: 400, cache_read_tokens: 300, reasoning_tokens: 50, estimated_cost: 2, actual_cost: 0, sessions: 3, api_calls: 12 },
    { day: '2026-10-14', input_tokens: 500, output_tokens: 200, cache_read_tokens: 200, reasoning_tokens: 40, estimated_cost: 1.5, actual_cost: 1.25, sessions: 1, api_calls: 8 },
  ],
  by_model: [
    { model: 'claude-sonnet', input_tokens: 1200, output_tokens: 500, estimated_cost: 3, sessions: 3, api_calls: 16 },
    { model: 'gpt-mini', input_tokens: 300, output_tokens: 100, estimated_cost: 0.5, sessions: 1, api_calls: 4 },
  ],
  skills: { summary: {}, top_skills: [{ skill: 'plan', view_count: 4, manage_count: 1, total_count: 5, percentage: 50 }, { skill: 'debug', view_count: 2, manage_count: 0, total_count: 2, percentage: 20 }] },
};
const coderAnswer = {
  totals: { total_input: 400, total_output: 100, total_cache_read: 0, total_reasoning: 0, total_estimated_cost: 1, total_actual_cost: 0.75, total_sessions: 2, total_api_calls: 5 },
  daily: [{ day: '2026-10-14', input_tokens: 400, output_tokens: 100, cache_read_tokens: 0, reasoning_tokens: 0, estimated_cost: 1, actual_cost: 0.75, sessions: 2, api_calls: 5 }],
  by_model: [{ model: 'claude-sonnet', input_tokens: 400, output_tokens: 100, estimated_cost: 1, sessions: 2, api_calls: 5 }],
  skills: { top_skills: [{ skill: 'plan', view_count: 1, manage_count: 0, total_count: 1 }] },
};

describe('the period’s usage, from one analytics answer per profile', () => {
  const insights = combine([readUsage('default', defaultAnswer), readUsage('coder', coderAnswer)]);

  test('adds every profile into the totals, keeps estimated and billed cost apart, and reads what share of the prompt came from the cache', () => {
    expect(insights.totals).toEqual({ inputTokens: 1900, outputTokens: 700, cacheReadTokens: 500, reasoningTokens: 90, estimatedCost: 4.5, actualCost: 0.75, sessions: 6, apiCalls: 25 });
    expect(cacheShare(insights.totals)).toBeCloseTo((500 / 2400) * 100, 5);
    expect(cacheShare(readUsage('x', {}).totals)).toBeUndefined();
    // Each day counts its billed cost where it has one, else its estimate: 2 + 1.25 for default, 0.75 for coder. (Not the totals' bill of 0.75 alone.)
    expect(insights.cost).toBe(4);
  });

  test('breaks the period down by day (the same day in two profiles is one row), by model (the same model in two profiles is one card, the largest first), by profile and by skill', () => {
    expect(insights.daily.map((row) => [row.day, row.sessions, row.inputTokens + row.outputTokens, costOf(row)])).toEqual([
      ['2026-10-12', 3, 1400, 2],
      // Billed beats estimated, and both profiles' day add up: 1.25 + 0.75.
      ['2026-10-14', 3, 1200, 2],
    ]);
    expect(insights.models.map((row) => [row.model, row.inputTokens + row.outputTokens, row.estimatedCost, row.sessions])).toEqual([
      ['claude-sonnet', 2200, 4, 5],
      ['gpt-mini', 400, 0.5, 1],
    ]);
    expect(insights.profiles.map((row) => [row.profile, row.cost])).toEqual([
      ['default', 3.25],
      ['coder', 0.75],
    ]);
    expect(insights.skills).toEqual([
      { skill: 'plan', views: 5, edits: 1, total: 6 },
      { skill: 'debug', views: 2, edits: 0, total: 2 },
    ]);
  });

  test('reads an answer that is not usable as nothing, rather than failing the page', () => {
    expect(combine([readUsage('default', null), readUsage('coder', { daily: 'x', by_model: [{ model: '' }], skills: 3 })])).toMatchObject({ totals: { sessions: 0 }, daily: [], models: [], skills: [] });
  });
});

describe('the session list views', () => {
  const page = readSessions({
    total: 4,
    sessions: [
      { id: 'a', source: 'telegram', started_at: Date.parse('2026-10-14T09:10:00Z') / 1000, input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.5, actual_cost_usd: null },
      { id: 'b', source: 'cli', started_at: Date.parse('2026-10-14T09:50:00Z') / 1000, input_tokens: 10, output_tokens: 5, estimated_cost_usd: 0.1, actual_cost_usd: 0.4 },
      { id: 'c', source: 'telegram', started_at: Date.parse('2026-10-13T22:00:00Z') / 1000, input_tokens: 1, output_tokens: 1, estimated_cost_usd: 0.25 },
      { id: 'old', source: 'cron', started_at: Date.parse('2026-08-01T00:00:00Z') / 1000, input_tokens: 9999, estimated_cost_usd: 9 },
      { id: 'no-start', source: 'cli' },
    ],
  });
  const since = Date.parse('2026-10-01T00:00:00Z') / 1000;

  test('groups the period’s sessions by where they came from, the costliest first, counting a billed cost over an estimate', () => {
    expect(page.total).toBe(4);
    expect(bySource(page.rows, since).map((row) => [row.source, row.sessions, costOf(row), row.inputTokens + row.outputTokens])).toEqual([
      ['telegram', 2, 0.75, 152],
      ['cli', 1, 0.4, 15],
    ]);
  });

  test('counts when sessions started, by hour of the day on the clock it is given', () => {
    const utc = (seconds: number) => new Date(seconds * 1000).getUTCHours();
    const hours = hourOfDay(page.rows, since, utc);
    expect(hours).toHaveLength(24);
    expect(hours.flatMap((count, hour) => (count > 0 ? [[hour, count]] : []))).toEqual([[9, 2], [22, 1]]);
    // On a clock ten hours ahead the same sessions fall in other hours.
    expect(hourOfDay(page.rows, since, (seconds) => (utc(seconds) + 10) % 24).flatMap((count, hour) => (count > 0 ? [[hour, count]] : []))).toEqual([[8, 1], [19, 2]]);
  });
});

describe('the per-day series', () => {
  test('has a row for every day of the period up to today, empty where Hermes has none, oldest first', () => {
    const series = dailySeries(readUsage('default', defaultAnswer).daily, 4, Date.parse('2026-10-14T23:30:00Z'));

    expect(series.map((row) => [row.day, row.sessions, costOf(row)])).toEqual([
      ['2026-10-11', 0, 0],
      ['2026-10-12', 3, 2],
      ['2026-10-13', 0, 0],
      ['2026-10-14', 1, 1.25],
    ]);
  });
});

describe('the activity heatmap', () => {
  const daily = readUsage('default', defaultAnswer).daily;

  test('is a column per Monday-to-Sunday week and a cell per day of the period, padded at both ends, with levels against the busiest day', () => {
    // Today is Wednesday 14 October; seven days back is Thursday 8 October.
    const weeks = heatmap(daily, 7, Date.parse('2026-10-14T18:00:00Z'));

    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.map((cell) => cell?.day)).toEqual([undefined, undefined, undefined, '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(weeks[1]!.map((cell) => cell?.day)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', undefined, undefined, undefined, undefined]);
    expect(weeks[1]!.map((cell) => cell && [cell.sessions, cell.level])).toEqual([[3, 4], [0, 0], [1, 2], undefined, undefined, undefined, undefined]);
  });
});

describe('the provider quota card', () => {
  test('reads the windows Hermes renders from session.usage, with what is left, when each resets, and the lines that are not windows', () => {
    const quota = readQuota(['📈 Account limits', 'Provider: openai-codex (Plus)', 'Session: 60% remaining (40% used) • resets in 2h 10m', 'Weekly: unavailable', 'Credits: $4.20 left']);

    expect(quota).toEqual({
      title: 'Account limits',
      provider: 'openai-codex (Plus)',
      windows: [
        { label: 'Session', usedPercent: 40, note: 'resets in 2h 10m' },
        { label: 'Weekly', usedPercent: undefined, note: undefined },
      ],
      details: ['Credits: $4.20 left'],
    });
  });

  test('is not available for a provider that gave no account lines', () => {
    expect(readQuota(undefined)).toBeUndefined();
    expect(readQuota([])).toBeUndefined();
    expect(readQuota(['📈 Account limits', 'Provider: openrouter'])).toBeUndefined();
  });
});

describe('the period', () => {
  test('is any whole number of days from 1 to 365, and the analytics path names the profile and the days', () => {
    expect([clampDays(0), clampDays(1), clampDays(29.6), clampDays(365), clampDays(4000), clampDays(Number.NaN)]).toEqual([1, 1, 30, 365, 365, 30]);
    expect(usagePath('my profile', 90)).toBe('/api/analytics/usage?days=90&profile=my%20profile');
  });
});

test('the period is kept in the address: ?days= is read back, anything else is 30 days', () => {
  expect([daysFromSearch({ days: '7' }), daysFromSearch({ days: 90 }), daysFromSearch({ days: '4000' }), daysFromSearch({ days: 'x' }), daysFromSearch({})]).toEqual([7, 90, 365, 30, 30]);
});
