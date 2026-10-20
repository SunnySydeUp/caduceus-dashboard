// The fallback chain of a profile as Agents › Models › Fallback chain reads and writes it, free of the DOM and of React. Hermes keeps it in
// the profile's config (`fallback_providers`, tried in order when the main model fails) and Caduceus keeps no copy (D1): the screen reads
// `GET /api/config` and writes `PUT /api/config`, a config write (Tier 3).
//
// Hermes 0.21.4 has no switch to turn one entry off, and it ignores keys it does not know. An entry the owner turns off is therefore moved out
// of `fallback_providers` into `fallback_providers_disabled`, a list Hermes keeps in the file and never reads, so that turning it on again
// brings it back with its endpoint override. Hermes's own settings for failing over are `agent.api_max_retries`, `agent.auto_recovery_cycles` and
// `fallback.min_switch_reset_seconds`; it has no setting for restoring the main model (it does that at the start of every turn).
import { isRecord } from '@caduceus/contracts/policy/guards';

export interface FallbackEntry {
  provider: string;
  model: string;
  /** An endpoint of the owner's own for this entry; empty when the provider's usual one is used. */
  baseUrl: string;
  /** Every other key Hermes holds on the entry (`api_key_env`, `reasoning_echo`, …): kept as it is when the entry is saved again. */
  extra: Record<string, unknown>;
}

export interface FallbackSettings {
  /** Hermes-level retries of an API error before it moves to the next entry (`agent.api_max_retries`). */
  apiMaxRetries: number;
  /** Waiting cycles after the chain is spent on a transient outage (`agent.auto_recovery_cycles`). */
  autoRecoveryCycles: number;
  /** Stay on a rate-limited main model when it resets sooner than this many seconds; 0 is off (`fallback.min_switch_reset_seconds`). */
  minSwitchResetSeconds: number;
}

export interface Fallback {
  /** The entries Hermes tries, in order. */
  chain: FallbackEntry[];
  /** Entries turned off here. Hermes does not read them. */
  parked: FallbackEntry[];
  /** The older single `fallback_model` of the config, which Hermes still tries after the chain. It is shown, not edited. */
  legacy: FallbackEntry[];
  settings: FallbackSettings;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function entriesOf(raw: unknown): FallbackEntry[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : [];
  return list.flatMap((item): FallbackEntry[] => {
    if (!isRecord(item)) return [];
    const { provider, model, base_url: baseUrl, ...extra } = item;
    if (text(provider) === '' || text(model) === '') return [];
    return [{ provider: text(provider), model: text(model), baseUrl: text(baseUrl).replace(/\/+$/, ''), extra }];
  });
}

const count = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);

/** Reads the fallback chain, the entries turned off, the legacy single fallback and the failing-over settings from `GET /api/config`. */
export function parseFallback(config: unknown): Fallback {
  const body = isRecord(config) ? config : {};
  const agent = isRecord(body.agent) ? body.agent : {};
  const fallback = isRecord(body.fallback) ? body.fallback : {};
  return {
    chain: entriesOf(body.fallback_providers),
    parked: entriesOf(body.fallback_providers_disabled),
    legacy: entriesOf(body.fallback_model),
    settings: {
      apiMaxRetries: count(agent.api_max_retries, 3),
      autoRecoveryCycles: count(agent.auto_recovery_cycles, 5),
      minSwitchResetSeconds: count(fallback.min_switch_reset_seconds, 0),
    },
  };
}

/** Moves a chain entry up (`delta` -1) or down (+1); the order is the order Hermes tries them in. An entry at an end stays. */
export function moveEntry(state: Fallback, index: number, delta: -1 | 1): Fallback {
  const target = index + delta;
  if (index < 0 || index >= state.chain.length || target < 0 || target >= state.chain.length) return state;
  const chain = [...state.chain];
  [chain[index], chain[target]] = [chain[target], chain[index]];
  return { ...state, chain };
}

/** Turns a chain entry off: it leaves the chain for the list Hermes does not read. */
export function turnOffEntry(state: Fallback, index: number): Fallback {
  const entry = state.chain[index];
  if (!entry) return state;
  return { ...state, chain: state.chain.filter((_, at) => at !== index), parked: [...state.parked, entry] };
}

/** Turns an entry on again: it joins the end of the chain, with its endpoint override. */
export function turnOnEntry(state: Fallback, index: number): Fallback {
  const entry = state.parked[index];
  if (!entry) return state;
  return { ...state, chain: [...state.chain, entry], parked: state.parked.filter((_, at) => at !== index) };
}

/** Drops an entry for good from the chain or from the ones turned off. */
export function removeEntry(state: Fallback, list: 'chain' | 'parked', index: number): Fallback {
  return { ...state, [list]: state[list].filter((_, at) => at !== index) };
}

const entryBody = (entry: FallbackEntry): Record<string, unknown> => ({ ...entry.extra, provider: entry.provider, model: entry.model, ...(entry.baseUrl ? { base_url: entry.baseUrl } : {}) });

export interface ConfigWrite {
  method: 'PUT';
  path: string;
  body: Record<string, unknown>;
}

const configPath = (profile: string) => `/api/config?profile=${encodeURIComponent(profile)}`;

/** The config write (Tier 3) that makes the chain, and the entries turned off, what Hermes holds. Hermes replaces both lists whole. */
export function fallbackWriteRequest(profile: string, state: Pick<Fallback, 'chain' | 'parked'>): ConfigWrite {
  return { method: 'PUT', path: configPath(profile), body: { config: { fallback_providers: state.chain.map(entryBody), fallback_providers_disabled: state.parked.map(entryBody) } } };
}

/** What is wrong with an entry the owner is about to add, in plain words; empty when it can be added. */
export function entryProblems(state: Fallback, entry: Pick<FallbackEntry, 'provider' | 'model' | 'baseUrl'>): string[] {
  const provider = entry.provider.trim();
  const model = entry.model.trim();
  const baseUrl = entry.baseUrl.trim().replace(/\/+$/, '');
  const problems: string[] = [];
  if (provider === '') problems.push('Choose or type a provider.');
  if (model === '') problems.push('Choose or type a model.');
  if (baseUrl !== '' && !/^https?:\/\/\S+$/i.test(baseUrl)) problems.push('The endpoint must start with http:// or https://.');
  else if (provider !== '' && model !== '' && state.chain.some((candidate) => candidate.provider === provider && candidate.model === model && candidate.baseUrl === baseUrl)) problems.push('That model is already in the chain with that endpoint.');
  return problems;
}

/** The chain with one more entry at its end (after `entryProblems` found nothing wrong). */
export function addEntry(state: Fallback, entry: Pick<FallbackEntry, 'provider' | 'model' | 'baseUrl'>): Fallback {
  return { ...state, chain: [...state.chain, { provider: entry.provider.trim(), model: entry.model.trim(), baseUrl: entry.baseUrl.trim().replace(/\/+$/, ''), extra: {} }] };
}

/** The config write (Tier 3) for Hermes's failing-over settings; Hermes merges it, so nothing else in the config changes. */
export function settingsWriteRequest(profile: string, settings: FallbackSettings): ConfigWrite {
  return {
    method: 'PUT',
    path: configPath(profile),
    body: { config: { agent: { api_max_retries: settings.apiMaxRetries, auto_recovery_cycles: settings.autoRecoveryCycles }, fallback: { min_switch_reset_seconds: settings.minSwitchResetSeconds } } },
  };
}
