// What Agents › Tools & MCP › Toolsets knows about a profile's tools, free of the DOM and of React. It is made only of what Hermes
// answers and nothing is kept (D1: Hermes is the source of truth). Hermes never sends a stored key, only whether one is set, so
// every key field is write-only: the page can say a key is set, and can replace it.
import type { HermesRequest } from '../channels/channels-model.ts';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Whether a toolset still needs keys: Hermes reports only configured or not. */
export type SetupState = 'ready' | 'needs-keys';

export interface Toolset {
  /** Hermes's key for the toolset: `web`, `terminal`, `image_gen`. */
  name: string;
  label: string;
  description: string;
  /** The platform whose `platform_toolsets` entry holds the on/off state: `cli` for most, `discord` for Discord's own. */
  platform: string;
  platformLabel: string;
  enabled: boolean;
  setup: SetupState;
  /** The tools the toolset gives an agent. */
  tools: string[];
}

/** `GET /api/tools/toolsets`: every toolset Hermes reports, in Hermes's order. */
export function parseToolsets(raw: unknown): Toolset[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): Toolset[] => {
    const row = record(entry);
    if (typeof row.name !== 'string') return [];
    return [
      {
        name: row.name,
        label: text(row.label) || row.name,
        description: text(row.description),
        platform: text(row.platform) || 'cli',
        platformLabel: text(row.platform_label) || text(row.platform) || 'CLI',
        enabled: row.enabled === true,
        setup: row.configured === true ? 'ready' : 'needs-keys',
        tools: Array.isArray(row.tools) ? row.tools.filter((tool): tool is string => typeof tool === 'string') : [],
      },
    ];
  });
}

const scoped = (route: string, profile: string, extra = '') => `${route}?profile=${encodeURIComponent(profile)}${extra}`;
const toolsetRoute = (name: string, suffix = '') => `/api/tools/toolsets/${encodeURIComponent(name)}${suffix}`;

/** `PUT /api/tools/toolsets/{name}` (Tier 1): switches one toolset on or off for the platform Hermes keeps its state on. */
export function toolsetToggle(name: string, profile: string, enabled: boolean): HermesRequest {
  return { method: 'PUT', path: scoped(toolsetRoute(name), profile), body: { enabled } };
}

/** Hermes's readiness of one provider row, in its own words. */
export type ProviderStatus = 'ready' | 'needs-keys' | 'needs-auth' | 'needs-setup';

export interface ProviderKey {
  /** The variable in the profile's `.env`. */
  key: string;
  prompt: string;
  url: string | undefined;
  /** Whether Hermes has a value; Hermes never sends the value. */
  isSet: boolean;
}

export interface ToolsetProvider {
  name: string;
  badge: string;
  tag: string;
  env: ProviderKey[];
  /** Hermes's key for the install or sign-in step this provider needs (`Run setup`); undefined when there is none. */
  postSetup: string | undefined;
  requiresNousAuth: boolean;
  active: boolean;
  status: ProviderStatus;
  /** The web toolset's providers say which of search and extract they do. */
  capabilities: string[];
}

export interface ToolsetConfig {
  name: string;
  /** A toolset with no category has nothing to choose or set up. */
  hasCategory: boolean;
  providers: ToolsetProvider[];
  activeProvider: string | undefined;
  /** The web toolset only: the backend each capability uses now. */
  activeBackends: { search: string | undefined; extract: string | undefined } | undefined;
}

const STATUSES: Record<string, ProviderStatus> = { ready: 'ready', needs_keys: 'needs-keys', needs_auth: 'needs-auth', needs_setup: 'needs-setup' };
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

