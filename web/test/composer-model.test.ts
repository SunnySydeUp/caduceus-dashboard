import { describe, expect, test } from 'vitest';
import { normaliseChipPreference, parseChipPreference, type ChipPreference } from '@caduceus/contracts/chat-chips';
import { afterCompression, confirmedIssue, contextRing, credentialIssue, mergeUsage, parseEnv, moveChip, shownChips, toggleChip } from '../src/modules/chat/composer-model.ts';

// What the composer's chips show and how the owner rearranges them (M1 #08), free of the DOM.
describe('the chips the composer shows', () => {
  test('the chips of a preference come in its order, without the hidden ones', () => {
    expect(shownChips({ order: ['model', 'workspace', 'reasoning', 'toolsets', 'profile'], hidden: ['toolsets', 'profile'] })).toEqual(['model', 'workspace', 'reasoning']);
  });

  test('moving a chip swaps it with its neighbour, and the ends stay where they are', () => {
    const start: ChipPreference = { order: ['profile', 'model', 'reasoning', 'workspace', 'toolsets'], hidden: [] };
    expect(moveChip(start, 'model', 'earlier').order).toEqual(['model', 'profile', 'reasoning', 'workspace', 'toolsets']);
    expect(moveChip(start, 'model', 'later').order).toEqual(['profile', 'reasoning', 'model', 'workspace', 'toolsets']);
    expect(moveChip(start, 'profile', 'earlier')).toEqual(start);
    expect(moveChip(start, 'toolsets', 'later')).toEqual(start);
  });

  test('a hidden chip keeps its place in the order, so showing it again puts it back', () => {
    const start: ChipPreference = { order: ['profile', 'model', 'reasoning', 'workspace', 'toolsets'], hidden: [] };
    const hidden = toggleChip(start, 'reasoning');
    expect(hidden).toEqual({ order: start.order, hidden: ['reasoning'] });
    expect(toggleChip(hidden, 'reasoning')).toEqual(start);
  });

  test('a stored preference from another version is made whole: unknown chips go, new ones join at the end, and a strict parse refuses it', () => {
    const old = { order: ['model', 'bogus', 'model', 'profile'], hidden: ['bogus', 'profile', 'profile'] };
    expect(normaliseChipPreference(old)).toEqual({ order: ['model', 'profile', 'reasoning', 'workspace', 'toolsets'], hidden: ['profile'] });
    expect(normaliseChipPreference(undefined)).toEqual({ order: ['profile', 'model', 'reasoning', 'workspace', 'toolsets'], hidden: [] });
    expect(parseChipPreference(old)).toBeUndefined();
  });
});

describe('the context ring', () => {
  test('shows how full the window is with a tone that warns from 70% and turns urgent from 90%, and says so in words', () => {
    expect(contextRing({ context_used: 1000, context_max: 200000, context_percent: 0 })).toMatchObject({ percent: 1, tone: 'ok', label: '1% of the context window used (1,000 of 200,000 tokens)' });
    expect(contextRing({ context_used: 150000, context_max: 200000, context_percent: 75 })).toMatchObject({ percent: 75, tone: 'warn' });
    expect(contextRing({ context_used: 190000, context_max: 200000, context_percent: 95 })).toMatchObject({ percent: 95, tone: 'danger' });
    // The ring works the percentage out from the tokens: Hermes's own is rounded down (0% for the first test above), and may be missing.
    expect(contextRing({ context_used: 50000, context_max: 200000 })).toMatchObject({ percent: 25, tone: 'ok' });
  });

  test('says it does not know yet when Hermes has not measured the window, and never draws past full', () => {
    expect(contextRing(undefined)).toEqual({ percent: undefined, tone: 'unknown', label: 'Context use is not known until the first reply', cost: undefined, cache: undefined });
    expect(contextRing({ context_max: 200000 })).toMatchObject({ percent: undefined, tone: 'unknown' });
    expect(contextRing({ context_used: 300000, context_max: 200000 })).toMatchObject({ percent: 100, tone: 'danger' });
  });

  test('carries the cost and the cache hit rate Hermes reports, and leaves them out when it reports none', () => {
    expect(contextRing({ context_used: 10, context_max: 100, cost_usd: 0.01234, cache_hit_pct: 62.4 })).toMatchObject({ cost: '$0.0123', cache: '62% cache hits' });
    expect(contextRing({ context_used: 10, context_max: 100, cost_usd: 0, cache_hit_pct: 0 })).toMatchObject({ cost: '$0.0000', cache: '0% cache hits' });
    expect(contextRing({ context_used: 10, context_max: 100, cost_usd: null, cache_hit_pct: null })).toMatchObject({ cost: undefined, cache: undefined });
  });
});

