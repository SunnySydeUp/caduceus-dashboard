// System › Plugins: Hermes's agent plugins read as the cards a person manages, and the requests the page makes. Pure: no DOM, no React, no
// fetch. Hermes is the source of truth (D1): a row is what Hermes lists now, with the state Hermes holds in its config; Caduceus keeps no copy.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** A request to Caduceus's or Hermes's API: the route's tier is the policy map's, not decided here. */
export interface PluginRequest {
  method: 'POST' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Whether Hermes loads the plugin: `inactive` is a plugin Hermes found and nobody has turned on (a user install that was not enabled). */
export type PluginState = 'enabled' | 'disabled' | 'inactive';

export interface PluginRow {
  /** The name Hermes lists it under, and the one every action names it by. */
  name: string;
  version: string;
  description: string;
  /** `bundled` ships with Hermes; `user` was installed (from git or the catalogue) into the Hermes home. */
  source: 'bundled' | 'user';
  state: PluginState;
  /** An install in the Hermes home can be removed; a bundled plugin cannot. */
  removable: boolean;
  /** A git checkout can be updated (`git pull`, or Hermes's catalogue pin). */
  updatable: boolean;
  /** What Hermes says to run for a plugin whose tools are unavailable until it is signed in, if it says so. */
  authCommand: string | undefined;
  /** Why the catalogue's kill list names this plugin, if it does: it was withdrawn and the owner should know. */
  withdrawn: string | undefined;
}

/** `GET /api/dashboard/plugins/hub`: the agent plugins. User installs first, then the ones that ship with Hermes, each in name order. */
export function parsePlugins(answer: unknown): PluginRow[] {
  const rows = isRecord(answer) && Array.isArray(answer.plugins) ? answer.plugins : [];
  const plugins: PluginRow[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.name !== 'string' || row.name === '') continue;
    const state = row.runtime_status === 'enabled' || row.runtime_status === 'disabled' ? row.runtime_status : 'inactive';
    plugins.push({
      name: row.name,
      version: text(row.version),
      description: text(row.description),
      source: row.source === 'bundled' ? 'bundled' : 'user',
      state,
      removable: row.can_remove === true,
      updatable: row.can_update_git === true,
      authCommand: row.auth_required === true && text(row.auth_command) !== '' ? text(row.auth_command) : undefined,
      withdrawn: typeof row.removed_reason === 'string' ? row.removed_reason : undefined,
    });
  }
  return plugins.sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'user' ? -1 : 1));
}

/** The path of one of Hermes's plugin routes: a plugin's name can hold a slash (a category), which the route takes as it is. */
const pluginPath = (name: string, action = '') => `/api/dashboard/agent-plugins/${name.split('/').map(encodeURIComponent).join('/')}${action}`;

/** Turns the plugin on: Tier 1. */
export const enableRequest = (name: string): PluginRequest => ({ method: 'POST', path: pluginPath(name, '/enable') });

/** Turns the plugin off: Tier 1. */
export const disableRequest = (name: string): PluginRequest => ({ method: 'POST', path: pluginPath(name, '/disable') });

/** Deletes an installed plugin from the Hermes home: Tier 1. */
export const removeRequest = (name: string): PluginRequest => ({ method: 'DELETE', path: pluginPath(name) });

/** What a catalogue plugin declares it adds and asks for: shown before anything is installed, because installing runs its code. */
export interface Capabilities {
  tools: string[];
  hooks: string[];
  middleware: string[];
  requiresEnv: string[];
}

export interface CatalogueEntry {
  /** The name Hermes's catalogue install takes. */
  name: string;
  description: string;
  maintainer: string;
  /** `official` is maintained by Nous Research; `community` is reviewed and pinned to one commit but not written by them. */
  tier: 'official' | 'community';
  category: string;
  version: string;
  /** The first seven characters of the commit the catalogue pins the install to. */
  pin: string;
  /** Where the plugin's code is. */
  repo: string;
  /** A web address for its documentation, only when it is a web address. */
  docs: string | undefined;
  requiresHermes: string;
  platforms: string[];
  capabilities: Capabilities;
  installed: boolean;
  /** The catalogue pins a newer commit than the one installed. */
  updateAvailable: boolean;
}

/** A plugin the catalogue has withdrawn: Hermes refuses to install it, and says why. */
export interface Withdrawn {
  name: string;
  reason: string;
}

