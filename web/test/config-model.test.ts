import { describe, expect, test } from 'vitest';
import { CONFIG_SECRET_MASK } from '@caduceus/contracts/config-keys';
import { buildConfigForm, canReset, configSearch, configUpdateRequest, diffRows, matchingFields, parseConfigQuery, readConfigView, readInput, stageValue, type ConfigValue } from '../src/modules/config/config-model.ts';

// A small Hermes: the shapes of `GET /api/config/schema`, `/api/config`, `/api/config/defaults` and the profile's own saved values
// (`GET /api/config?include_defaults=false`), as the real Hermes answers them (see server/test/config-hermes.test.ts).
const SCHEMA = {
  fields: {
    model: { type: 'string', description: 'Default model (e.g. anthropic/claude-sonnet-4.6)', category: 'general' },
    model_context_length: { type: 'number', description: 'Context window override (0 = auto-detect from model metadata)', category: 'general' },
    'agent.max_turns': { type: 'number', description: 'Agent → Max Turns', category: 'agent' },
    'agent.reasoning_effort': { type: 'select', description: 'Reasoning effort', category: 'agent', options: ['', 'low', 'high'] },
    'display.compact': { type: 'boolean', description: 'Display → Compact', category: 'display' },
    toolsets: { type: 'list', description: 'Toolsets', category: 'general' },
    'auxiliary.vision.api_key': { type: 'string', description: 'Auxiliary → Vision → Api Key', category: 'auxiliary' },
    'gateway.port': { type: 'number', description: 'Gateway → Port', category: 'gateway' },
    'terminal.modal_mode': { type: 'select', description: 'Terminal → Modal Mode', category: 'terminal', options: ['sandbox', 'function'] },
  },
  category_order: ['general', 'agent', 'terminal', 'display'],
};
const DEFAULTS = {
  model: '',
  agent: { max_turns: 90, reasoning_effort: '' },
  display: { compact: false },
  toolsets: ['hermes-cli'],
  auxiliary: { vision: { api_key: '' } },
  gateway: { port: 8642 },
  terminal: { modal_mode: 'sandbox' },
};
const CURRENT = {
  model: 'anthropic/claude-sonnet-4.6',
  model_context_length: 0,
  agent: { max_turns: 90, reasoning_effort: 'high' },
  display: { compact: true },
  toolsets: ['hermes-cli'],
  auxiliary: { vision: { api_key: CONFIG_SECRET_MASK } },
  gateway: { port: 8642 },
  terminal: { modal_mode: 'auto' },
};
// What the profile's config.yaml says by itself.
const SAVED = { model: 'anthropic/claude-sonnet-4.6', agent: { reasoning_effort: 'high' }, display: { compact: true }, model_context_length: 0 };

