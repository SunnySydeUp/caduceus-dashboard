import { describe, expect, test } from 'vitest';
import { parseCatalogue, searchCatalogue } from '../src/modules/models/model-catalogue.ts';
import { fanoutValue, parseFanout, parseMoa, presetProblems } from '../src/modules/models/moa.ts';
import { parseAuxiliary, readModelInfo, readReasoning, readSetAnswer, slotWords } from '../src/modules/models/model-settings.ts';

describe('the auxiliary slots', () => {
  test('a slot Hermes reports that the screen has no words for is listed, named from its id, and none is invented', () => {
    const aux = parseAuxiliary({
      tasks: [
        { task: 'vision', provider: 'auto', model: '', reasoning_effort: null },
        { task: 'goal_judge', provider: 'openrouter', model: 'x/y', reasoning_effort: 'low' },
        { provider: 'auto', model: '' },
      ],
      main: { provider: 'anthropic', model: 'claude-sonnet-5' },
    });
    expect(aux.slots).toEqual([
      { task: 'vision', provider: 'auto', model: '', isAuto: true, reasoningEffort: undefined },
      { task: 'goal_judge', provider: 'openrouter', model: 'x/y', isAuto: false, reasoningEffort: 'low' },
    ]);
    expect(slotWords('goal_judge')).toEqual({ label: 'Goal judge', summary: undefined });
    expect(slotWords('title_generation').label).toBe('Title generation');
  });
});

describe('what Hermes answers', () => {
  test('a model set that is not asking for confirmation is a save, whatever else it says', () => {
    expect(readSetAnswer({ ok: true, scope: 'main' })).toEqual({ kind: 'saved' });
    expect(readSetAnswer({ ok: false, confirm_required: true, confirm_message: 'Careful' })).toEqual({ kind: 'confirm', message: 'Careful' });
    expect(readSetAnswer(undefined)).toEqual({ kind: 'saved' });
  });

  test('the reasoning default reads YAML false as "none" and a missing key as not set', () => {
    expect(readReasoning({ agent: { reasoning_effort: false } })).toBe('none');
    expect(readReasoning({ agent: {} })).toBe('');
    expect(readReasoning(undefined)).toBe('');
  });

  test('a profile with no model has no model info', () => {
    expect(readModelInfo({ model: '', provider: '', capabilities: {} })).toBeUndefined();
  });
});

describe('the catalogue', () => {
  test('a provider with no models is labelled as possibly unreachable, and a locked or free model says so', () => {
    const catalogue = parseCatalogue({
      model: 'a',
      provider: 'nous',
      providers: [
        { slug: 'down', name: 'Down', authenticated: true, models: [], total_models: 0, source: 'hermes' },
        { slug: 'nous', name: 'Nous', is_current: true, authenticated: true, models: ['a', 'b'], total_models: 40, source: 'hermes', unavailable_models: ['b'], pricing: { a: { input: 'free', output: 'free', free: true } } },
      ],
    });
    expect(catalogue.current).toEqual({ provider: 'nous', model: 'a' });
    expect(catalogue.providers[0]).toMatchObject({ state: 'no-models', models: [] });
    expect(catalogue.providers[0].note).toContain('may be unreachable');
    const nous = catalogue.providers[1];
    expect(nous.unlisted).toBe(38);
    expect(nous.models.map((m) => m.badges.map((b) => b.id))).toEqual([['free'], ['locked']]);
    // Searching leaves a labelled provider with nothing to show out of the results rather than inventing rows.
    expect(searchCatalogue(catalogue, 'zzz')).toEqual([]);
  });
});

describe('the preset form', () => {
  const base = parseMoa({ default_preset: 'default', presets: { default: { reference_models: [{ provider: 'a', model: 'b' }], aggregator: { provider: 'a', model: 'c' } } } });

  test('reads and writes the fan-out cadence Hermes takes: user_turn, per_iteration or every_n:<N> with N of 2 or more', () => {
    expect(parseFanout('user_turn')).toEqual({ mode: 'user_turn', every: 2 });
    expect(parseFanout('per_iteration')).toEqual({ mode: 'per_iteration', every: 2 });
    expect(parseFanout('every_n:5')).toEqual({ mode: 'every_n', every: 5 });
    expect(parseFanout('something else')).toEqual({ mode: 'user_turn', every: 2 });
    expect(fanoutValue({ mode: 'every_n', every: 4 })).toBe('every_n:4');
    expect(fanoutValue({ mode: 'every_n', every: 1 })).toBe('per_iteration');
    expect(fanoutValue({ mode: 'per_iteration', every: 9 })).toBe('per_iteration');
  });

  test('temperatures between 0 and 2 and a timeout above 0 pass; a number outside them, or not a number, is named', () => {
    const preset = base.presets[0];
    expect(presetProblems(base, { ...preset, referenceTemperature: 0.7, aggregatorTemperature: 0, referenceTimeout: 120 })).toEqual([]);
    expect(presetProblems(base, { ...preset, referenceTemperature: 2.5 })).toEqual(['The reference temperature must be a number from 0 to 2.']);
    expect(presetProblems(base, { ...preset, aggregatorTemperature: Number.NaN })).toEqual(['The aggregator temperature must be a number from 0 to 2.']);
    expect(presetProblems(base, { ...preset, referenceTimeout: 0 })).toEqual(['The timeout must be a number of seconds above 0.']);
  });
});
