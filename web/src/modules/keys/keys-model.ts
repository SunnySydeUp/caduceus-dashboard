// System › Keys: Hermes's environment read as the keys a person manages, and the requests the page makes. Pure: no DOM, no React,
// no fetch. Hermes is the source of truth (D1): a row is what Hermes lists now. The page is never given a key's value, nor any part of
// it (Caduceus takes Hermes's redacted preview out of every answer); the one way to see a value is Hermes's audited reveal.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** A request to Hermes: the route's tier is the policy map's, not decided here. */
export interface KeysRequest {
  method: 'POST' | 'PUT' | 'DELETE';
  /** The Hermes path with its query, exactly as it is sent. */
  path: string;
  body?: Record<string, unknown>;
}

const scoped = (route: string, profile: string) => `${route}?profile=${encodeURIComponent(profile)}`;

export interface KeyRow {
  /** The environment variable: `OPENROUTER_API_KEY`. */
  name: string;
  /** Hermes's provider id (`openrouter`), or an empty string for a variable that belongs to no provider. */
  provider: string;
  providerLabel: string;
  description: string;
  url: string | undefined;
  isSet: boolean;
  /** Hermes treats the value as a secret: it is masked and reveal-gated. */
  secret: boolean;
  /** A variable in the profile's `.env` that Hermes has no catalogue entry for. */
  custom: boolean;
}

export type KeyGroupId = 'provider' | 'tool' | 'custom';

export interface KeyGroup {
  id: KeyGroupId;
  title: string;
  keys: KeyRow[];
}

const GROUP_TITLES: Record<KeyGroupId, string> = { provider: 'Model providers', tool: 'Tool keys', custom: 'Other variables' };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * `GET /api/env`: every variable Hermes knows, as the keys of the three groups the page shows. Channel credentials belong to Connect ›
 * Channels and are left out, and so are the settings that are not secrets (a base URL, a path). Within a group, keys are in name order.
 */