describe('the form Hermes’s schema makes', () => {
  const form = buildConfigForm({ schema: SCHEMA, defaults: DEFAULTS, current: CURRENT, saved: SAVED });
  const field = (key: string) => form.fields.find((candidate) => candidate.key === key)!;

  test('has a field of the kind the schema says for every key, in the sections the schema names, in Hermes’s order and then alphabetically', () => {
    expect(form.sections.map(({ id, title, count }) => [id, title, count])).toEqual([
      ['general', 'General', 3],
      ['agent', 'Agent', 2],
      ['terminal', 'Terminal', 1],
      ['display', 'Display', 1],
      ['auxiliary', 'Auxiliary', 1],
      ['gateway', 'Gateway', 1],
    ]);
    expect(form.fields.map(({ key, kind }) => [key, kind])).toEqual([
      ['model', 'string'],
      ['model_context_length', 'number'],
      ['toolsets', 'list'],
      ['agent.max_turns', 'number'],
      ['agent.reasoning_effort', 'select'],
      ['terminal.modal_mode', 'select'],
      ['display.compact', 'boolean'],
      ['auxiliary.vision.api_key', 'string'],
      ['gateway.port', 'number'],
    ]);
  });

  test('a key Hermes adds later is a field with no change to the code', () => {
    const next = buildConfigForm({
      schema: { fields: { ...SCHEMA.fields, 'experimental.new_flag': { type: 'boolean', description: 'Try the new thing', category: 'experimental' } }, category_order: SCHEMA.category_order },
      defaults: { ...DEFAULTS, experimental: { new_flag: false } },
      current: { ...CURRENT, experimental: { new_flag: true } },
      saved: SAVED,
    });
    expect(next.sections.map(({ id }) => id)).toEqual(['general', 'agent', 'terminal', 'display', 'auxiliary', 'experimental', 'gateway']);
    expect(next.sections[5]).toMatchObject({ title: 'Experimental', count: 1 });
    expect(next.fields.find((candidate) => candidate.key === 'experimental.new_flag')).toMatchObject({ kind: 'boolean', label: 'New flag', description: 'Try the new thing', value: true, default: false, modified: true });
  });

  test('says what a field is now, what Hermes defaults it to, whether it differs, and whether this profile sets it itself', () => {
    expect(field('agent.max_turns')).toMatchObject({ label: 'Max turns', value: 90, default: 90, modified: false, inProfile: false, description: '' });
    expect(field('agent.reasoning_effort')).toMatchObject({ value: 'high', default: '', modified: true, inProfile: true });
    expect(field('display.compact')).toMatchObject({ value: true, default: false, modified: true, inProfile: true });
    expect(field('model')).toMatchObject({ description: 'Default model (e.g. anthropic/claude-sonnet-4.6)' });
    // A sentence that only says the label again is no sentence.
    expect(field('toolsets').description).toBe('');
    // Hermes puts `model_context_length: 0` in every answer: it says nothing about the profile, and has no default to differ from.
    expect(field('model_context_length')).toMatchObject({ value: 0, default: 0, modified: false, inProfile: false });
  });

  test('keeps the value of a choice that is not among the options, so that nothing looks changed that was not', () => {
    expect(field('terminal.modal_mode')).toMatchObject({ value: 'auto', options: ['sandbox', 'function', 'auto'], modified: true });
  });

  test('offers an empty choice when the key is unset and Hermes lists none for it', () => {
    const unset = buildConfigForm({ schema: { fields: { timezone: { type: 'select', description: 'Timezone', category: 'general', options: ['UTC', 'Europe/Paris'] } } }, defaults: { timezone: '' }, current: { timezone: '' }, saved: {} });
    expect(unset.fields[0]).toMatchObject({ value: '', modified: false, options: ['', 'UTC', 'Europe/Paris'] });
  });

  test('never holds a secret: a credential that is set is marked, and the form can only replace it or clear it', () => {
    expect(field('auxiliary.vision.api_key')).toMatchObject({ secret: true, secretSet: true, value: '', modified: true });
    expect(JSON.stringify(form)).not.toContain(CONFIG_SECRET_MASK);
  });
});