/** `GET /api/tools/toolsets/{name}/config`: the provider matrix of a toolset with the state of every key it names. */
export function parseToolsetConfig(raw: unknown): ToolsetConfig {
  const config = record(raw);
  const providers = (Array.isArray(config.providers) ? config.providers : []).flatMap((entry): ToolsetProvider[] => {
    const row = record(entry);
    if (typeof row.name !== 'string') return [];
    return [
      {
        name: row.name,
        badge: text(row.badge),
        tag: text(row.tag),
        env: (Array.isArray(row.env_vars) ? row.env_vars : []).flatMap((variable): ProviderKey[] => {
          const key = record(variable);
          if (typeof key.key !== 'string') return [];
          return [{ key: key.key, prompt: text(key.prompt) || key.key, url: typeof key.url === 'string' && key.url !== '' ? key.url : undefined, isSet: key.is_set === true }];
        }),
        postSetup: typeof row.post_setup === 'string' && row.post_setup !== '' ? row.post_setup : undefined,
        requiresNousAuth: row.requires_nous_auth === true,
        active: row.is_active === true,
        status: STATUSES[text(row.status)] ?? 'needs-setup',
        capabilities: strings(row.capabilities),
      },
    ];
  });
  const backend = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
  return {
    name: text(config.name),
    hasCategory: config.has_category === true,
    providers,
    activeProvider: backend(config.active_provider),
    activeBackends: 'active_search_backend' in config ? { search: backend(config.active_search_backend), extract: backend(config.active_extract_backend) } : undefined,
  };
}

export interface ToolsetModel {
  id: string;
  display: string;
  speed: string;
  strengths: string;
  price: string;
}

export interface ToolsetModels {
  hasModels: boolean;
  /** The provider whose catalogue this is. */
  provider: string | undefined;
  models: ToolsetModel[];
  current: string | undefined;
  default: string | undefined;
}

/** `GET /api/tools/toolsets/{name}/models`: the model catalogue of a toolset's provider, when it has one (image and video generation). */
export function parseToolsetModels(raw: unknown): ToolsetModels {
  const models = record(raw);
  const optional = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
  return {
    hasModels: models.has_models === true,
    provider: optional(models.provider),
    models: (Array.isArray(models.models) ? models.models : []).flatMap((entry): ToolsetModel[] => {
      const row = record(entry);
      if (typeof row.id !== 'string') return [];
      return [{ id: row.id, display: text(row.display) || row.id, speed: text(row.speed), strengths: text(row.strengths), price: text(row.price) }];
    }),
    current: optional(models.current),
    default: optional(models.default),
  };
}

/** `PUT /api/tools/toolsets/{name}/provider` (Tier 1). The web toolset can name one capability (`search` or `extract`). */
export function toolsetProvider(name: string, profile: string, provider: string, capability?: string): HermesRequest {
  return { method: 'PUT', path: scoped(toolsetRoute(name, '/provider'), profile), body: { provider, ...(capability ? { capability } : {}) } };
}

/** `PUT /api/tools/toolsets/{name}/model` (Tier 1): the model of the provider's catalogue. */
export function toolsetModel(name: string, profile: string, model: string, provider?: string): HermesRequest {
  return { method: 'PUT', path: scoped(toolsetRoute(name, '/model'), profile), body: { model, ...(provider ? { provider } : {}) } };
}

/** `PUT /api/tools/toolsets/{name}/env` (Tier 2, the Keys tier): the keys that were typed. An empty value is not sent, and Hermes leaves that key as it is. */
export function toolsetEnv(name: string, profile: string, values: Readonly<Record<string, string>>): HermesRequest {
  const env = Object.fromEntries(Object.entries(values).flatMap(([key, value]) => (value.trim() === '' ? [] : [[key, value.trim()]])));
  return { method: 'PUT', path: scoped(toolsetRoute(name, '/env'), profile), body: { env } };
}

/** What Hermes says of a provider choice: a managed Nous Portal row is saved even when the Portal is not signed in, and then cannot work. */
export function readProviderAnswer(raw: unknown): { needsNousAuth: boolean; feature?: string } {
  const answer = record(raw);
  return answer.needs_nous_auth === true ? { needsNousAuth: true, feature: text(answer.feature) } : { needsNousAuth: false };
}

/** `POST /api/tools/toolsets/{name}/post-setup` (Tier 3): Hermes runs the provider's own install or sign-in step as a background action of its own, whose log is `tools-post-setup`. */
export function toolsetPostSetup(name: string, profile: string, key: string): HermesRequest {
  return { method: 'POST', path: scoped(toolsetRoute(name, '/post-setup'), profile), body: { key } };
}

/** The name of the background action Hermes runs setup in, whose log the page follows. */
export const SETUP_ACTION = 'tools-post-setup';