describe('usage after Compress', () => {
  test('takes the size Hermes says the request has now, against the window it had, because Hermes reports no context for a session it has just compressed', () => {
    const before = { context_used: 26710, context_max: 256000, context_percent: 10, total: 36400, cost_usd: 0.5 };
    const after = afterCompression(before, { before_tokens: 26710, after_tokens: 23446, usage: { total: 36400, calls: 8, compressions: 1 } });
    expect(after).toMatchObject({ context_used: 23446, context_max: 256000, context_percent: 9, compressions: 1, total: 36400, cost_usd: 0.5 });
  });

  test('keeps the context it had when Hermes changed nothing (its sizes are estimates of the whole request, not the provider count)', () => {
    const before = { context_used: 20000, context_max: 256000, context_percent: 8 };
    expect(afterCompression(before, { before_tokens: 21481, after_tokens: 21481, summary: { noop: true }, usage: { total: 5 } })).toEqual({ ...before, total: 5 });
  });

  test('keeps what it had when Hermes gave no new size', () => {
    const before = { context_used: 100, context_max: 1000, context_percent: 10 };
    expect(afterCompression(before, {})).toEqual(before);
    expect(afterCompression(undefined, { after_tokens: 500 })).toMatchObject({ context_used: 500 });
  });
});

describe('usage that arrives in pieces', () => {
  test('a newer report replaces what it says and keeps what it leaves out or says nothing of, so the ring does not blank when Hermes reports tokens without a context size', () => {
    const before = { input: 10, context_used: 500, context_max: 1000, cost_usd: 0.2 };
    expect(mergeUsage(before, { input: 20, context_used: null, context_max: undefined, cost_usd: 0.3 })).toEqual({ input: 20, context_used: 500, context_max: 1000, cost_usd: 0.3 });
    expect(mergeUsage(undefined, { input: 1 })).toEqual({ input: 1 });
  });
});

/** Rows as Hermes's `GET /api/env` gives them (shape from a real Hermes 0.21.4); a key that is set comes with a redacted preview. */
const envBody = (set: string[]) =>
  Object.fromEntries(
    [
      ['ANTHROPIC_API_KEY', 'anthropic', true],
      ['ANTHROPIC_TOKEN', 'anthropic', true],
      ['ANTHROPIC_BASE_URL', 'anthropic', false],
      ['OPENROUTER_API_KEY', 'openrouter', true],
      ['TELEGRAM_BOT_TOKEN', '', true],
    ].map(([name, provider, password]) => [name, { is_set: set.includes(name as string), redacted_value: set.includes(name as string) ? 'sk-a...WXYZ' : null, category: provider ? 'provider' : 'messaging', is_password: password, provider, provider_label: provider }]),
  );

describe('the credential warning', () => {
  test('a provider whose key variables are all unset is a problem, and names the variable a key goes in (the first that holds a secret)', () => {
    expect(credentialIssue({ provider: 'anthropic', env: parseEnv(envBody([])) })).toEqual({ provider: 'anthropic', keyVar: 'ANTHROPIC_API_KEY', reason: 'Hermes has no key for anthropic.' });
  });

  test('any one of the key variables of the provider being set is a credential, and so is a provider Hermes keeps no variable for', () => {
    expect(credentialIssue({ provider: 'anthropic', env: parseEnv(envBody(['ANTHROPIC_TOKEN'])) })).toBeUndefined();
    expect(credentialIssue({ provider: 'custom', env: parseEnv(envBody([])) })).toBeUndefined();
    expect(credentialIssue({ provider: undefined, env: parseEnv(envBody([])) })).toBeUndefined();
  });

  test('a missing key variable is only a warning when Hermes itself says it cannot serve the provider: a bridge or a sign-in is a credential the environment cannot show', () => {
    const candidate = credentialIssue({ provider: 'anthropic', env: parseEnv(envBody([])) })!;
    expect(confirmedIssue(candidate, { ok: true })).toBeUndefined();
    expect(confirmedIssue(candidate, { ok: false, error: 'No credentials found' })).toEqual(candidate);
    // When Hermes cannot be asked, the environment's word stands: the owner is told, not left to find out on the first message.
    expect(confirmedIssue(candidate, undefined)).toEqual(candidate);
    expect(confirmedIssue(undefined, { ok: false })).toBeUndefined();
  });

  test('reading the environment keeps names and whether each is set, and never a value or a preview of one', () => {
    const rows = parseEnv(envBody(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']));
    expect(rows.find((row) => row.name === 'ANTHROPIC_API_KEY')).toEqual({ name: 'ANTHROPIC_API_KEY', provider: 'anthropic', isSet: true, isSecret: true });
    expect(JSON.stringify(rows)).not.toContain('WXYZ');
    expect(parseEnv(null)).toEqual([]);
    expect(parseEnv({ BROKEN: 7 })).toEqual([]);
  });
});
