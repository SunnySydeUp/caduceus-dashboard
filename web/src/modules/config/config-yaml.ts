// What the raw YAML editor of System › Config knows, free of the DOM and of React: what is wrong with a config text and on which line,
// what a text would change in the profile, what a reset puts back, and how the config leaves as a file. Hermes still has the last word on
// a save; these checks stop what it would refuse (or silently accept wrongly) before it is asked, and point to the line.
import YAML from 'yaml';
import { CONFIG_SECRET_MASK, flattenConfig, isSecretConfigKey, isSecretReference, restoreMaskedSecrets } from '@caduceus/contracts/config-keys';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { describeValue, IMPLIED_BY_HERMES, needsRestart, type ConfigField, type ConfigForm, type ConfigValue } from './config-model.ts';

export interface YamlProblem {
  /** `syntax`: Hermes could not read the text; `schema`: a value is not what Hermes’s schema says; `secret`: a mask stands for a credential that is not there. */
  kind: 'syntax' | 'schema' | 'secret';
  /** 1-based. */
  line: number;
  column: number;
  /** The key the problem is about, when it is about one. */
  key?: string;
  message: string;
}

export interface CheckedConfigYaml {
  /** The config the text says; `undefined` when it cannot be read. */
  value: Record<string, unknown> | undefined;
  problems: YamlProblem[];
}

/** The same reading Hermes gives a file (PyYAML): merge keys work. */
const PARSE = { merge: true } as const;

/** A node in words, for a message: `"lots"`, `a section`, `a list`, `empty`. */
function describeNode(node: unknown): string {
  if (YAML.isMap(node)) return 'a section';
  if (YAML.isSeq(node)) return 'a list';
  if (YAML.isAlias(node)) return 'a copy of another value';
  if (YAML.isScalar(node)) return node.value === null ? 'empty' : JSON.stringify(String(node.value));
  return 'empty';
}

/** What is wrong with `node` as the value of `field`, or nothing when it is fine. */
function kindProblem(field: ConfigField, node: unknown): string | undefined {
  const key = field.key;
  const got = describeNode(node);
  if (YAML.isMap(node)) return `${key} is a single setting, not a section.`;
  if (field.kind === 'list') return YAML.isSeq(node) || (YAML.isScalar(node) && node.value === null) ? undefined : `${key} is a list, not ${got}.`;
  if (YAML.isSeq(node)) return `${key} is ${field.kind === 'boolean' ? 'on or off' : field.kind === 'number' ? 'a number' : 'a single value'}, not a list.`;
  if (!YAML.isScalar(node)) return undefined;
  const value = node.value;
  if (field.kind === 'boolean') return typeof value === 'boolean' ? undefined : `${key} is on or off (true or false), not ${got}.`;
  // A number Hermes leaves unset is written as nothing.
  if (field.kind === 'number') return typeof value === 'number' || value === null ? undefined : `${key} is a number, not ${got}.`;
  if (field.kind === 'select' && field.options.length > 0 && value !== null && !field.options.includes(String(value))) {
    return `${key} is one of ${field.options.map((option) => (option === '' ? 'empty' : option)).join(', ')}, not ${got}.`;
  }
  return undefined;
}

interface Walk {
  fields: Map<string, ConfigField>;
  sections: Set<string>;
  line(node: unknown): { line: number; column: number };
  problems: YamlProblem[];
  /** Where each mask stands, by key. */
  masks: Map<string, { line: number; column: number }>;
}

function walk(node: unknown, prefix: string, ctx: Walk): void {
  if (YAML.isSeq(node)) {
    for (const item of node.items) walk(item, prefix, ctx);
    return;
  }
  if (!YAML.isMap(node)) return;
  for (const pair of node.items) {
    const name = YAML.isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const key = prefix ? `${prefix}.${name}` : name;
    const at = ctx.line(pair.key);
    const value = pair.value;
    const field = ctx.fields.get(key);
    if (YAML.isScalar(value) && value.value === CONFIG_SECRET_MASK && isSecretConfigKey(key) && !ctx.masks.has(key)) ctx.masks.set(key, at);
    if (field && !field.readOnlyReason) {
      const message = kindProblem(field, value);
      if (message) ctx.problems.push({ kind: 'schema', ...at, key, message });
    } else if (!field && ctx.sections.has(key) && !YAML.isMap(value)) {
      ctx.problems.push({ kind: 'schema', ...at, key, message: `${key} is a section of settings, not ${describeNode(value)}.` });
    }
    walk(value, key, ctx);
  }
}