/** The words of Hermes's own log that say a step went wrong. Hermes's hooks print a warning and still exit 0 when an install fails, so the exit code alone is not the answer. */
const TROUBLE = /\b(failed|did not complete|timed out)\b/i;

/** How a setup ended, from the log Hermes kept: its exit code, and a line that says a step failed even when the exit code is 0. */
export function setupResult(log: { exitCode: number | null; lines: readonly string[] }): { ok: true } | { ok: false; message: string } {
  const said = log.lines.map((line) => line.trim()).filter((line) => line !== '');
  if (log.exitCode !== 0) return { ok: false, message: `Hermes stopped with exit code ${log.exitCode ?? 'unknown'}.${said.length > 0 ? ` It said: ${said[said.length - 1]}` : ''}` };
  const trouble = said.find((line) => TROUBLE.test(line));
  return trouble ? { ok: false, message: `Hermes finished but a step did not work. It said: ${trouble}` } : { ok: true };
}

/** What Hermes's config holds of `platform_toolsets`: the toolsets saved for each platform, and the two records that say which toolsets Hermes has already offered a platform. */
export interface PlatformSource {
  value: PlatformToolsets;
  knownBuiltin: PlatformToolsets;
  knownPlugin: PlatformToolsets;
}

/** The toolsets saved for each platform, by platform name. A platform with nothing saved has no key and gets Hermes's default for it. */
export type PlatformToolsets = Record<string, string[]>;

const listsOf = (value: unknown): PlatformToolsets =>
  Object.fromEntries(Object.entries(record(value)).flatMap(([platform, list]) => (Array.isArray(list) ? [[platform, list.filter((entry): entry is string => typeof entry === 'string')]] : [])));

/** `GET /api/config`: the saved `platform_toolsets`. An entry that is not a list is Hermes's to read (it falls back to its default), so it is not shown. */
export function readPlatformToolsets(config: unknown): PlatformSource {
  const body = record(config);
  return { value: listsOf(body.platform_toolsets), knownBuiltin: listsOf(body.known_builtin_toolsets), knownPlugin: listsOf(body.known_plugin_toolsets) };
}

export interface PlatformColumn {
  name: string;
  label: string;
}

/** `on` and `off` can be changed; a toolset that belongs to another platform (Discord's own) is `unavailable` here. */
export type CellState = 'on' | 'off' | 'unavailable';

export interface PlatformRow {
  platform: string;
  label: string;
  /** Hermes holds a list for this platform. Without one the row shows what Hermes reports, and the first change saves a list. */
  saved: boolean;
  cells: Record<string, CellState>;
  /** Entries of the saved list that are no column: a bundle such as `hermes-cli`, an MCP server. They are kept as they are. */
  other: string[];
}

export interface PlatformGrid {
  columns: PlatformColumn[];
  rows: PlatformRow[];
}

const CLI = 'cli';
const sorted = (names: Iterable<string>) => [...new Set(names)].sort();

/**
 * The grid of platform × toolset. A column is a toolset with tools of its own: speech-to-text and the context engine are switched
 * on in their own sections of the config, not per platform. The CLI's row is always there; every other row is a platform that has a
 * saved list.
 */
export function platformGrid(value: PlatformToolsets, toolsets: readonly Toolset[], platforms: readonly { id: string; name: string }[]): PlatformGrid {
  const columnToolsets = toolsets.filter((toolset) => toolset.tools.length > 0);
  const names = new Set(columnToolsets.map((toolset) => toolset.name));
  const row = (platform: string): PlatformRow => {
    const list = value[platform];
    const cells = Object.fromEntries(
      columnToolsets.map((toolset): [string, CellState] => {
        if (toolset.platform !== CLI && toolset.platform !== platform) return [toolset.name, 'unavailable'];
        const on = list ? list.includes(toolset.name) : platform === CLI && toolset.enabled;
        return [toolset.name, on ? 'on' : 'off'];
      }),
    );
    return { platform, label: platform === CLI ? 'CLI' : (platforms.find((entry) => entry.id === platform)?.name ?? platform), saved: list !== undefined, cells, other: (list ?? []).filter((entry) => !names.has(entry)) };
  };
  return {
    columns: columnToolsets.map((toolset) => ({ name: toolset.name, label: toolset.label })),
    rows: [CLI, ...Object.keys(value).filter((platform) => platform !== CLI).sort()].map(row),
  };
}