export function parseKeys(env: unknown): KeyGroup[] {
  const groups: Record<KeyGroupId, KeyRow[]> = { provider: [], tool: [], custom: [] };
  for (const [name, row] of Object.entries(isRecord(env) ? env : {})) {
    if (!isRecord(row) || row.channel_managed === true) continue;
    const category = text(row.category);
    const group: KeyGroupId | undefined = category === 'custom' || row.custom === true ? 'custom' : category === 'provider' ? 'provider' : category === 'tool' ? 'tool' : undefined;
    if (!group || row.is_password !== true) continue;
    groups[group].push({
      name,
      provider: text(row.provider),
      providerLabel: text(row.provider_label),
      description: text(row.description),
      url: text(row.url) || undefined,
      isSet: row.is_set === true,
      secret: true,
      custom: group === 'custom',
    });
  }
  return (Object.keys(groups) as KeyGroupId[]).map((id) => ({ id, title: GROUP_TITLES[id], keys: groups[id].sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Sets a key (a new one, or a replacement): Tier 2. */
export const keyReplace = (name: string, value: string, profile: string): KeysRequest => ({ method: 'PUT', path: scoped('/api/env', profile), body: { key: name, value } });

/** Removes a key from the profile's `.env` and every mirror Hermes keeps of it: Tier 2. */
export const keyRemove = (name: string, profile: string): KeysRequest => ({ method: 'DELETE', path: scoped('/api/env', profile), body: { key: name } });

/** Asks Hermes for a key's value: Tier 3, audited, and the answer is the one thing in the app no cache may keep. */
export const keyReveal = (name: string, profile: string): KeysRequest => ({ method: 'POST', path: scoped('/api/env/reveal', profile), body: { key: name } });

/** One credential in a provider's pool, as Hermes lists it. */
export interface PoolEntry {
  /** Hermes's 1-based position in the provider's pool: what a removal names, and it moves when an earlier entry goes. */
  index: number;
  id: string;
  label: string;
  authType: string;
  /** Where Hermes got it: `manual` (added here), `device_code`, or `env:NAME` for a variable Hermes seeded it from. */
  source: string;
  priority: number;
  /** How the credential last fared: `ok`, `exhausted` (cooling down after errors) or `dead` (rejected); undefined when it has not been used. */
  status: 'ok' | 'exhausted' | 'dead' | undefined;
  requests: number;
  hasRefresh: boolean;
}

export interface PoolProvider {
  provider: string;
  entries: PoolEntry[];
}

const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** `GET /api/credentials/pool`: the providers that have pooled credentials, with each credential's standing. Hermes sends a redacted preview of each value, which Caduceus takes out and this ignores. */
export function parsePool(pool: unknown): PoolProvider[] {
  const providers = isRecord(pool) && Array.isArray(pool.providers) ? pool.providers : [];
  return providers.flatMap((provider): PoolProvider[] => {
    if (!isRecord(provider) || typeof provider.provider !== 'string') return [];
    const entries = (Array.isArray(provider.entries) ? provider.entries : []).flatMap((entry): PoolEntry[] => {
      if (!isRecord(entry)) return [];
      const status = entry.last_status === 'ok' || entry.last_status === 'exhausted' || entry.last_status === 'dead' ? entry.last_status : undefined;
      return [{ index: num(entry.index), id: text(entry.id), label: text(entry.label), authType: text(entry.auth_type), source: text(entry.source), priority: num(entry.priority), status, requests: num(entry.request_count), hasRefresh: entry.has_refresh === true }];
    });
    return entries.length > 0 ? [{ provider: provider.provider, entries }] : [];
  });
}

/** Pools a new API key for a provider: Tier 2. The label is optional; Hermes numbers an unlabelled key. */
export const poolAdd = (provider: string, apiKey: string, label: string, profile: string): KeysRequest => ({
  method: 'POST',
  path: scoped('/api/credentials/pool', profile),
  body: { provider, api_key: apiKey, ...(label.trim() ? { label: label.trim() } : {}) },
});

/** Removes the credential at `index` (1-based, as listed) from a provider's pool: Tier 2. */
export const poolRemove = (provider: string, index: number, profile: string): KeysRequest => ({ method: 'DELETE', path: scoped(`/api/credentials/pool/${encodeURIComponent(provider)}/${index}`, profile) });

export type ApiMode = '' | 'chat_completions' | 'codex_responses' | 'anthropic_messages';

/** The transports Hermes can speak to an endpoint, with the words the form uses. An empty mode is Hermes finding out from the address. */
export const API_MODES: readonly { value: ApiMode; label: string }[] = [
  { value: '', label: 'Detect from the address' },
  { value: 'chat_completions', label: 'Chat Completions (OpenAI-compatible)' },
  { value: 'codex_responses', label: 'Responses API' },
  { value: 'anthropic_messages', label: 'Anthropic Messages' },
];

/** One custom endpoint provider, as Hermes lists it. */
export interface Endpoint {
  /** The key of the endpoint in the profile's `providers`: what an edit, a delete and Use name. */
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  models: string[];
  apiMode: ApiMode;
  contextLength: number | undefined;
  discoverModels: boolean;
  /** Whether a key is held for it. Hermes keeps the key in the profile's `.env` and the page is never told any of it. */
  hasApiKey: boolean;
  /** The profile's chat model is this endpoint. */
  isCurrent: boolean;
}

/** `GET /api/providers/custom-endpoints`, and the writes that answer with the list again. */
export function parseEndpoints(answer: unknown): Endpoint[] {
  const rows = isRecord(answer) && Array.isArray(answer.endpoints) ? answer.endpoints : [];
  return rows.flatMap((row): Endpoint[] => {
    if (!isRecord(row) || typeof row.id !== 'string') return [];
    const mode = API_MODES.find((candidate) => candidate.value === row.api_mode)?.value ?? '';
    return [
      {
        id: row.id,
        name: text(row.name) || row.id,
        baseUrl: text(row.base_url),
        model: text(row.model),
        models: Array.isArray(row.models) ? row.models.filter((model): model is string => typeof model === 'string') : [],
        apiMode: mode,
        contextLength: typeof row.context_length === 'number' && row.context_length > 0 ? row.context_length : undefined,
        discoverModels: row.discover_models !== false,
        hasApiKey: row.has_api_key === true,
        isCurrent: row.is_current === true,
      },
    ];
  });
}

/** What the add and edit form holds. */
export interface EndpointForm {
  /** The endpoint being edited; empty for a new one, whose id Hermes makes from its name. */
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** A key typed now. Left empty, an edit keeps the key Hermes holds. */
  apiKey: string;
  /** An edit that removes the key Hermes holds. */
  clearKey: boolean;
  apiMode: ApiMode;
  /** The context window in tokens, as typed; empty leaves Hermes to work it out. */
  contextLength: string;
  discoverModels: boolean;
}

export const emptyEndpointForm = (): EndpointForm => ({ id: '', name: '', baseUrl: '', model: '', apiKey: '', clearKey: false, apiMode: '', contextLength: '', discoverModels: true });

/** The form of an edit: what Hermes lists, with no key (the page has none). */
export const endpointFormOf = (endpoint: Endpoint): EndpointForm => ({
  id: endpoint.id,
  name: endpoint.name,
  baseUrl: endpoint.baseUrl,
  model: endpoint.model,
  apiKey: '',
  clearKey: false,
  apiMode: endpoint.apiMode,
  contextLength: endpoint.contextLength === undefined ? '' : String(endpoint.contextLength),
  discoverModels: endpoint.discoverModels,
});

export type EndpointField = 'name' | 'baseUrl' | 'model' | 'apiKey' | 'contextLength';

const MAX_NAME = 64;

/** Why the form cannot be saved yet, by field; empty when it can. Hermes checks the same things again and has the last word. */
export function endpointProblems(form: EndpointForm): Partial<Record<EndpointField, string>> {
  const problems: Partial<Record<EndpointField, string>> = {};
  const name = form.name.trim();
  if (name === '') problems.name = 'Give the endpoint a name.';
  else if (name.length > MAX_NAME) problems.name = `Keep the name to ${MAX_NAME} characters.`;
  const url = (() => {
    try {
      return new URL(form.baseUrl.trim());
    } catch {
      return undefined;
    }
  })();
  if (form.baseUrl.trim() === '') problems.baseUrl = 'Enter the endpoint’s address.';
  else if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') problems.baseUrl = 'The address must start with http:// or https:// and name a host, such as http://127.0.0.1:8000/v1.';
  if (form.model.trim() === '') problems.model = 'Name the model to use on this endpoint.';
  if (/\s/.test(form.apiKey.trim())) problems.apiKey = 'An API key has no spaces or line breaks.';
  const context = form.contextLength.trim();
  if (context !== '' && !/^[1-9][0-9]*$/.test(context)) problems.contextLength = 'Enter the number of tokens as a whole number, or leave it empty.';
  return problems;
}

/** Creates the endpoint, or saves an edit (Hermes takes both as one route): Tier 2. An edit that types no key keeps the one Hermes holds. */
export function endpointSave(form: EndpointForm, profile: string): KeysRequest {
  const key = form.apiKey.trim();
  const context = form.contextLength.trim();
  return {
    method: 'POST',
    path: scoped('/api/providers/custom-endpoints', profile),
    body: {
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim(),
      base_url: form.baseUrl.trim(),
      model: form.model.trim(),
      api_mode: form.apiMode,
      discover_models: form.discoverModels,
      ...(context ? { context_length: Number(context) } : {}),
      // Hermes leaves the key alone when none is sent, sets it when one is, and removes it for an empty one.
      ...(key ? { api_key: key } : form.clearKey ? { api_key: '' } : {}),
    },
  };
}

export const endpointDelete = (id: string, profile: string): KeysRequest => ({ method: 'DELETE', path: scoped(`/api/providers/custom-endpoints/${encodeURIComponent(id)}`, profile) });

/** Makes the endpoint the profile's chat model: Tier 1. */
export const endpointActivate = (id: string, profile: string): KeysRequest => ({ method: 'POST', path: scoped(`/api/providers/custom-endpoints/${encodeURIComponent(id)}/activate`, profile) });

/** Asks Hermes to look at the address the form holds (its model list, and a request the way a chat would make one): Tier 1, it reaches the address and sends the key typed in the form. */
export function endpointCheck(form: EndpointForm): KeysRequest {
  const key = form.apiKey.trim();
  return { method: 'POST', path: '/api/providers/custom-endpoints/validate', body: { name: form.name.trim() || 'check', base_url: form.baseUrl.trim(), model: form.model.trim(), api_mode: form.apiMode, ...(key ? { api_key: key } : {}) } };
}

/** What Hermes found at an address. */
export interface EndpointCheck {
  ok: boolean;
  /** Something answered at the address (even to refuse the key). */
  reachable: boolean;
  message: string;
  /** The models the endpoint lists. */
  models: string[];
}

export function parseEndpointCheck(answer: unknown): EndpointCheck {
  if (!isRecord(answer)) return { ok: false, reachable: false, message: 'Hermes did not answer the check.', models: [] };
  return { ok: answer.ok === true, reachable: answer.reachable === true, message: text(answer.message), models: Array.isArray(answer.models) ? answer.models.filter((model): model is string => typeof model === 'string') : [] };
}

/**
 * Checks the key Hermes holds, with Hermes's own validation (`POST /api/providers/validate`), for the profile: Tier 1, because it sends the key to
 * the provider. Caduceus fetches the key from Hermes itself, so the page never holds it.
 */
export const keyTest = (name: string, profile: string): KeysRequest => ({ method: 'POST', path: scoped('/_caduceus/api/keys/test', profile), body: { key: name } });

/** What Hermes's validation said about a key. */
export interface KeyTestResult {
  ok: boolean;
  /** Hermes could look: the provider (or the endpoint) answered. */
  reachable: boolean;
  message: string;
  /** The models an endpoint lists, when the key is the address of one. */
  models: string[];
}

export function parseKeyTest(answer: unknown): KeyTestResult {
  if (!isRecord(answer)) return { ok: false, reachable: false, message: 'Hermes did not answer the check.', models: [] };
  return { ok: answer.ok === true, reachable: answer.reachable === true, message: text(answer.message), models: Array.isArray(answer.models) ? answer.models.filter((model): model is string => typeof model === 'string') : [] };
}

export type KeyVerdictState = 'works' | 'rejected' | 'unreachable' | 'unchecked';

export interface KeyVerdict {
  state: KeyVerdictState;
  text: string;
}

/** Hermes's validation as a verdict in words: it works, the provider refused it, the provider could not be reached, or Hermes has no live check for this provider. */
export function keyVerdict(result: KeyTestResult): KeyVerdict {
  if (result.reachable) return result.ok ? { state: 'works', text: result.models.length > 0 ? `Accepted. It lists ${result.models.length === 1 ? '1 model' : `${result.models.length} models`}.` : 'Accepted.' } : { state: 'rejected', text: result.message || 'The provider rejected it.' };
  if (result.ok) return { state: 'unchecked', text: 'Hermes has no live check for this provider, so it could not tell whether the key works.' };
  return { state: 'unreachable', text: result.message || 'Hermes could not reach the provider to check.' };
}

/** One provider Hermes can sign in to with an account, as it lists them. */
export interface OauthProvider {
  id: string;
  name: string;
  /** `device_code`: Hermes runs the sign-in (a code and a link). `external`: another program owns the login, and Hermes only reads it. */
  flow: 'device_code' | 'external';
  docsUrl: string | undefined;
  /** The command that signs in on the Mac that runs Hermes, for a provider Hermes cannot sign in itself. */
  cliCommand: string | undefined;
  loggedIn: boolean;
  /** When the login stops working, as an ISO time; undefined when Hermes does not say. */
  expiresAt: string | undefined;
  /** Where the login comes from, as Hermes names it. */
  sourceLabel: string | undefined;
  hasRefresh: boolean;
  /** Hermes can disconnect it. Otherwise `disconnectHint` says where. */
  disconnectable: boolean;
  disconnectHint: string | undefined;
  error: string | undefined;
}

/** Hermes names where a login comes from, and for some providers that is the path of its auth file: the owner is told the fact, not the path. */
const plainSource = (label: string): string | undefined => (label === '' ? undefined : /[\\/]|\.json\b/.test(label) ? 'Sign-in saved on this Mac' : label);

/** `GET /api/providers/oauth`. Hermes sends a preview of each token, which Caduceus takes out and this ignores. */
export function parseOauth(list: unknown): OauthProvider[] {
  const rows = isRecord(list) && Array.isArray(list.providers) ? list.providers : [];
  return rows.flatMap((row): OauthProvider[] => {
    if (!isRecord(row) || typeof row.id !== 'string') return [];
    const status = isRecord(row.status) ? row.status : {};
    return [
      {
        id: row.id,
        name: text(row.name) || row.id,
        flow: row.flow === 'device_code' ? 'device_code' : 'external',
        docsUrl: text(row.docs_url) || undefined,
        cliCommand: text(row.cli_command) || undefined,
        loggedIn: status.logged_in === true,
        expiresAt: text(status.expires_at) || undefined,
        sourceLabel: plainSource(text(status.source_label)),
        hasRefresh: status.has_refresh_token === true,
        disconnectable: row.disconnectable === true,
        disconnectHint: text(row.disconnect_hint) || undefined,
        error: text(status.error) || undefined,
      },
    ];
  });
}

/** Starts a device-code sign-in for the profile: Tier 1, because it asks the provider for a code. Hermes runs the rest on its own. */
export const oauthStart = (provider: string, profile: string): KeysRequest => ({ method: 'POST', path: scoped(`/api/providers/oauth/${encodeURIComponent(provider)}/start`, profile) });

/** Hermes's own record of a sign-in: a plain read, which the page asks again until it is over. */
export const oauthPollPath = (provider: string, sessionId: string, profile: string): string => scoped(`/api/providers/oauth/${encodeURIComponent(provider)}/poll/${encodeURIComponent(sessionId)}`, profile);

/** Cancels a sign-in that is waiting: Tier 0. Hermes stops waiting and saves nothing. */
export const oauthCancelSession = (sessionId: string, profile: string): KeysRequest => ({ method: 'DELETE', path: scoped(`/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`, profile) });

/** Signs a provider out in the profile: Tier 2. */
export const oauthDisconnect = (provider: string, profile: string): KeysRequest => ({ method: 'DELETE', path: scoped(`/api/providers/oauth/${encodeURIComponent(provider)}`, profile) });

/** What a person does to finish a device-code sign-in: open the link on any device, and enter the code. */
export interface DeviceCode {
  sessionId: string;
  userCode: string;
  /** An absolute http(s) address, as Hermes was given it by the provider. */
  verificationUrl: string;
  /** Seconds the code lasts, from when Hermes was given it. */
  expiresIn: number;
  /** Seconds between Hermes's own checks, which the page follows. */
  pollInterval: number;
}

/** Hermes's answer to starting a sign-in, or `undefined` when it is not a code and a link a person can use. */
export function parseDeviceCode(answer: unknown): DeviceCode | undefined {
  if (!isRecord(answer) || typeof answer.session_id !== 'string' || typeof answer.user_code !== 'string' || typeof answer.verification_url !== 'string') return undefined;
  const link = (() => {
    try {
      const url = new URL(answer.verification_url);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  })();
  if (!link || answer.user_code === '') return undefined;
  return { sessionId: answer.session_id, userCode: answer.user_code, verificationUrl: link, expiresIn: num(answer.expires_in, 900), pollInterval: Math.max(1, num(answer.poll_interval, 5)) };
}

export type LoginState = 'approved' | 'denied' | 'expired' | 'error' | 'cancelled';

/** How a device-code sign-in ended. */
export interface LoginEnd {
  state: LoginState;
  message?: string;
}

/** What `followLogin` stands on: a poll of Hermes's record of the sign-in, a wait that `signal` cuts short, and the clock. */
export interface LoginDriver {
  poll(): Promise<{ status: number; body: unknown }>;
  wait(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
}

/** How long past its lifetime Hermes is given to say a code ran out itself, in its own words. */
const EXPIRY_GRACE_MS = 15_000;
/** How many polls in a row may fail before the page gives up on Hermes. */
const POLL_FAILURES_ALLOWED = 4;

/**
 * Follows a sign-in until it is over: asks Hermes how it stands every `pollInterval`, and ends on approval, a denial, an error, the code running
 * out (by Hermes's word, by its being forgotten, or by the clock) or the owner cancelling. Hermes's worker thread finishes the sign-in once the
 * person has approved it; nothing here saves a token.
 */
export async function followLogin(code: DeviceCode, driver: LoginDriver, signal?: AbortSignal): Promise<LoginEnd> {
  const lapsesAt = driver.now() + code.expiresIn * 1000;
  let failures = 0;
  for (;;) {
    if (signal?.aborted) return { state: 'cancelled' };
    let answer: { status: number; body: unknown } | undefined;
    try {
      answer = await driver.poll();
    } catch {
      answer = undefined;
    }
    if (answer?.status === 404) return { state: 'expired', message: 'Hermes no longer has this sign-in: the code ran out or the sign-in was cancelled.' };
    if (answer && answer.status >= 200 && answer.status < 300 && isRecord(answer.body)) {
      failures = 0;
      const { status, error_message: reason } = answer.body;
      const message = typeof reason === 'string' && reason !== '' ? reason : undefined;
      if (status === 'approved') return { state: 'approved' };
      if (status === 'denied') return { state: 'denied', message: message ?? 'The sign-in was declined.' };
      if (status === 'expired') return { state: 'expired', message: message ?? 'The code ran out before it was approved.' };
      if (status === 'cancelled') return { state: 'cancelled' };
      if (status === 'error') return driver.now() >= lapsesAt ? { state: 'expired', message: 'The code ran out before it was approved.' } : { state: 'error', message: message ?? 'Hermes could not finish the sign-in.' };
    } else if (++failures > POLL_FAILURES_ALLOWED) {
      return { state: 'error', message: 'Caduceus could not reach Hermes to follow the sign-in. It may still finish: check the list again.' };
    }
    if (driver.now() >= lapsesAt + EXPIRY_GRACE_MS) return { state: 'expired', message: 'The code ran out before it was approved.' };
    await driver.wait(code.pollInterval * 1000, signal);
  }
}

/** What Hermes says of the Nous Portal account and the Tool Gateway for the profile. Read-only: Caduceus has no billing or subscription action. */
export interface Portal {
  loggedIn: boolean;
  /** The free tier: signed in with an identity that has not subscribed. */
  freeTier: boolean;
  accountTier: string | undefined;
  /** The profile's chat provider, as Hermes names it. */
  provider: string;
  portalUrl: string | undefined;
  /** Where the account's subscription is managed: on Nous's own site, in the owner's browser. */
  subscriptionUrl: string | undefined;
  /** What each Tool Gateway feature is routed through. */
  features: { label: string; state: string }[];
}

/** `GET /api/portal`. */
export function parsePortal(answer: unknown): Portal | undefined {
  if (!isRecord(answer)) return undefined;
  const web = (value: unknown): string | undefined => {
    const link = text(value);
    return /^https?:\/\//i.test(link) ? link : undefined;
  };
  return {
    loggedIn: answer.logged_in === true,
    freeTier: answer.free_tier === true,
    accountTier: text(answer.account_tier) || undefined,
    provider: text(answer.provider),
    portalUrl: web(answer.portal_url),
    subscriptionUrl: web(answer.subscription_url),
    features: (Array.isArray(answer.features) ? answer.features : []).flatMap((feature): { label: string; state: string }[] => (isRecord(feature) && typeof feature.label === 'string' ? [{ label: feature.label, state: text(feature.state) }] : [])),
  };
}

/** Checks a value the owner has typed and not yet saved, with Hermes's own validation: a plain read (Hermes asks the provider, and stores nothing). */
export const providerCheck = (name: string, value: string): KeysRequest => ({ method: 'POST', path: '/api/providers/validate', body: { key: name, value } });

/** The keys that are not set yet and match the search, in name order: what Add key offers. Every word of the search has to match the variable, its provider or Hermes's sentence about it. */
export function candidateKeys(keys: readonly KeyRow[], query: string): KeyRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return keys
    .filter((key) => !key.isSet)
    .filter((key) => {
      const haystack = `${key.name} ${key.provider} ${key.providerLabel} ${key.description}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What is wrong with the name of a variable the owner makes up, or `undefined`: a name `.env` can hold. */
export function keyNameProblem(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'Name the variable, for example MY_SERVICE_API_KEY.';
  if (trimmed.length > 100) return 'Keep the name to 100 characters.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return 'Use letters, digits and underscores only, and do not start with a digit.';
  return undefined;
}

/** What is wrong with a value the owner typed, or `undefined`. Surrounding space is dropped; space inside is not part of a key. */
export function keyValueProblem(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return 'Paste the key.';
  if (/\s/.test(trimmed)) return 'A key has no spaces or line breaks. Check that you pasted only the key.';
  return undefined;
}