/** First line of a YAML error, without where it says it is: the line is the problem's own. */
function sayError(message: string): string {
  const first = (message.split('\n')[0] ?? message).replace(/ at line \d+, column \d+:?$/, '').trim();
  return first.endsWith('.') ? first : `${first}.`;
}

/**
 * Checks a config text: that it is YAML, a mapping, of the kinds Hermes's schema names, and that every mask in it (a credential kept, as
 * the export and the editor show it) has a credential to stand for in `current`, which is the config the page was given (masked).
 */
export function checkConfigYaml(text: string, { form, current }: { form: ConfigForm; current: unknown }): CheckedConfigYaml {
  const lines = new YAML.LineCounter();
  const doc = YAML.parseDocument(text, { ...PARSE, lineCounter: lines });
  const position = (offset: number) => lines.linePos(offset);
  if (doc.errors.length > 0) {
    return {
      value: undefined,
      problems: doc.errors.map((error) => ({ kind: 'syntax', line: error.linePos?.[0].line ?? 1, column: error.linePos?.[0].col ?? 1, message: sayError(error.message) })),
    };
  }
  let value: unknown;
  try {
    value = doc.toJS();
  } catch (error) {
    return { value: undefined, problems: [{ kind: 'syntax', line: 1, column: 1, message: sayError(error instanceof Error ? error.message : 'The text cannot be read.') }] };
  }
  if (!isRecord(value)) return { value: undefined, problems: [{ kind: 'syntax', line: 1, column: 1, message: 'The config must be a mapping of settings.' }] };

  const sections = new Set<string>();
  for (const { key } of form.fields) for (let at = key.indexOf('.'); at >= 0; at = key.indexOf('.', at + 1)) sections.add(key.slice(0, at));
  const ctx: Walk = {
    fields: new Map(form.fields.map((field) => [field.key, field])),
    sections,
    line: (node) => {
      const range = (node as { range?: [number, number, number] | null } | null)?.range;
      const at = range ? position(range[0]) : { line: 1, col: 1 };
      return { line: at.line, column: at.col };
    },
    problems: [],
    masks: new Map(),
  };
  walk(doc.contents, '', ctx);

  const unresolved: string[] = [];
  restoreMaskedSecrets(value, current, unresolved);
  for (const key of new Set(unresolved)) {
    const at = ctx.masks.get(key) ?? { line: 1, column: 1 };
    ctx.problems.push({ kind: 'secret', ...at, key, message: `${key} is a masked credential, and the profile has none set to keep. Type the value, or remove the line.` });
  }
  ctx.problems.sort((a, b) => a.line - b.line || a.column - b.column);
  return { value, problems: ctx.problems };
}

/** The config a raw text says, as the page was given it (masked), for what a change is measured against; nothing when the text is not a config. */
export function readCurrentConfig(text: string): Record<string, unknown> {
  const doc = YAML.parseDocument(text, PARSE);
  if (doc.errors.length > 0) return {};
  try {
    const value: unknown = doc.toJS();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

export interface ChangeRow {
  key: string;
  label: string;
  kind: 'added' | 'removed' | 'changed';
  before: string;
  after: string;
  restartRequired: boolean;
}

/** A value of a key the schema does not name, in words. */
function describeLoose(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : value.map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item))).join(', ');
  return value === null || value === undefined || value === '' ? 'empty' : String(value);
}

const DEFAULT_WORDS = 'Hermes’s default';

/**
 * What saving `after` over `before` (the config as the page was given it, masks included) would change, key by key: the form's
 * settings in the form's order, then the keys the schema does not name. A credential is never a value in a row: a mask on both sides is
 * a credential kept, so it is no change.
 */