export interface Catalogue {
  entries: CatalogueEntry[];
  withdrawn: Withdrawn[];
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** A web address is safe to link to only when it is a web address. */
function webAddress(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** `GET /api/dashboard/plugins/catalog`: Hermes's curated plugins merged with what is installed, in name order. */
export function parseCatalogue(answer: unknown): Catalogue {
  const body = isRecord(answer) ? answer : {};
  const entries: CatalogueEntry[] = [];
  for (const row of Array.isArray(body.entries) ? body.entries : []) {
    if (!isRecord(row) || typeof row.name !== 'string' || row.name === '') continue;
    const capabilities = isRecord(row.capabilities) ? row.capabilities : {};
    entries.push({
      name: row.name,
      description: text(row.description),
      maintainer: text(row.maintainer),
      tier: row.tier === 'official' ? 'official' : 'community',
      category: text(row.category) || 'general',
      version: text(row.version),
      pin: text(row.sha_short) || text(row.sha).slice(0, 7),
      repo: text(row.repo),
      docs: webAddress(row.docs_url),
      requiresHermes: text(row.requires_hermes),
      platforms: list(row.platforms),
      capabilities: { tools: list(capabilities.provides_tools), hooks: list(capabilities.provides_hooks), middleware: list(capabilities.provides_middleware), requiresEnv: list(capabilities.requires_env) },
      installed: row.installed === true,
      updateAvailable: row.update_available === true,
    });
  }
  const withdrawn: Withdrawn[] = [];
  for (const row of Array.isArray(body.removed) ? body.removed : []) {
    if (isRecord(row) && typeof row.name === 'string') withdrawn.push({ name: row.name, reason: text(row.reason) || 'No reason recorded.' });
  }
  return { entries: entries.sort((a, b) => a.name.localeCompare(b.name)), withdrawn };
}

/** What the owner typed to install from, understood. */
export type Source = { kind: 'catalogue' | 'git'; identifier: string; warnings: string[] } | { kind: 'invalid'; problem: string };
export type ValidSource = Exclude<Source, { kind: 'invalid' }>;

/**
 * Reads what was typed in the install box. A bare word is the name of a catalogue entry (Hermes's curated, reviewed list, pinned to one
 * commit); anything else is a git address, in any of the forms git takes (`owner/repo` on GitHub, `https://…`, `git@host:owner/repo`, `ssh://…`),
 * which Hermes does not review. An address that is risky says so before the confirmation, and one Hermes would take as an option is refused.
 */
export function classifySource(typed: string): Source {
  const identifier = typed.trim();
  if (identifier === '') return { kind: 'invalid', problem: 'Type the name of a catalogue plugin, or a git address.' };
  if (/\s/.test(identifier)) return { kind: 'invalid', problem: 'A name or address has no spaces in it.' };
  if (identifier.startsWith('-')) return { kind: 'invalid', problem: 'A name or address cannot start with a dash.' };
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)) return { kind: 'catalogue', identifier, warnings: [] };
  const warnings: string[] = [];
  if (/^http:\/\//i.test(identifier)) warnings.push('This address is not encrypted (http), so what is downloaded can be changed on the way.');
  if (/^file:\/\//i.test(identifier)) warnings.push('This address is a folder on this Mac, not a server.');
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@\s:]+:[^/@\s]*@/.test(identifier)) warnings.push('There is a token in the address. Hermes would keep it with the plugin: use a token Hermes already holds (GITHUB_TOKEN in Keys) instead.');
  return { kind: 'git', identifier, warnings };
}

/** The address with any credentials taken out: what the owner types to confirm, and what Caduceus records. */
export const withoutCredentials = (address: string): string => address.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@]+@/g, '$1');

/** A request that runs Hermes's own install or update with a live log: Tier 3, so the owner types `confirmTarget`. */
export interface OperationRequest extends PluginRequest {
  method: 'POST';
  body: Record<string, unknown>;
  confirmTarget: string;
}

const OPERATIONS_PATH = '/_caduceus/api/plugins/operations';

export interface InstallOptions {
  /** Turn the plugin on once it is installed. */
  enable: boolean;
  /** Replace an install that is already there. */
  force?: boolean;
  /** Pin a git install to one commit (40 hexadecimal characters). */
  ref?: string;
}

export function installRequest(source: ValidSource, { enable, force, ref }: InstallOptions): OperationRequest {
  const commit = ref?.trim();
  return {
    method: 'POST',
    path: OPERATIONS_PATH,
    body: { action: 'install', identifier: source.identifier, ...(source.kind === 'catalogue' ? { catalogue: true } : {}), ...(commit ? { ref: commit } : {}), ...(force ? { force: true } : {}), enable },
    confirmTarget: source.kind === 'git' ? withoutCredentials(source.identifier) : source.identifier,
  };
}

export const updateRequest = (name: string): OperationRequest => ({ method: 'POST', path: OPERATIONS_PATH, body: { action: 'update', name }, confirmTarget: name });

/** Where the live log of an operation is read. */
export const logPath = (id: string) => `${OPERATIONS_PATH}/${encodeURIComponent(id)}/stream`;

/** What the page shows of a running or finished install or update. `lost` is a log that stopped arriving before Hermes's command ended. */
export interface OperationState {
  status: 'running' | 'ok' | 'failed' | 'lost';
  lines: string[];
  /** Hermes's sentence once it has ended. */
  message: string;
}

export const startOperation = (): OperationState => ({ status: 'running', lines: [], message: '' });

/**
 * Folds one server-sent event of the log into the state: `line` adds a line, `end` says how the command ended, and `dropped` (the page's
 * own word for a stream that closed) before an end says the page lost the log. Anything else leaves the state as it was.
 */
export function foldOperation(state: OperationState, { event, data }: { event: string; data: unknown }): OperationState {
  if (state.status !== 'running') return state;
  if (event === 'line' && isRecord(data) && typeof data.text === 'string') return { ...state, lines: [...state.lines, data.text] };
  if (event === 'end' && isRecord(data) && typeof data.ok === 'boolean' && typeof data.message === 'string') return { ...state, status: data.ok ? 'ok' : 'failed', message: data.message };
  if (event === 'dropped') return { ...state, status: 'lost', message: 'Caduceus lost the connection to the log. Hermes may still be working: look at the list of plugins in a moment.' };
  return state;
}

export interface CatalogueFilter {
  query: string;
  category: string;
  show: 'all' | 'installed' | 'available';
}

/** The catalogue narrowed by every word typed (found in the name, the description, the maintainer or a tool it adds), the category and the installed state. */
export function filterCatalogue(entries: readonly CatalogueEntry[], { query, category, show }: CatalogueFilter): CatalogueEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (show === 'installed' && !entry.installed) return false;
    if (show === 'available' && entry.installed) return false;
    const haystack = `${entry.name} ${entry.description} ${entry.maintainer} ${entry.capabilities.tools.join(' ')}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** The catalogue's categories, the fullest first. */
export function categoriesOf(entries: readonly CatalogueEntry[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
