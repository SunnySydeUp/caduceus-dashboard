// Agents › Memory: Hermes's memory settings read as rows and forms, and the requests that change them. Pure: no DOM, no React, no fetch of
// its own. Hermes is the source of truth (D1): a provider's form is whatever schema Hermes gives for it (nothing about a provider's fields
// is written here), a secret comes back only as "is set", and the owner's edit is turned into the body Hermes takes.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** A request to Hermes: the route's tier is the policy map's, not decided here. */
export interface MemoryRequest {
  method: 'POST' | 'PUT' | 'DELETE';
  /** The Hermes path with its query, exactly as it is sent. */
  path: string;
  body?: Record<string, unknown>;
}

/** Reads a Hermes path through Caduceus and answers its JSON. */
export type Reader = (path: string) => Promise<unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const scoped = (route: string, profile: string, extra = '') => `${route}?${extra}profile=${encodeURIComponent(profile)}`;

/** What a provider needs installed before Hermes can use it, as Hermes says. */
export interface ProviderSetup {
  pipDependencies: string[];
  externalDependencies: { name: string; install: string; check: string }[];
  requiredEnv: string[];
  installed: boolean;
}

function parseSetup(value: unknown): ProviderSetup | undefined {
  if (!isRecord(value)) return undefined;
  return {
    pipDependencies: strings(value.pip_dependencies),
    externalDependencies: (Array.isArray(value.external_dependencies) ? value.external_dependencies : []).flatMap((entry) => (isRecord(entry) ? [{ name: text(entry.name), install: text(entry.install), check: text(entry.check) }] : [])),
    requiredEnv: strings(value.required_env),
    installed: value.dependencies_installed === true,
  };
}

/** One memory provider as Hermes lists it. `status` is Hermes's word: `ready`, `needs_config`, `unavailable`. */
export interface MemoryProvider {
  name: string;
  description: string;
  available: boolean;
  configured: boolean;
  status: string;
  setup: ProviderSetup | undefined;
}

/** What `GET /api/memory` says of a profile: the active provider (`''` is the built-in memory), the providers and the built-in files' sizes in bytes. */
export interface MemoryStatus {
  active: string;
  providers: MemoryProvider[];
  files: { memory: number; user: number };
}

/** `GET /api/memory`. */
export function parseMemory(body: unknown): MemoryStatus {
  const record = isRecord(body) ? body : {};
  const files = isRecord(record.builtin_files) ? record.builtin_files : {};
  return {
    active: text(record.active),
    providers: (Array.isArray(record.providers) ? record.providers : []).flatMap((row): MemoryProvider[] =>
      isRecord(row) && typeof row.name === 'string'
        ? [{ name: row.name, description: text(row.description), available: row.available === true, configured: row.configured === true, status: text(row.status), setup: parseSetup(row.setup) }]
        : [],
    ),
    files: { memory: typeof files.memory === 'number' ? files.memory : 0, user: typeof files.user === 'number' ? files.user : 0 },
  };
}

export const memoryPath = (profile: string) => scoped('/api/memory', profile);

export type FieldKind = 'text' | 'secret' | 'select' | 'bool' | 'number' | 'json';

export interface FormField {
  key: string;
  label: string;
  kind: FieldKind;
  description: string;
  /** Longer help Hermes gives for a field. */
  info: string;
  placeholder: string;
  /** The heading the field is listed under; `''` for none. */
  group: string;
  options: { value: string; label: string; description: string }[];
  /** What Hermes has now, as the text a field edits (`true`/`false` for a switch). A secret is always `''`: Hermes never sends it back. */
  value: string;
  /** Hermes has a value for it. For a secret this is all there is to know. */
  isSet: boolean;
  required: boolean;
  /** Where to get a key, when Hermes names a place. */
  url: string;
  /** Shown only while every field named here has the value given. */
  when: Record<string, string> | undefined;
  /** A number that must be a whole number. */
  integer: boolean;
  min: number | undefined;
  max: number | undefined;
}

/** A provider's form. `declared` is the schema the provider declares (Honcho); `native` is the one Hermes builds from the provider's own settings list. */
export interface ProviderForm {
  name: string;
  label: string;
  docsUrl: string;
  surface: 'declared' | 'native';
  fields: FormField[];
  setup: ProviderSetup | undefined;
}

const KINDS: Record<string, FieldKind> = { text: 'text', secret: 'secret', select: 'select', bool: 'bool', boolean: 'bool', number: 'number', integer: 'number', json: 'json' };

