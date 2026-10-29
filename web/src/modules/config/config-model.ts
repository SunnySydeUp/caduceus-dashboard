// What System › Config knows about Hermes's configuration, free of the DOM and of React. The form is made only of what Hermes answers:
// its schema (`GET /api/config/schema`: every key, its kind and its section), its defaults, what the profile's config says now and what
// it says by itself. A key Hermes adds is a field with no change here (D1: Hermes is the source of truth).
import { CONFIG_SECRET_MASK, flattenConfig, isSecretConfigKey } from '@caduceus/contracts/config-keys';
import { isRecord } from '@caduceus/contracts/policy/guards';

export type FieldKind = 'boolean' | 'number' | 'string' | 'select' | 'list';
/** A value of a config key. `null` is a key Hermes leaves unset (a number it picks itself). */
export type ConfigValue = boolean | number | string | string[] | null;

export interface ConfigField {
  /** The dotted path of the key in the profile's `config.yaml`: `agent.max_turns`. */
  key: string;
  /** The id of the section it is listed in (Hermes's category). */
  section: string;
  label: string;
  /** Hermes's own sentence about the key; empty when all it says is the key's path. */
  description: string;
  kind: FieldKind;
  /** The choices of a `select`, with the current value when it is not one of them. */
  options: string[];
  /** What the profile's config says now. Never a credential: a secret's `value` is empty. */
  value: ConfigValue;
  /** What Hermes defaults the key to. */
  default: ConfigValue;
  /** The key holds a credential (an API key, a password). The form can replace it or clear it, and never shows it. */
  secret: boolean;
  /** A secret that is set. */
  secretSet: boolean;
  /** The value differs from Hermes's default. */
  modified: boolean;
  /** The profile's own config sets the key, instead of leaving it to Hermes's default. */
  inProfile: boolean;
  /** A change to the key only takes effect when the profile's gateway restarts. */
  restartRequired: boolean;
  /** Why the form cannot edit the key; `undefined` for one it can. */
  readOnlyReason: string | undefined;
}

export interface ConfigSection {
  id: string;
  title: string;
  count: number;
}

export interface ConfigForm {
  fields: ConfigField[];
  sections: ConfigSection[];
}

/** The answers the form is made of. */
export interface ConfigAnswers {
  /** `GET /api/config/schema`. */
  schema: unknown;
  /** `GET /api/config/defaults`. */
  defaults: unknown;
  /** `GET /api/config?profile=`: the saved values with Hermes's defaults filled in. */
  current: unknown;
  /** `GET /api/config?profile=&include_defaults=false`: only what the profile's own file says. */
  saved: unknown;
}

const ACRONYMS: Record<string, string> = { api: 'API', url: 'URL', id: 'ID', tts: 'TTS', stt: 'STT', llm: 'LLM', cpu: 'CPU', ttl: 'TTL', ssl: 'SSL', tls: 'TLS', mcp: 'MCP', lsp: 'LSP', ui: 'UI', cidrs: 'CIDRs', yaml: 'YAML', json: 'JSON', http: 'HTTP', ssh: 'SSH', moa: 'MoA' };

/** `max_turns` → `Max turns`; the first word has a capital and the acronyms keep theirs. */
function humanise(name: string): string {
  const words = name.split('_').filter(Boolean).map((word) => ACRONYMS[word] ?? word);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const KINDS = new Set<string>(['boolean', 'number', 'string', 'select', 'list']);

/**
 * The keys the gateway reads once, when it starts: its own settings, the chat platforms', the scheduler's, how sessions are kept and
 * what the process opens (logging, the database). Hermes does not say which keys need a restart, so this is Caduceus's list; a key
 * not on it is read again for each new turn.
 */
const GATEWAY_READS_AT_START = [
  'gateway.', 'platforms.', 'streaming.', 'sessions.', 'cron.', 'monitoring.', 'logging.', 'database.', 'runtime.',
  'discord.', 'slack.', 'mattermost.', 'matrix.', 'telegram.', 'whatsapp.', 'signal.',
  'agent.gateway_', 'agent.restart_', 'agent.agent_cache.', 'max_concurrent_sessions', 'max_live_sessions',
];

/** Whether a change to the key waits for a gateway restart. */
export function needsRestart(key: string): boolean {
  return GATEWAY_READS_AT_START.some((prefix) => key.startsWith(prefix));
}

/** What a key holds when Hermes names no default for it. */
function emptyOf(kind: FieldKind): ConfigValue {
  return kind === 'boolean' ? false : kind === 'number' ? 0 : kind === 'list' ? [] : '';
}

/** A value as the form holds it: a list of words, a flag, a number, a text, or nothing; anything else Hermes keeps is not the form's to edit. */
function readValue(raw: unknown, kind: FieldKind): ConfigValue | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (kind === 'list') return Array.isArray(raw) && raw.every((item) => typeof item === 'string') ? raw : undefined;
  if (kind === 'boolean') return typeof raw === 'boolean' ? raw : undefined;
  if (kind === 'number') return typeof raw === 'number' ? raw : undefined;
  return typeof raw === 'string' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : undefined;
}