/** The value with one cell changed. The first change to a row that had no list saves the list the row showed. */
export function setCell(value: PlatformToolsets, row: PlatformRow, toolset: string, on: boolean): PlatformToolsets {
  if (row.cells[toolset] === undefined || row.cells[toolset] === 'unavailable') return value;
  const enabled = new Set(Object.entries(row.cells).flatMap(([name, state]) => (state === 'on' ? [name] : [])));
  if (on) enabled.add(toolset);
  else enabled.delete(toolset);
  return { ...value, [row.platform]: sorted([...row.other, ...enabled]) };
}

/** The value as the advanced view shows it. */
export const platformJson = (value: PlatformToolsets): string => JSON.stringify(value, null, 2);

/** What the advanced view's text says: the value it holds, or why it cannot be saved. */
export function parsePlatformJson(source: string): { ok: true; value: PlatformToolsets } | { ok: false; message: string } {
  if (source.trim() === '') return { ok: false, message: 'Type a JSON object, such as {"cli": ["web"]}.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { ok: false, message: 'This is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, message: 'The value must be an object with a list of toolsets for each platform.' };
  const value: PlatformToolsets = {};
  for (const [platform, list] of Object.entries(parsed)) {
    const name = platform.trim();
    if (name === '') return { ok: false, message: 'A platform name cannot be empty.' };
    if (!Array.isArray(list)) return { ok: false, message: `${name}: the toolsets must be a list of names, such as ["web", "terminal"].` };
    if (list.some((entry) => typeof entry !== 'string')) return { ok: false, message: `${name}: every toolset must be a name in quotes.` };
    if (list.some((entry: string) => entry.trim() === '')) return { ok: false, message: `${name}: a toolset name cannot be empty.` };
    value[name] = list.map((entry: string) => entry.trim());
  }
  return { ok: true, value };
}

/**
 * `PUT /api/config` (Tier 3) with only the platforms that changed: Hermes merges the body over its config, a list replaces the list,
 * and `null` removes a platform's entry so that Hermes uses its default again. Hermes's own save also records, for each platform it
 * writes, every toolset it offered (`known_builtin_toolsets`, `known_plugin_toolsets`): without that record a toolset that was left
 * unchecked is taken for one Hermes shipped later, and is switched back on. A name in the wrong one of the two records is harmless:
 * they are only looked up by name.
 */
export function platformToolsetsUpdate(profile: string, saved: PlatformToolsets, draft: PlatformToolsets, columns: readonly string[], known: Pick<PlatformSource, 'knownBuiltin' | 'knownPlugin'>): HermesRequest | undefined {
  const lists: Record<string, string[] | null> = {};
  const knownBuiltin: PlatformToolsets = {};
  const knownPlugin: PlatformToolsets = {};
  for (const platform of new Set([...Object.keys(saved), ...Object.keys(draft)])) {
    const before = saved[platform];
    const after = draft[platform];
    if (after === undefined) {
      lists[platform] = null;
    } else if (before === undefined || sorted(before).join('\n') !== sorted(after).join('\n')) {
      lists[platform] = sorted(after);
      knownBuiltin[platform] = sorted([...(known.knownBuiltin[platform] ?? []), ...columns]);
      knownPlugin[platform] = sorted([...(known.knownPlugin[platform] ?? []), ...columns]);
    }
  }
  if (Object.keys(lists).length === 0) return undefined;
  const config: Record<string, unknown> = { platform_toolsets: lists };
  if (Object.keys(knownBuiltin).length > 0) {
    config.known_builtin_toolsets = knownBuiltin;
    config.known_plugin_toolsets = knownPlugin;
  }
  return { method: 'PUT', path: scoped('/api/config', profile), body: { config } };
}

export interface PortalFeature {
  label: string;
  /** Hermes's own words for where the feature comes from: `via Nous Portal`, `Local browser`, `not configured`, a provider's name. */
  state: string;
  viaPortal: boolean;
}