function parseField(raw: unknown): FormField[] {
  if (!isRecord(raw) || typeof raw.key !== 'string') return [];
  const kind = KINDS[text(raw.kind)] ?? 'text';
  const value = raw.value;
  const when = isRecord(raw.when) ? Object.fromEntries(Object.entries(raw.when).map(([key, expected]) => [key, String(expected)])) : undefined;
  return [
    {
      key: raw.key,
      label: text(raw.label) || raw.key,
      kind,
      description: text(raw.description),
      info: text(raw.info),
      placeholder: text(raw.placeholder),
      group: text(raw.group),
      options: (Array.isArray(raw.options) ? raw.options : []).flatMap((option) => (isRecord(option) ? [{ value: text(option.value), label: text(option.label) || text(option.value), description: text(option.description) }] : [])),
      value: kind === 'secret' ? '' : typeof value === 'boolean' ? String(value) : value === null || value === undefined ? '' : String(value),
      isSet: raw.is_set === true,
      required: raw.required === true,
      url: text(raw.url),
      when: when && Object.keys(when).length > 0 ? when : undefined,
      integer: text(raw.kind) === 'integer',
      min: typeof raw.minimum === 'number' ? raw.minimum : undefined,
      max: typeof raw.maximum === 'number' ? raw.maximum : undefined,
    },
  ];
}

/** The answer of `GET /api/memory/providers/{name}/config`, on either surface. */
export function parseForm(body: unknown, surface: ProviderForm['surface']): ProviderForm {
  const record = isRecord(body) ? body : {};
  return {
    name: text(record.name),
    label: text(record.label),
    docsUrl: text(record.docs_url),
    surface,
    fields: (Array.isArray(record.fields) ? record.fields : []).flatMap(parseField),
    setup: parseSetup(record.setup),
  };
}

const formPath = (name: string, profile: string, declared: boolean) => scoped(`/api/memory/providers/${encodeURIComponent(name)}/config`, profile, declared ? 'surface=declared&' : '');

/** A provider's form: the schema the provider declares when it declares one (Honcho), otherwise the settings list Hermes builds for it. */
export async function loadForm(name: string, profile: string, read: Reader): Promise<ProviderForm> {
  const declared = parseForm(await read(formPath(name, profile, true)), 'declared');
  if (declared.fields.length > 0) return declared;
  return parseForm(await read(formPath(name, profile, false)), 'native');
}

/** What the owner has typed so far: a field's text by key. A field that is not here still has what Hermes gave. */
export type Edits = Readonly<Record<string, string>>;

const current = (field: FormField, edits: Edits) => edits[field.key] ?? field.value;

/** The fields to show for what is typed: one with a `when` is shown only while the fields it names have those values. */
export function visibleFields(form: ProviderForm, edits: Edits): FormField[] {
  const valueOf = (key: string) => {
    const field = form.fields.find((candidate) => candidate.key === key);
    return field ? current(field, edits) : '';
  };
  return form.fields.filter((field) => field.when === undefined || Object.entries(field.when).every(([key, expected]) => valueOf(key) === expected));
}

/** What would stop a save, by field key, in words. Hermes still checks everything again; this spares a round trip. */
export function formProblems(form: ProviderForm, edits: Edits): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const field of visibleFields(form, edits)) {
    const typed = current(field, edits).trim();
    if (field.kind === 'secret') {
      if (field.required && !field.isSet && typed === '') problems[field.key] = `${field.label} is required.`;
    } else if (field.kind === 'number' && typed !== '') {
      const number = Number(typed);
      if (!Number.isFinite(number)) problems[field.key] = `${field.label} must be a number.`;
      else if (field.integer && !Number.isInteger(number)) problems[field.key] = `${field.label} must be a whole number.`;
      else if (field.min !== undefined && number < field.min) problems[field.key] = `${field.label} must be at least ${field.min}.`;
      else if (field.max !== undefined && number > field.max) problems[field.key] = `${field.label} must be at most ${field.max}.`;
    } else if (field.kind === 'json' && typed !== '') {
      try {
        const parsed: unknown = JSON.parse(typed);
        if (typeof parsed !== 'object' || parsed === null) problems[field.key] = `${field.label} must be a JSON object or list.`;
      } catch {
        problems[field.key] = `${field.label} is not valid JSON.`;
      }
    } else if (field.kind === 'text' && field.required && typed === '' && !field.isSet) {
      problems[field.key] = `${field.label} is required.`;
    }
  }
  return problems;
}

/**
 * Saves a form (Tier 2). Every shown field goes, except a secret left empty: Hermes keeps the one it has and never sends it back. Hermes
 * also makes the provider the profile's memory provider when it saves.
 */