/** Keys that Hermes puts in every answer whatever the profile says; their value says nothing about the profile. */
export const IMPLIED_BY_HERMES: Record<string, ConfigValue> = { model_context_length: 0 };

/**
 * Keys the schema lists as one text, but that Hermes writes in the profile's file as a section (`model:` holds `default`, `provider`,
 * `base_url`, `context_length`). The answers of `/api/config` flatten the section to the text; the file does not. In the raw YAML a
 * section here is Hermes's own shape, not a mistake. Hermes's `_normalize_config_for_web` names `model` as the only such key.
 */
export const WRITTEN_AS_SECTION: Record<string, true> = { model: true };

function schemaFields(schema: unknown): { key: string; kind: FieldKind; description: string; section: string; options: string[] }[] {
  const fields = isRecord(schema) && isRecord(schema.fields) ? schema.fields : {};
  return Object.entries(fields).flatMap(([key, raw]) => {
    if (!isRecord(raw) || typeof raw.type !== 'string' || !KINDS.has(raw.type)) return [];
    const options = Array.isArray(raw.options) ? raw.options.filter((option): option is string => typeof option === 'string') : [];
    const said = typeof raw.description === 'string' ? raw.description : '';
    // Hermes writes a key's path (`Agent → Max Turns`) or its label again where it has nothing to say.
    const description = said.includes(' → ') || said.toLowerCase() === humanise(key.split('.').at(-1)!).toLowerCase() ? '' : said;
    return [{ key, kind: raw.type as FieldKind, description, section: typeof raw.category === 'string' && raw.category ? raw.category : 'general', options }];
  });
}

/** Two values are the same when they say the same: an unset key and an empty text are one, and a list is compared by its words. */
export function sameValue(a: ConfigValue | undefined, b: ConfigValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => item === b[index]);
  return (a ?? '') === (b ?? '');
}