export interface Portal {
  loggedIn: boolean;
  freeTier: boolean;
  accountTier: string | undefined;
  provider: string | undefined;
  portalUrl: string | undefined;
  subscriptionUrl: string | undefined;
  features: PortalFeature[];
}

const optional = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** `GET /api/portal`: how Hermes routes its tools. Hermes only reads this; changing a route is choosing a provider in the toolset. */
export function parsePortal(raw: unknown): Portal {
  const portal = record(raw);
  return {
    loggedIn: portal.logged_in === true,
    freeTier: portal.free_tier === true,
    accountTier: optional(portal.account_tier),
    provider: optional(portal.provider),
    portalUrl: optional(portal.portal_url),
    subscriptionUrl: optional(portal.subscription_url),
    features: (Array.isArray(portal.features) ? portal.features : []).flatMap((entry): PortalFeature[] => {
      const feature = record(entry);
      if (typeof feature.label !== 'string') return [];
      const state = text(feature.state);
      return [{ label: feature.label, state, viaPortal: state === 'via Nous Portal' }];
    }),
  };
}

export type ComputerUseState = 'unsupported' | 'not-installed' | 'error' | 'ready' | 'needs-permission' | 'unknown';

export interface ComputerUse {
  platform: string;
  supported: boolean;
  installed: boolean;
  version: string | undefined;
  /** Hermes's single signal: both permissions on a Mac, the driver's health elsewhere. `undefined` is unknown. */
  ready: boolean | undefined;
  canGrant: boolean;
  accessibility: boolean | undefined;
  screenRecording: boolean | undefined;
  capturable: boolean | undefined;
  checks: { label: string; status: string; message: string }[];
  error: string | undefined;
  state: ComputerUseState;
}

const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/** `GET /api/tools/computer-use/status`: whether the driver is there and what the system lets it do. */
export function parseComputerUse(raw: unknown): ComputerUse {
  const status = record(raw);
  const supported = status.platform_supported === true;
  const installed = status.installed === true;
  const ready = flag(status.ready);
  const error = optional(status.error);
  const state: ComputerUseState = !supported ? 'unsupported' : !installed ? 'not-installed' : error ? 'error' : ready === true ? 'ready' : ready === false ? 'needs-permission' : 'unknown';
  return {
    platform: text(status.platform),
    supported,
    installed,
    version: optional(status.version),
    ready,
    canGrant: status.can_grant === true,
    accessibility: flag(status.accessibility),
    screenRecording: flag(status.screen_recording),
    capturable: flag(status.screen_recording_capturable),
    checks: (Array.isArray(status.checks) ? status.checks : []).flatMap((entry) => {
      const check = record(entry);
      return typeof check.label === 'string' ? [{ label: check.label, status: text(check.status), message: text(check.message) }] : [];
    }),
    error,
    state,
  };
}

/** `POST /api/tools/computer-use/permissions/grant` (Tier 3): Hermes asks the system for the driver's permissions, as a background action of its own whose log is `computer-use-grant`. */
export const computerUseGrant = (profile: string): HermesRequest => ({ method: 'POST', path: scoped('/api/tools/computer-use/permissions/grant', profile) });

/** The name of the background action Hermes runs the permission request in. */
export const GRANT_ACTION = 'computer-use-grant';

export type ToolsetFilter = 'all' | 'on' | 'off' | 'needs-keys';

/** The toolsets that fit a search and a state, in Hermes's order. The search reads the label, the key, the description and the names of the tools. */
export function filterToolsets(toolsets: readonly Toolset[], { query, show }: { query: string; show: ToolsetFilter }): Toolset[] {
  const words = query.trim().toLowerCase();
  return toolsets.filter((toolset) => {
    if (show === 'on' && !toolset.enabled) return false;
    if (show === 'off' && toolset.enabled) return false;
    if (show === 'needs-keys' && toolset.setup !== 'needs-keys') return false;
    return words === '' || [toolset.label, toolset.name, toolset.description, ...toolset.tools].some((field) => field.toLowerCase().includes(words));
  });
}

/** What Hermes says of a switch: it starts the install a toolset's tool needs (the Computer Use driver) when it is switched on and the tool is missing. */
export function readToggleAnswer(raw: unknown): { installStarted: string | undefined } {
  return { installStarted: optional(record(raw).post_setup_started) };
}
