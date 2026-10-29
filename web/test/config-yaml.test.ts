import { describe, expect, test } from 'vitest';
import { CONFIG_SECRET_MASK } from '@caduceus/contracts/config-keys';
import { buildConfigForm } from '../src/modules/config/config-model.ts';
import { changeRows, checkConfigYaml, exportFile, migrateOutput, rawSaveRequest, resetConfig } from '../src/modules/config/config-yaml.ts';

// The raw YAML editor's checks (M5 #09): what is wrong with a text, and on which line, before Hermes is asked to save it. The form
// is the small Hermes of `config-model.test.ts`.
const SCHEMA = {
  fields: {
    'agent.max_turns': { type: 'number', description: 'Agent → Max Turns', category: 'agent' },
    'agent.reasoning_effort': { type: 'select', description: 'Reasoning effort', category: 'agent', options: ['', 'low', 'high'] },
    'display.compact': { type: 'boolean', description: 'Display → Compact', category: 'display' },
    toolsets: { type: 'list', description: 'Toolsets', category: 'general' },
    'auxiliary.vision.api_key': { type: 'string', description: 'Auxiliary → Vision → Api Key', category: 'auxiliary' },
  },
  category_order: ['general', 'agent', 'display'],
};
const DEFAULTS = { agent: { max_turns: 90, reasoning_effort: '' }, display: { compact: false }, toolsets: ['hermes-cli'], auxiliary: { vision: { api_key: '' } } };
const form = buildConfigForm({ schema: SCHEMA, defaults: DEFAULTS, current: DEFAULTS, saved: {} });
const check = (text: string, current: unknown = {}) => checkConfigYaml(text, { form, current });

describe('checking a config text', () => {
  test('a text that is a config of known kinds has no problem and gives its value', () => {
    const checked = check('agent:\n  max_turns: 40\n  reasoning_effort: high\ndisplay:\n  compact: true\ntoolsets:\n  - web\nunknown_key: anything\n');

    expect(checked.problems).toEqual([]);
    expect(checked.value).toEqual({ agent: { max_turns: 40, reasoning_effort: 'high' }, display: { compact: true }, toolsets: ['web'], unknown_key: 'anything' });
  });

  test('a syntax error points to its line and says it in words', () => {
    const checked = check('agent:\n  max_turns: 40\ndisplay: [unclosed\ntoolsets: []\n');

    expect(checked.value).toBeUndefined();
    // Where the text stopped making sense: the next line starts a key inside the list that was never closed.
    expect(checked.problems[0]).toMatchObject({ kind: 'syntax', line: 4 });
    expect(checked.problems[0]!.message).not.toContain('\n');
  });

  test('a text that is not a mapping, or is empty, is refused at line 1 as Hermes would', () => {
    expect(check('- a\n- b\n').problems).toMatchObject([{ kind: 'syntax', line: 1, message: 'The config must be a mapping of settings.' }]);
    expect(check('').problems).toMatchObject([{ kind: 'syntax', line: 1 }]);
  });

  test('a value of the wrong kind is a schema problem on the line of the value, one for each', () => {
    const checked = check('agent:\n  max_turns: lots\n  reasoning_effort: extreme\ndisplay:\n  compact: maybe\ntoolsets: web\n');

    expect(checked.problems.map(({ kind, line, key }) => ({ kind, line, key }))).toEqual([
      { kind: 'schema', line: 2, key: 'agent.max_turns' },
      { kind: 'schema', line: 3, key: 'agent.reasoning_effort' },
      { kind: 'schema', line: 5, key: 'display.compact' },
      { kind: 'schema', line: 6, key: 'toolsets' },
    ]);
    expect(checked.problems[0]!.message).toBe('agent.max_turns is a number, not "lots".');
  });

  test('a section written as a value, or a value written as a section, is a schema problem', () => {
    const checked = check('agent: 5\ndisplay:\n  compact:\n    nested: true\n');

    expect(checked.problems.map(({ line, key }) => ({ line, key }))).toEqual([
      { line: 1, key: 'agent' },
      { line: 3, key: 'display.compact' },
    ]);
  });

  // Hermes's schema lists `model` as one text, but the file it writes holds a section (default, provider, base_url, context_length):
  // its own file is never a problem.
  test('a key Hermes lists as one setting but writes as a section is fine in its own file', () => {
    const real = buildConfigForm({
      schema: { fields: { ...SCHEMA.fields, model: { type: 'string', description: 'Default model (e.g. anthropic/claude-sonnet-4.6)', category: 'general' }, model_context_length: { type: 'number', description: 'Context window override', category: 'general' } }, category_order: SCHEMA.category_order },
      defaults: { ...DEFAULTS, model: '' },
      current: { ...DEFAULTS, model: 'claude-sonnet-4.6', model_context_length: 0 },
      saved: { model: { default: 'claude-sonnet-4.6', provider: 'anthropic', base_url: 'https://api.anthropic.com' } },
    });
    const text = 'model:\n  default: claude-sonnet-4.6\n  provider: anthropic\n  base_url: https://api.anthropic.com\n  context_length: 200000\nagent:\n  max_turns: 40\n';

    expect(checkConfigYaml(text, { form: real, current: {} }).problems).toEqual([]);
    // A plain text is still fine, and a section is still wrong for a setting Hermes never writes as one.
    expect(checkConfigYaml('model: claude-sonnet-4.6\n', { form: real, current: {} }).problems).toEqual([]);
    expect(checkConfigYaml('agent:\n  max_turns:\n    nested: 1\n', { form: real, current: {} }).problems).toMatchObject([{ key: 'agent.max_turns' }]);
  });

  test('a mask is a credential kept: fine where the current config has one set, a problem on its line where it has none', () => {
    const text = `auxiliary:\n  vision:\n    api_key: "${CONFIG_SECRET_MASK}"\n`;

    expect(check(text, { auxiliary: { vision: { api_key: CONFIG_SECRET_MASK } } }).problems).toEqual([]);
    expect(check(text, {}).problems).toMatchObject([{ kind: 'secret', line: 3, key: 'auxiliary.vision.api_key' }]);
  });
});

