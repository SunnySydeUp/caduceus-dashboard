// What Caduceus knows about the keys of Hermes's config, in one place for the server and the web app: how a nested config is read as
// dotted key paths (`agent.max_turns`), which keys hold a secret, and the mask that stands for a secret's value once it has left Hermes.
import { isRecord } from './policy/guards.ts';

/** What a set secret is called in an answer to the browser: the value itself never leaves Caduceus. */
export const CONFIG_SECRET_MASK = '********';

/**
 * Whether the config key holds a credential. Two rules, both about names, not a list: a key Hermes adds tomorrow is covered.
 * - By the last word of its name (`auxiliary.vision.api_key`, `dashboard.basic_auth.password`, a header called `Authorization` or
 *   `X-Api-Key`); `voice.record_key` or `compression.threshold_tokens` are not secrets.
 * - By where it is: every value under an MCP server's `env` or `headers` (`mcp_servers.fixture.env.FIXTURE_TOKEN`), whose names the
 *   owner chooses, so no name says what the value is.
 */
export function isSecretConfigKey(key: string): boolean {
  if (/^mcp_servers\.[^.]+\.(?:env|headers)\.[^.]+$/.test(key)) return true;
  return /^(?:.*[-_])?(?:api[-_]?key|secret|password|password[-_]hash|passwd|passphrase|token|credentials?|private[-_]key|secret[-_]key|access[-_]key|(?:signing|encryption|hmac|master|session|auth)[-_]key|webhook[-_]url|authorization)$/i.test(key.split('.').at(-1) ?? '');
}

/** A value that is not a plain object is a leaf of the config (a list is one value), and so is an empty text, a number or `null`. */
export function flattenConfig(config: unknown, prefix = '', into: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (!isRecord(config)) return into;
  for (const [name, value] of Object.entries(config)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (isRecord(value)) flattenConfig(value, key, into);
    else into.set(key, value);
  }
  return into;
}

/** The password of an address that carries one (`scheme://user:password@host`); the user stays, so the address still says whose it is. */
const URL_PASSWORD = /(:\/\/[^\s/@:]+:)([^\s/@]+)(@)/g;

/** `text` with the password of every address in it replaced by the mask. */
export function maskUrlPasswords(text: string): string {
  return text.replace(URL_PASSWORD, (_whole, head: string, _password: string, tail: string) => `${head}${CONFIG_SECRET_MASK}${tail}`);
}

/** The passwords of the addresses in `text`. */
export function urlPasswords(text: string): string[] {
  return [...text.matchAll(URL_PASSWORD)].map((match) => match[2]).filter((password) => password !== CONFIG_SECRET_MASK);
}

/** A value that only points at a secret (`${OPENAI_API_KEY}`, which Hermes reads from its environment) is a name, not a credential. */
export function isSecretReference(value: string): boolean {
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value);
}

/**
 * `config` with the value of every secret key that is set (a non-empty text) replaced by the mask, inside lists of tables too
 * (`custom_providers`). `keepReferences` leaves a value that only refers to a secret as it is: the raw file and its export keep those.
 */
export function maskConfigSecrets(config: unknown, { keepReferences = false, prefix = '' }: { keepReferences?: boolean; prefix?: string } = {}): unknown {
  if (Array.isArray(config)) return config.map((item) => maskConfigSecrets(item, { keepReferences, prefix }));
  if (typeof config === 'string') return maskUrlPasswords(config);
  if (!isRecord(config)) return config;
  const masked: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(config)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (isRecord(value) || Array.isArray(value)) masked[name] = maskConfigSecrets(value, { keepReferences, prefix: key });
    else masked[name] = isSecretConfigKey(key) && typeof value === 'string' && value !== '' && !(keepReferences && isSecretReference(value)) ? CONFIG_SECRET_MASK : typeof value === 'string' ? maskUrlPasswords(value) : value;
  }
  return masked;
}

/** The item of `current` an item of an incoming list stands for: the one with the same name (or id, provider, address), else the one at the same place. */
function matchingItem(current: unknown, item: unknown, index: number): unknown {
  if (!Array.isArray(current)) return undefined;
  if (isRecord(item)) {
    for (const identity of ['name', 'id', 'provider', 'base_url', 'url']) {
      const wanted = item[identity];
      if (typeof wanted === 'string') return current.find((candidate) => isRecord(candidate) && candidate[identity] === wanted);
    }
  }
  return current[index];
}

/** An address the page sent back with the password masked, given the password the address held at that place (in the order they appear). */
function restoreUrlPasswords(incoming: string, held: unknown, unresolved: string[], key: string): string {
  if (!incoming.includes(`:${CONFIG_SECRET_MASK}@`)) return incoming;
  const passwords = typeof held === 'string' ? urlPasswords(held) : [];
  let index = 0;
  return incoming.replace(URL_PASSWORD, (whole, head: string, password: string, tail: string) => {
    if (password !== CONFIG_SECRET_MASK) return whole;
    const real = passwords[index++];
    if (real === undefined) {
      unresolved.push(key);
      return whole;
    }
    return `${head}${real}${tail}`;
  });
}

/**
 * `incoming` with every mask that stands for a secret put back as the secret `current` holds at the same place: a config the page was
 * given (masked) and sends back must never write the mask over the credential. A mask with no credential to stand for is left in place
 * and its key is added to `unresolved`, for the caller to refuse the write.
 */
export function restoreMaskedSecrets(incoming: unknown, current: unknown, unresolved: string[], prefix = ''): unknown {
  if (Array.isArray(incoming)) return incoming.map((item, index) => restoreMaskedSecrets(item, matchingItem(current, item, index), unresolved, prefix));
  if (typeof incoming === 'string') return restoreUrlPasswords(incoming, current, unresolved, prefix);
  if (!isRecord(incoming)) return incoming;
  const restored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(incoming)) {
    const key = prefix ? `${prefix}.${name}` : name;
    const held = isRecord(current) ? current[name] : undefined;
    if (isSecretConfigKey(key) && value === CONFIG_SECRET_MASK) {
      if (typeof held === 'string' && held !== '') restored[name] = held;
      else {
        unresolved.push(key);
        restored[name] = value;
      }
    } else restored[name] = restoreMaskedSecrets(value, held, unresolved, key);
  }
  return restored;
}