export function formSave(form: ProviderForm, edits: Edits, profile: string): MemoryRequest {
  const declared = form.surface === 'declared';
  const values: Record<string, unknown> = {};
  for (const field of visibleFields(form, edits)) {
    const typed = current(field, edits);
    if (field.kind === 'secret') {
      if (typed.trim() !== '') values[field.key] = typed;
    } else if (declared) {
      values[field.key] = typed;
    } else if (field.kind === 'bool') {
      values[field.key] = typed === 'true';
    } else if (field.kind === 'number') {
      values[field.key] = typed.trim() === '' ? '' : Number(typed);
    } else {
      values[field.key] = typed;
    }
  }
  return { method: 'PUT', path: scoped(`/api/memory/providers/${encodeURIComponent(form.name)}/config`, profile, declared ? 'surface=declared&' : ''), body: { values } };
}

/** Makes a ready provider the profile's (Tier 1); `''` goes back to the built-in memory. */
export function providerSelect(name: string, profile: string): MemoryRequest {
  return { method: 'PUT', path: scoped('/api/memory/provider', profile), body: { provider: name } };
}

/** How a provider's own sign-in stands, as Hermes says: `idle`, `pending` (waiting for the provider's page), `connected` or `error`. */
export interface OauthStatus {
  state: 'idle' | 'pending' | 'connected' | 'error';
  /** Hermes's words for the state; for an error, the reason. */
  detail: string;
  /** A credential is already stored for the provider. */
  connected: boolean;
  /** Which kind of credential it is. */
  auth: 'oauth' | 'apikey' | undefined;
}

/** `GET …/oauth/status` and what `POST …/oauth/start` answers. Undefined when the provider has no sign-in (Hermes answers 404 with a reason). */
export function parseOauth(body: unknown): OauthStatus | undefined {
  if (!isRecord(body) || typeof body.state !== 'string') return undefined;
  const state = body.state === 'pending' || body.state === 'connected' || body.state === 'error' ? body.state : 'idle';
  return { state, detail: text(body.detail), connected: body.connected === true, auth: body.auth === 'oauth' ? 'oauth' : body.auth === 'apikey' ? 'apikey' : undefined };
}

export const oauthStatusPath = (name: string, profile: string) => scoped(`/api/memory/providers/${encodeURIComponent(name)}/oauth/status`, profile);

/** Starts a provider's sign-in (Tier 1). Hermes opens the provider's page in the browser of the computer it runs on and waits for the redirect there. */
export function oauthStart(name: string, profile: string): MemoryRequest {
  return { method: 'POST', path: scoped(`/api/memory/providers/${encodeURIComponent(name)}/oauth/start`, profile) };
}

/** One context engine to choose. `installed` is false for a name the profile's config keeps that no plugin provides now. */
export interface ContextEngineOption {
  name: string;
  description: string;
  installed: boolean;
}

export interface ContextEngineChoice {
  /** The engine in the profile's config. */
  current: string;
  options: ContextEngineOption[];
}

/** Hermes's own default: the compressor that ships with it. The plugin hub does not list it. */
export const BUILT_IN_ENGINE = 'compressor';

/** Where the profile's engine and the engines on offer are read: the profile's config, and the plugin hub (which lists what is installed on this computer). */
export function contextEnginePaths(profile: string): { config: string; hub: string } {
  return { config: scoped('/api/config', profile), hub: '/api/dashboard/plugins/hub' };
}

/** The profile's `context.engine` and the engines Hermes offers. */
export function parseContextEngine(config: unknown, hub: unknown): ContextEngineChoice {
  const section = isRecord(config) && isRecord(config.context) ? config.context : {};
  const current = text(section.engine) || BUILT_IN_ENGINE;
  const providers = isRecord(hub) && isRecord(hub.providers) ? hub.providers : {};
  const offered = (Array.isArray(providers.context_options) ? providers.context_options : []).flatMap((entry): ContextEngineOption[] =>
    isRecord(entry) && typeof entry.name === 'string' && entry.name !== BUILT_IN_ENGINE ? [{ name: entry.name, description: text(entry.description), installed: true }] : [],
  );
  const options: ContextEngineOption[] = [{ name: BUILT_IN_ENGINE, description: 'Hermes’s own compressor: it summarises the middle of a long chat when the context fills up.', installed: true }, ...offered];
  if (!options.some((option) => option.name === current)) options.push({ name: current, description: 'No plugin provides this engine on this computer.', installed: false });
  return { current, options };
}