describe('search and the three filters', () => {
  const form = buildConfigForm({
    schema: {
      fields: {
        ...SCHEMA.fields,
        'discord.auto_thread': { type: 'boolean', description: 'Discord → Auto Thread', category: 'discord' },
        'security.redact_secrets': { type: 'boolean', description: 'Mask API keys and tokens in tool output and logs.', category: 'security' },
      },
      category_order: SCHEMA.category_order,
    },
    defaults: { ...DEFAULTS, discord: { auto_thread: true }, security: { redact_secrets: true } },
    current: { ...CURRENT, discord: { auto_thread: false }, security: { redact_secrets: true } },
    saved: { ...SAVED, discord: { auto_thread: false }, security: { redact_secrets: true } },
  });
  const keys = (view: Parameters<typeof matchingFields>[1], pending: ReadonlySet<string> = new Set()) => matchingFields(form.fields, view, pending).map((field) => field.key);

  test('a word finds a key by its name, its label, Hermes’s sentence or a choice, best match first, and every word has to match', () => {
    expect(keys({ text: 'reasoning', filters: [] })).toEqual(['agent.reasoning_effort']);
    expect(keys({ text: 'MASK tokens', filters: [] })).toEqual(['security.redact_secrets']);
    expect(keys({ text: 'sandbox', filters: [] })).toEqual(['terminal.modal_mode']);
    // A match in the key comes before one in a sentence.
    expect(keys({ text: 'api', filters: [] })).toEqual(['auxiliary.vision.api_key', 'security.redact_secrets']);
    expect(keys({ text: 'nothing like this', filters: [] })).toEqual([]);
    expect(keys({ text: '  ', filters: [] })).toHaveLength(form.fields.length);
  });

  test('@modified lists what differs from Hermes’s default or is being edited, @profile what the profile sets itself, @restart-required what a gateway restart applies', () => {
    expect(keys({ text: '', filters: ['modified'] })).toEqual(['model', 'agent.reasoning_effort', 'terminal.modal_mode', 'display.compact', 'auxiliary.vision.api_key', 'discord.auto_thread']);
    expect(keys({ text: '', filters: ['modified'] }, new Set(['gateway.port']))).toContain('gateway.port');
    expect(keys({ text: '', filters: ['profile'] })).toEqual(['model', 'agent.reasoning_effort', 'display.compact', 'discord.auto_thread', 'security.redact_secrets']);
    expect(keys({ text: '', filters: ['restart-required'] })).toEqual(['discord.auto_thread', 'gateway.port']);
  });

  test('the filters and the words narrow each other', () => {
    expect(keys({ text: 'model', filters: ['modified'] })).toEqual(['model']);
    expect(keys({ text: 'discord', filters: ['profile', 'restart-required'] })).toEqual(['discord.auto_thread']);
    expect(keys({ text: 'port', filters: ['profile', 'restart-required'] })).toEqual([]);
  });
});

describe('the search in the address', () => {
  test('a filter typed in the box (@modified, @restart-required) becomes a filter and the rest stays the search', () => {
    expect(parseConfigQuery('max turns @modified')).toEqual({ text: 'max turns', filters: ['modified'] });
    expect(parseConfigQuery('@restart @profile')).toEqual({ text: '', filters: ['profile', 'restart-required'] });
    expect(parseConfigQuery('@nonsense word')).toEqual({ text: '@nonsense word', filters: [] });
  });

  test('is read back as it was written, and says nothing for the default view', () => {
    const view = { text: 'turns', filters: ['modified' as const, 'restart-required' as const], field: 'agent.max_turns' };
    const written = configSearch(view);
    expect(written).toEqual({ q: 'turns', filters: 'modified,restart-required', field: 'agent.max_turns' });
    expect(readConfigView(written)).toEqual(view);
    expect(configSearch({ text: '', filters: [], field: undefined })).toEqual({});
    expect(readConfigView({ filters: 'bogus,profile' })).toEqual({ text: '', filters: ['profile'], field: undefined });
  });
});