export function buildConfigForm({ schema, defaults, current, saved }: ConfigAnswers): ConfigForm {
  const currentValues = flattenConfig(current);
  const defaultValues = flattenConfig(defaults);
  const savedValues = flattenConfig(saved);
  const order = isRecord(schema) && Array.isArray(schema.category_order) ? schema.category_order.filter((id): id is string => typeof id === 'string') : [];

  const fields = schemaFields(schema).map((entry): ConfigField => {
    const secret = isSecretConfigKey(entry.key);
    const rawValue = currentValues.get(entry.key);
    const secretSet = secret && rawValue === CONFIG_SECRET_MASK;
    const value = secret ? '' : readValue(rawValue, entry.kind);
    const fallback = readValue(defaultValues.get(entry.key), entry.kind);
    const dflt = fallback === undefined ? emptyOf(entry.kind) : fallback;
    const shown = value ?? (rawValue === undefined ? dflt : null);
    const unreadable = rawValue !== undefined && value === undefined;
    const homeless = rawValue === undefined && defaultValues.get(entry.key) === undefined && !(entry.key in IMPLIED_BY_HERMES);
    const implied = entry.key in IMPLIED_BY_HERMES && savedValues.get(entry.key) === IMPLIED_BY_HERMES[entry.key];
    const options = entry.kind !== 'select' ? entry.options : [...(shown === null || shown === '' ? [''] : []), ...entry.options, ...(typeof shown === 'string' && shown !== '' ? [shown] : [])].filter((option, index, all) => all.indexOf(option) === index);
    return {
      key: entry.key,
      section: entry.section,
      label: humanise(entry.key.split('.').at(-1)!),
      description: entry.description,
      kind: entry.kind,
      options,
      value: shown,
      default: dflt,
      secret,
      secretSet,
      modified: secret ? secretSet : !unreadable && !sameValue(shown, dflt),
      inProfile: savedValues.has(entry.key) && !implied,
      restartRequired: needsRestart(entry.key),
      readOnlyReason: unreadable
        ? 'Hermes keeps something here that is not a plain value, so only the raw YAML can edit it.'
        : homeless
          ? 'The name of this key contains a dot, so only the raw YAML can set it.'
          : undefined,
    };
  });

  const ids = [...new Set(fields.map((field) => field.section))];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const position = new Map(ids.map((id, index) => [id, index]));
  // Stable: within a section the fields stay in Hermes's order.
  const ordered = fields.map((field, index) => ({ field, index })).sort((a, b) => position.get(a.field.section)! - position.get(b.field.section)! || a.index - b.index).map(({ field }) => field);
  return { fields: ordered, sections: ids.map((id) => ({ id, title: humanise(id), count: fields.filter((field) => field.section === id).length })) };
}

export type ConfigFilter = 'modified' | 'profile' | 'restart-required';
const FILTERS: readonly ConfigFilter[] = ['modified', 'profile', 'restart-required'];

/** What the page shows: the words searched for, the filters on, and the field a link points at. */
export interface ConfigView {
  text: string;
  filters: ConfigFilter[];
  field: string | undefined;
}

/** A filter typed in the search box (`@modified`, `@restart`) is a filter; everything else is the search. */
export function parseConfigQuery(input: string): Pick<ConfigView, 'text' | 'filters'> {
  const words: string[] = [];
  const filters = new Set<ConfigFilter>();
  for (const word of input.split(/\s+/).filter(Boolean)) {
    const name = /^@(modified|profile|restart(?:-required)?)$/i.exec(word)?.[1].toLowerCase();
    if (name) filters.add(name === 'modified' || name === 'profile' ? name : 'restart-required');
    else words.push(word);
  }
  return { text: words.join(' '), filters: FILTERS.filter((filter) => filters.has(filter)) };
}

/** The view as the address holds it (`?q=turns&filters=modified&field=agent.max_turns`): only what is not the default. */
export function configSearch({ text, filters, field }: ConfigView): Record<string, string> {
  return { ...(text ? { q: text } : {}), ...(filters.length ? { filters: filters.join(',') } : {}), ...(field ? { field } : {}) };
}

/** The view an address holds; what it says wrongly is left out. */
export function readConfigView(search: Record<string, unknown>): ConfigView {
  const text = typeof search.q === 'string' ? search.q.trim() : '';
  const named = typeof search.filters === 'string' ? search.filters.split(',') : [];
  const field = typeof search.field === 'string' && search.field !== '' ? search.field : undefined;
  return { text, filters: FILTERS.filter((filter) => named.includes(filter)), field };
}

/**
 * The fields that fit the view, in the form's order, or best match first when there are words: every word has to be in the key, the
 * label, Hermes's sentence or a choice, and a word in a key or a label ranks above one in a sentence. `pending` are the keys being
 * edited: they count as modified whatever they are edited to.
 */
export function matchingFields(fields: readonly ConfigField[], { text, filters }: Pick<ConfigView, 'text' | 'filters'>, pending: ReadonlySet<string>): ConfigField[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = fields.flatMap((field, index) => {
    if (filters.includes('modified') && !field.modified && !pending.has(field.key)) return [];
    if (filters.includes('profile') && !field.inProfile) return [];
    if (filters.includes('restart-required') && !field.restartRequired) return [];
    const name = `${field.key} ${field.label}`.toLowerCase();
    const sentence = field.description.toLowerCase();
    const choices = field.options.join(' ').toLowerCase();
    let score = 0;
    for (const word of words) {
      if (name.includes(word)) continue;
      if (sentence.includes(word)) score += 1;
      else if (choices.includes(word)) score += 2;
      else return [];
    }
    return [{ field, score, index }];
  });
  if (words.length > 0) scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.map(({ field }) => field);
}