/** Saves the profile's context engine (Tier 2). */
export function contextEngineSave(name: string, profile: string): MemoryRequest {
  return { method: 'PUT', path: scoped('/api/dashboard/plugin-providers', profile), body: { context_engine: name } };
}

export interface GraphNode {
  /** A skill's name, or `memory:<memory|profile>:<index>:<digest of its text>` for a chunk of MEMORY.md / USER.md (Hermes names the entry by its text, so an id minted before the file changed is refused as stale). */
  id: string;
  label: string;
  kind: 'skill' | 'memory';
  category: string;
  useCount: number;
  state: string;
  createdBy: string | undefined;
  pinned: boolean;
  /** For a memory chunk, the file it is in: `memory` is MEMORY.md and `profile` is USER.md. */
  memorySource: 'memory' | 'profile' | undefined;
  /** Seconds since the epoch. */
  timestamp: number | undefined;
}

export interface Graph {
  nodes: GraphNode[];
  edges: { source: string; target: string }[];
  clusters: { category: string; count: number }[];
  stats: { learnedSkills: number; memoryNodes: number; edges: number; isolatedPercent: number };
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** `GET /api/learning/graph`: what the profile has learned. Hermes draws no edge to a node it does not list; this keeps that true of a stale answer too. */
export function parseGraph(body: unknown): Graph {
  const record = isRecord(body) ? body : {};
  const nodes = (Array.isArray(record.nodes) ? record.nodes : []).flatMap((row): GraphNode[] =>
    isRecord(row) && typeof row.id === 'string'
      ? [
          {
            id: row.id,
            label: text(row.label) || row.id,
            kind: row.kind === 'memory' ? 'memory' : 'skill',
            category: text(row.category) || 'general',
            useCount: count(row.useCount),
            state: text(row.state) || 'active',
            createdBy: text(row.createdBy) || undefined,
            pinned: row.pinned === true,
            memorySource: row.memorySource === 'memory' || row.memorySource === 'profile' ? row.memorySource : undefined,
            timestamp: typeof row.timestamp === 'number' ? row.timestamp : undefined,
          },
        ]
      : [],
  );
  const known = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(record.edges) ? record.edges : []).flatMap((edge) => (isRecord(edge) && typeof edge.source === 'string' && typeof edge.target === 'string' && known.has(edge.source) && known.has(edge.target) ? [{ source: edge.source, target: edge.target }] : []));
  const stats = isRecord(record.stats) ? record.stats : {};
  return {
    nodes,
    edges,
    clusters: (Array.isArray(record.clusters) ? record.clusters : []).flatMap((cluster) => (isRecord(cluster) && typeof cluster.category === 'string' ? [{ category: cluster.category, count: count(cluster.count) }] : [])),
    stats: { learnedSkills: count(stats.learned_skills), memoryNodes: count(stats.memory_nodes), edges: edges.length, isolatedPercent: count(stats.isolated_pct) },
  };
}

export const graphPath = (profile: string) => scoped('/api/learning/graph', profile);
export const nodePath = (id: string, profile: string) => `/api/learning/node?id=${encodeURIComponent(id)}&profile=${encodeURIComponent(profile)}`;

/** A node's content, to edit: the whole SKILL.md of a skill, or the text of one memory chunk. */
export interface NodeContent {
  id: string;
  kind: 'skill' | 'memory';
  label: string;
  content: string;
}

export type NodeAnswer = { ok: true; node: NodeContent } | { ok: false; message: string };

/** What Hermes says of a node: its content, or the reason it has none (its refusals are `{ detail }`, a made change says `{ ok, message }`). */
export function readNodeAnswer(body: unknown): NodeAnswer {
  const record = isRecord(body) ? body : {};
  if (record.ok === true && typeof record.id === 'string' && typeof record.content === 'string') {
    return { ok: true, node: { id: record.id, kind: record.kind === 'memory' ? 'memory' : 'skill', label: text(record.label) || record.id, content: record.content } };
  }
  return { ok: false, message: text(record.detail) || text(record.message) || 'Hermes gave no reason.' };
}

/** The node of an answer that has one. */
export function parseNode(body: unknown): NodeContent | undefined {
  const answer = readNodeAnswer(body);
  return answer.ok ? answer.node : undefined;
}

/** Rewrites a node (Tier 1): a skill's SKILL.md or one memory chunk. Hermes refuses an empty chunk. */
export function nodeSave(id: string, content: string, profile: string): MemoryRequest {
  return { method: 'PUT', path: '/api/learning/node', body: { id, content, profile } };
}