describe('editing, resetting and reviewing', () => {
  const form = buildConfigForm({ schema: SCHEMA, defaults: DEFAULTS, current: CURRENT, saved: SAVED });
  const field = (key: string) => form.fields.find((candidate) => candidate.key === key)!;

  test('an edit is staged until it is put back to what it was, and Reset stages Hermes’s default', () => {
    let pending: ReadonlyMap<string, ConfigValue> = new Map();
    pending = stageValue(pending, field('agent.max_turns'), 40);
    pending = stageValue(pending, field('toolsets'), ['hermes-cli', 'web']);
    expect([...pending]).toEqual([
      ['agent.max_turns', 40],
      ['toolsets', ['hermes-cli', 'web']],
    ]);
    expect([...stageValue(pending, field('agent.max_turns'), 90)].map(([key]) => key)).toEqual(['toolsets']);
    expect([...stageValue(pending, field('toolsets'), ['hermes-cli'])].map(([key]) => key)).toEqual(['agent.max_turns']);

    const reset = stageValue(new Map(), field('display.compact'), field('display.compact').default);
    expect([...reset]).toEqual([['display.compact', false]]);
    // A field already at its default has nothing to reset to.
    expect(canReset(field('agent.max_turns'))).toBe(false);
    expect(canReset(field('display.compact'))).toBe(true);
  });

  test('a credential that is set can be replaced or cleared, and one that is not set can be set, but typing nothing changes nothing', () => {
    const key = field('auxiliary.vision.api_key');
    expect([...stageValue(new Map(), key, 'sk-new')]).toEqual([['auxiliary.vision.api_key', 'sk-new']]);
    expect([...stageValue(new Map(), key, '')]).toEqual([['auxiliary.vision.api_key', '']]);
    const unset = buildConfigForm({ schema: SCHEMA, defaults: DEFAULTS, current: { ...CURRENT, auxiliary: { vision: { api_key: '' } } }, saved: SAVED }).fields.find((candidate) => candidate.secret)!;
    expect([...stageValue(new Map(), unset, '')]).toEqual([]);
    expect(canReset(key)).toBe(true);
    expect(canReset(unset)).toBe(false);
  });

  test('the review lists every changed key with what it was and what it becomes, never a secret, and says which ones a restart applies', () => {
    const pending = new Map<string, ConfigValue>([
      ['gateway.port', 9000],
      ['agent.reasoning_effort', ''],
      ['toolsets', ['hermes-cli', 'web']],
      ['auxiliary.vision.api_key', 'sk-never-shown'],
      ['model', ''],
    ]);
    const rows = diffRows(form.fields, pending);
    expect(rows.map(({ key, before, after, restartRequired }) => [key, before, after, restartRequired])).toEqual([
      ['model', 'anthropic/claude-sonnet-4.6', 'empty', false],
      ['toolsets', 'hermes-cli', 'hermes-cli, web', false],
      ['agent.reasoning_effort', 'high', 'empty', false],
      ['auxiliary.vision.api_key', 'set', 'a new value (hidden)', false],
      ['gateway.port', '8642', '9000', true],
    ]);
    expect(JSON.stringify(rows)).not.toContain('sk-never-shown');
    expect(diffRows(form.fields, new Map([['auxiliary.vision.api_key', '']]))[0].after).toBe('cleared');
    expect(diffRows(form.fields, new Map([['display.compact', false]]))[0]).toMatchObject({ before: 'on', after: 'off', label: 'Compact' });
  });

  test('the save sends only the changed keys, nested the way the config file nests them, for the profile named', () => {
    const request = configUpdateRequest('my coder', new Map<string, ConfigValue>([['agent.max_turns', 40], ['display.compact', false], ['toolsets', ['a']], ['model', ''], ['agent.max_turns_x', null]]));
    expect(request.method).toBe('PUT');
    expect(request.path).toBe('/api/config?profile=my%20coder');
    expect(request.body).toEqual({ config: { agent: { max_turns: 40, max_turns_x: null }, display: { compact: false }, toolsets: ['a'], model: '' } });
  });

  test('what is typed is read as the field’s kind, and what cannot be read says why', () => {
    expect(readInput(field('agent.max_turns'), ' 40 ')).toEqual({ value: 40 });
    expect(readInput(field('agent.max_turns'), '4.5e1')).toEqual({ value: 45 });
    expect(readInput(field('agent.max_turns'), 'many')).toEqual({ problem: 'Enter a number.' });
    expect(readInput(field('agent.max_turns'), '')).toEqual({ problem: 'Enter a number.' });
    expect(readInput(field('model'), '  openrouter/x ')).toEqual({ value: 'openrouter/x' });
    expect(readInput(field('toolsets'), 'web\n\n  file \n')).toEqual({ value: ['web', 'file'] });
    // A key Hermes leaves unset: a number typed into it is a number, and nothing typed leaves it unset.
    const unset = buildConfigForm({ schema: { fields: { 'agent.budget': { type: 'string', description: 'x', category: 'agent' } } }, defaults: { agent: { budget: null } }, current: { agent: { budget: null } }, saved: {} }).fields[0];
    expect(readInput(unset, '12')).toEqual({ value: 12 });
    expect(readInput(unset, 'big')).toEqual({ value: 'big' });
    expect(readInput(unset, ' ')).toEqual({ value: null });
  });
});