/** Whether the field, as it stands (`staged` is the edit waiting to be saved, if any), is away from Hermes's default, so a reset has something to do. */
export function canReset(field: ConfigField, staged?: ConfigValue): boolean {
  if (field.secret) return staged === undefined ? field.secretSet : staged !== '';
  return !sameValue(staged === undefined ? field.value : staged, field.default);
}

/**
 * The edits waiting to be saved, by key, with `value` staged for `field`. An edit that puts the field back to what it is now is no edit,
 * and a credential is only ever a change when something is typed into it, or it is cleared.
 */
export function stageValue(pending: ReadonlyMap<string, ConfigValue>, field: ConfigField, value: ConfigValue): Map<string, ConfigValue> {
  const next = new Map(pending);
  const unchanged = field.secret ? !field.secretSet && value === '' : sameValue(value, field.value);
  if (unchanged) next.delete(field.key);
  else next.set(field.key, value);
  return next;
}

export interface DiffRow {
  key: string;
  label: string;
  section: string;
  before: string;
  after: string;
  restartRequired: boolean;
}

/** A value in words, for the review. */
export function describeValue(value: ConfigValue | undefined, kind: FieldKind): string {
  if (kind === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : value.join(', ');
  return value === null || value === undefined || value === '' ? 'empty' : String(value);
}

/** Every edit waiting to be saved as a row: the key, what it is now and what it becomes, in the form's order. A credential's value is never in a row. */
export function diffRows(fields: readonly ConfigField[], pending: ReadonlyMap<string, ConfigValue>): DiffRow[] {
  return fields.flatMap((field) => {
    if (!pending.has(field.key)) return [];
    const after = pending.get(field.key)!;
    return [
      {
        key: field.key,
        label: field.label,
        section: field.section,
        before: field.secret ? (field.secretSet ? 'set' : 'not set') : describeValue(field.value, field.kind),
        after: field.secret ? (after === '' ? 'cleared' : 'a new value (hidden)') : describeValue(after, field.kind),
        restartRequired: field.restartRequired,
      },
    ];
  });
}

/** What the page sends to Hermes to save. */
export interface ConfigUpdate {
  method: 'PUT';
  path: string;
  body: { config: Record<string, unknown> };
}

/** `PUT /api/config` (Tier 3) with only the edited keys, nested as the config file nests them: Hermes merges them over what is there. */
export function configUpdateRequest(profile: string, pending: ReadonlyMap<string, ConfigValue>): ConfigUpdate {
  const config: Record<string, unknown> = {};
  for (const [key, value] of pending) {
    const path = key.split('.');
    let node = config;
    for (const segment of path.slice(0, -1)) node = (node[segment] ??= {}) as Record<string, unknown>;
    node[path[path.length - 1]] = value;
  }
  return { method: 'PUT', path: `/api/config?profile=${encodeURIComponent(profile)}`, body: { config } };
}

/**
 * What typed text means for a field: its value, or why it cannot be one. A key Hermes leaves unset (no default) is typed text that
 * Hermes reads as a number when it looks like one, and as nothing when it is empty.
 */
export function readInput(field: ConfigField, text: string): { value: ConfigValue } | { problem: string } {
  const trimmed = text.trim();
  if (field.kind === 'list') return { value: text.split('\n').map((line) => line.trim()).filter(Boolean) };
  if (field.kind === 'boolean') return { value: trimmed === 'true' };
  const unset = field.default === null;
  if (field.kind === 'number') {
    if (trimmed === '' && unset) return { value: null };
    const number = trimmed === '' ? Number.NaN : Number(trimmed);
    return Number.isFinite(number) ? { value: number } : { problem: 'Enter a number.' };
  }
  if (unset) return trimmed === '' ? { value: null } : /^-?\d+(?:\.\d+)?$/.test(trimmed) ? { value: Number(trimmed) } : { value: trimmed };
  return { value: trimmed };
}
