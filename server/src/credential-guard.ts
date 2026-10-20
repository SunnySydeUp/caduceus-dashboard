// What the browser may be told about credentials (M5 #10). Hermes redacts the values it lists (the first and last characters of a key,
// the last characters of a token), and a redacted key is still part of a key. Nothing of a value reaches the page, a cache, a log or the
// audit trail except through Hermes's audited reveal (T3): each answer that lists credentials is rebuilt here from the fields known to be
// safe, so a field Hermes adds later, or one that holds a value by mistake, is dropped and not passed on.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** A record with only the named fields that are present. */
function pick(record: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => (field in record ? [[field, record[field]]] : [])));
}

/** `GET /api/env`: every variable with whether it is set, and none with a preview of its value. */
export function guardEnvSecrets(env: unknown): unknown {
  if (!isRecord(env)) return env;
  return Object.fromEntries(Object.entries(env).map(([name, row]) => [name, isRecord(row) && 'redacted_value' in row ? { ...row, redacted_value: null } : row]));
}

const POOL_ENTRY_FIELDS = ['index', 'id', 'label', 'auth_type', 'source', 'priority', 'last_status', 'request_count', 'has_refresh'] as const;

/** `GET /api/credentials/pool`: each pooled credential's standing, without the preview of its token. */
export function guardPoolSecrets(pool: unknown): unknown {
  if (!isRecord(pool) || !Array.isArray(pool.providers)) return pool;
  const providers = pool.providers.map((provider) => {
    if (!isRecord(provider)) return provider;
    const entries = Array.isArray(provider.entries) ? provider.entries.map((entry) => (isRecord(entry) ? pick(entry, POOL_ENTRY_FIELDS) : entry)) : provider.entries;
    return { ...provider, entries };
  });
  return { ...pool, providers };
}

const OAUTH_STATUS_FIELDS = ['logged_in', 'source', 'source_label', 'expires_at', 'has_refresh_token', 'last_refresh', 'free_tier', 'account_tier', 'error'] as const;

/** `GET /api/providers/oauth`: whether each provider is signed in and until when, without the preview of its token. */
export function guardOauthSecrets(list: unknown): unknown {
  if (!isRecord(list) || !Array.isArray(list.providers)) return list;
  const providers = list.providers.map((provider) => (isRecord(provider) && isRecord(provider.status) ? { ...provider, status: pick(provider.status, OAUTH_STATUS_FIELDS) } : provider));
  return { ...list, providers };
}

/** A key a custom endpoint holds by reference (`${HERMES_CUSTOM_X_API_KEY}`) is a name; anything else in its place is a key. */
const ENV_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

function guardEndpoint(endpoint: unknown): unknown {
  if (!isRecord(endpoint) || typeof endpoint.api_key_preview !== 'string' || ENV_REFERENCE.test(endpoint.api_key_preview)) return endpoint;
  return { ...endpoint, api_key_preview: '' };
}

/** The answer of `GET /api/providers/custom-endpoints`, and of the writes that return the list again: each endpoint says whether it has a key, and never shows part of one. */
export function guardEndpointSecrets(answer: unknown): unknown {
  if (!isRecord(answer) || !Array.isArray(answer.endpoints)) return answer;
  return { ...answer, endpoints: answer.endpoints.map(guardEndpoint) };
}

const VOICE_ENGINE_FIELDS = ['mode', 'wire', 'provider', 'model', 'voice', 'language', 'speed', 'reason'] as const;

/** `GET /api/audio/voice-config`: which speech engines the profile uses and how, without the key and endpoint Hermes hands out so that a client can call the provider itself. */
export function guardVoiceSecrets(answer: unknown): unknown {
  if (!isRecord(answer)) return answer;
  const engine = (value: unknown) => (isRecord(value) ? pick(value, VOICE_ENGINE_FIELDS) : value);
  return { ...answer, ...('stt' in answer && { stt: engine(answer.stt) }), ...('tts' in answer && { tts: engine(answer.tts) }) };
}