describe('what a text would change', () => {
  const current = { agent: { max_turns: 40 }, display: { compact: true }, toolsets: ['a'], auxiliary: { vision: { api_key: CONFIG_SECRET_MASK } }, extra: { note: 'x' } };

  test('lists each key that is added, removed or changed, in the form’s order, and nothing for what stays', () => {
    const rows = changeRows(form, current, { agent: { max_turns: 50 }, toolsets: ['a', 'b'], auxiliary: { vision: { api_key: CONFIG_SECRET_MASK } }, extra: { other: 1 } });

    expect(rows.map(({ key, kind, before, after }) => ({ key, kind, before, after }))).toEqual([
      { key: 'toolsets', kind: 'changed', before: 'a', after: 'a, b' },
      { key: 'agent.max_turns', kind: 'changed', before: '40', after: '50' },
      { key: 'display.compact', kind: 'removed', before: 'on', after: 'Hermes’s default' },
      { key: 'extra.note', kind: 'removed', before: 'x', after: 'Hermes’s default' },
      { key: 'extra.other', kind: 'added', before: 'not set', after: '1' },
    ]);
  });

  test('never says a credential: it is set, replaced, cleared or kept, and a reference to one stays readable', () => {
    const typed = changeRows(form, current, { ...current, auxiliary: { vision: { api_key: 'sk-typed-secret' } } });
    const cleared = changeRows(form, current, { ...current, auxiliary: { vision: { api_key: '' } } });
    const reference = changeRows(form, current, { ...current, auxiliary: { vision: { api_key: '${VISION_KEY}' } } });
    const added = changeRows(form, {}, { auxiliary: { vision: { api_key: 'sk-typed-secret' } } });

    expect(JSON.stringify([typed, cleared, reference, added])).not.toContain('sk-typed-secret');
    expect(typed[0]).toMatchObject({ before: 'set', after: 'a new value (hidden)' });
    expect(cleared[0]).toMatchObject({ before: 'set', after: 'cleared' });
    expect(reference[0]).toMatchObject({ before: 'set', after: '${VISION_KEY}' });
    expect(added[0]).toMatchObject({ before: 'not set', after: 'a new value (hidden)' });
  });
});

describe('putting a section or the whole config back to Hermes’s defaults', () => {
  const profile = { agent: { max_turns: 40, reasoning_effort: 'high' }, display: { compact: true }, toolsets: ['a'], auxiliary: { vision: { api_key: CONFIG_SECRET_MASK } }, extra: { note: 'x' } };

  test('a section unsets its own settings and nothing else', () => {
    const reset = resetConfig(form, profile, { section: 'agent' });

    expect(reset.value).toEqual({ display: { compact: true }, toolsets: ['a'], auxiliary: { vision: { api_key: CONFIG_SECRET_MASK } }, extra: { note: 'x' } });
    expect(reset.keys).toEqual(['agent.max_turns', 'agent.reasoning_effort']);
  });

  test('the whole config unsets every setting the schema names but keeps the credentials, which a reset never clears, and what the schema does not name', () => {
    const reset = resetConfig(form, profile, 'all');

    expect(reset.value).toEqual({ auxiliary: { vision: { api_key: CONFIG_SECRET_MASK } }, extra: { note: 'x' } });
    expect(reset.keys).toEqual(['agent.max_turns', 'agent.reasoning_effort', 'display.compact', 'toolsets']);
    expect(resetConfig(form, { auxiliary: profile.auxiliary }, 'all').keys).toEqual([]);
  });
});

describe('the export file and the raw save', () => {
  test('the file is named for the profile and the day and holds the text as Hermes’s file reads, masks included', () => {
    const text = 'auxiliary:\n  vision:\n    api_key: "********"\n';

    expect(exportFile('coder', text, new Date('2026-10-18T09:30:00Z'))).toEqual({ name: 'hermes-config-coder-2026-10-18.yaml', text });
  });

  test('the save replaces the profile’s file by the text', () => {
    expect(rawSaveRequest('coder', 'a: 1\n')).toEqual({ method: 'PUT', path: '/api/config/raw?profile=coder', body: { yaml_text: 'a: 1\n' } });
  });
});

describe('the output of a config migrate', () => {
  test('is what Hermes’s log says after the last time the run started, without the blank lines around it', () => {
    const lines = ['', '=== config-migrate started 2026-10-17 09:00:00 ===', 'old run', '', '=== config-migrate started 2026-10-18 22:37:10 ===', '', 'Checking configuration', '  done', ''];

    expect(migrateOutput(lines)).toEqual(['Checking configuration', '  done']);
    expect(migrateOutput(['no marker', 'at all'])).toEqual(['no marker', 'at all']);
  });
});