/** Deletes a node (Tier 1). A skill is archived, so `hermes curator restore <name>` brings it back; a memory chunk is removed from its file (the old text stays in Caduceus's snapshots). */
export function nodeDelete(id: string, profile: string): MemoryRequest {
  return { method: 'DELETE', path: '/api/learning/node', body: { id, profile } };
}

/** What Hermes says of an edit or a delete: it did it, or the reason it did not. */
export function readChange(body: unknown): { ok: boolean; message: string } {
  const record = isRecord(body) ? body : {};
  return { ok: record.ok === true, message: text(record.message) || text(record.detail) };
}

/** What `project.facts` says of a folder: the facts the system prompt's coding context is built from. */
export interface ProjectFacts {
  root: string;
  manifests: string[];
  packageManagers: string[];
  verifyCommands: string[];
  contextFiles: string[];
}

/** The parameters of the gateway's `project.facts` for a folder, in a profile. */
export const factsParams = (cwd: string, profile: string) => ({ cwd, profile });

/** The facts of a folder; undefined outside a workspace (Hermes answers `facts: null`). */
export function parseFacts(result: unknown): ProjectFacts | undefined {
  const facts = isRecord(result) ? result.facts : undefined;
  if (!isRecord(facts) || typeof facts.root !== 'string') return undefined;
  return { root: facts.root, manifests: strings(facts.manifests), packageManagers: strings(facts.packageManagers), verifyCommands: strings(facts.verifyCommands), contextFiles: strings(facts.contextFiles) };
}

export const readTextPath = (path: string) => `/api/fs/read-text?path=${encodeURIComponent(path)}`;

export interface TextFile {
  path: string;
  text: string;
  /** Hermes sent only the start of a large file. */
  truncated: boolean;
  binary: boolean;
  byteSize: number;
}

/** `GET /api/fs/read-text`; undefined when Hermes gave no file (it answers `{ detail }`). */
export function parseTextFile(body: unknown): TextFile | undefined {
  if (!isRecord(body) || typeof body.text !== 'string') return undefined;
  return { path: text(body.path), text: body.text, truncated: body.truncated === true, binary: body.binary === true, byteSize: count(body.byteSize) };
}

/** Where the LLM Wiki skill keeps its pages when the profile does not say: the folder it names itself. */
export const DEFAULT_WIKI_FOLDER = '~/wiki';

/** The profile's wiki folder: `skills.config.wiki.path` in its config, else the skill's own default. */
export function wikiFolder(config: unknown): string {
  const skills = isRecord(config) && isRecord(config.skills) ? config.skills : {};
  const settings = isRecord(skills.config) ? skills.config : {};
  const wiki = isRecord(settings.wiki) ? settings.wiki : {};
  return text(wiki.path).trim() || DEFAULT_WIKI_FOLDER;
}

export const wikiPath = (folder: string) => `/api/fs/list?path=${encodeURIComponent(folder)}`;

export interface WikiEntry {
  name: string;
  path: string;
}

/** A wiki folder: its subfolders and its Markdown pages (`index.md` first, then by name), or why there is none. */
export type WikiListing = { kind: 'folder'; folders: WikiEntry[]; pages: WikiEntry[] } | { kind: 'missing' } | { kind: 'not-a-folder' } | { kind: 'unreadable'; error: string };

/** `GET /api/fs/list` of a wiki folder. */
export function parseWiki(body: unknown): WikiListing {
  if (!isRecord(body)) return { kind: 'unreadable', error: 'Hermes did not answer with a listing.' };
  if (body.error === 'ENOENT') return { kind: 'missing' };
  if (body.error === 'ENOTDIR') return { kind: 'not-a-folder' };
  if (typeof body.error === 'string') return { kind: 'unreadable', error: body.error };
  const entries = (Array.isArray(body.entries) ? body.entries : []).flatMap((entry) => (isRecord(entry) && typeof entry.name === 'string' && typeof entry.path === 'string' && !entry.name.startsWith('.') ? [{ name: entry.name, path: entry.path, folder: entry.isDirectory === true }] : []));
  const byName = (a: WikiEntry, b: WikiEntry) => a.name.localeCompare(b.name);
  const pages = entries.filter((entry) => !entry.folder && /\.md$/i.test(entry.name)).map(({ name, path }) => ({ name, path }));
  // The wiki's own catalogue opens first; every other page follows in name order (the Wiki skill's SCHEMA.md and log.md among them).
  pages.sort((a, b) => Number(b.name === 'index.md') - Number(a.name === 'index.md') || byName(a, b));
  return { kind: 'folder', folders: entries.filter((entry) => entry.folder).map(({ name, path }) => ({ name, path })).sort(byName), pages };
}