export function changeRows(form: ConfigForm, before: unknown, after: unknown): ChangeRow[] {
  const was = flattenConfig(before);
  const now = flattenConfig(after);
  const fields = new Map(form.fields.map((field, index) => [field.key, { field, index }]));
  const rows: (ChangeRow & { order: number })[] = [];
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const known = fields.get(key);
    const field = known?.field;
    const old = was.get(key);
    const next = now.get(key);
    const unset = (value: unknown) => value === undefined;
    let beforeText: string;
    let afterText: string;
    if (isSecretConfigKey(key)) {
      const empty = (value: unknown) => value === undefined || value === null || value === '';
      if (old === next || (empty(old) && empty(next))) continue;
      beforeText = empty(old) ? 'not set' : typeof old === 'string' && isSecretReference(old) ? old : 'set';
      afterText = unset(next) ? 'not set' : next === '' || next === null ? 'cleared' : typeof next === 'string' && isSecretReference(next) ? next : 'a new value (hidden)';
    } else {
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      // Hermes puts these keys in every file it writes: a text that leaves one out does not take it away.
      if (unset(next) && key in IMPLIED_BY_HERMES && old === IMPLIED_BY_HERMES[key]) continue;
      const describe = (value: unknown) => (field ? describeValue(value as ConfigValue, field.kind) : describeLoose(value));
      beforeText = unset(old) ? 'not set' : describe(old);
      afterText = unset(next) ? DEFAULT_WORDS : describe(next);
    }
    rows.push({
      key,
      label: field?.label ?? key,
      kind: unset(old) ? 'added' : unset(next) ? 'removed' : 'changed',
      before: beforeText,
      after: afterText,
      restartRequired: field?.restartRequired ?? needsRestart(key),
      order: known?.index ?? form.fields.length,
    });
  }
  return rows.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)).map(({ order: _order, ...row }) => row);
}

/** Takes the keys `unset` says away from a config (a copy), and the tables that empties with them. */
function without(config: Record<string, unknown>, unset: (key: string) => boolean, removed: string[], prefix = ''): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(config)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (isRecord(value)) {
      const inner = without(value, unset, removed, key);
      if (Object.keys(inner).length > 0) kept[name] = inner;
    } else if (unset(key) && !isSecretConfigKey(key)) removed.push(key);
    else kept[name] = value;
  }
  return kept;
}

/**
 * `config` with a section's settings, or all of them, put back to Hermes's defaults by taking them out of the profile's file. A
 * credential is never reset: it is a key the owner typed, not a setting, and a mask in the result is kept by the server on the save.
 */
export function resetConfig(form: ConfigForm, config: Record<string, unknown>, scope: 'all' | { section: string }): { value: Record<string, unknown>; keys: string[] } {
  // Only what the schema names has a default: a server the owner added to `mcp_servers`, or a key Hermes does not know, is theirs to keep.
  const named = new Set(form.fields.filter((field) => scope === 'all' || field.section === scope.section).map((field) => field.key));
  const keys: string[] = [];
  const value = without(config, (key) => named.has(key), keys);
  return { value, keys };
}

/** The file the config leaves as: the text of Hermes's file, which holds no credential (a set one is the mask). */
export function exportFile(profile: string, text: string, now: Date): { name: string; text: string } {
  return { name: `hermes-config-${profile}-${now.toISOString().slice(0, 10)}.yaml`, text };
}

/** `PUT /api/config/raw` (Tier 3): Hermes replaces the profile's whole file by the text. */
export function rawSaveRequest(profile: string, text: string): { method: 'PUT'; path: string; body: { yaml_text: string } } {
  return { method: 'PUT', path: `/api/config/raw?profile=${encodeURIComponent(profile)}`, body: { yaml_text: text } };
}

/** Hermes keeps one log for every run of an action. What the last run printed: the lines after its start marker, trimmed of blank ones. */
export function migrateOutput(lines: readonly string[]): string[] {
  const start = lines.findLastIndex((line) => line.startsWith('=== config-migrate started'));
  const run = lines.slice(start + 1);
  const first = run.findIndex((line) => line.trim() !== '');
  if (first < 0) return [];
  return run.slice(first, run.findLastIndex((line) => line.trim() !== '') + 1);
}
