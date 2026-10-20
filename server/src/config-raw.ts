// Hermes's raw config file (`GET/PUT /api/config/raw`) holds the same credentials as its config, as text. The page may read it and send it
// back, but never sees a credential: a secret that is set is the mask, and a mask that comes back is put back as the credential it stood for.
import YAML from 'yaml';
import { CONFIG_SECRET_MASK, isSecretConfigKey, isSecretReference, maskConfigSecrets, maskUrlPasswords, restoreMaskedSecrets, urlPasswords } from '@caduceus/contracts/config-keys';

const PARSE = { merge: true } as const;

/** The document of a config file and its value, or `undefined` when it is not a config Hermes would read (a syntax error, a dangling alias). */
function parseConfig(text: string): { doc: YAML.Document.Parsed; value: unknown } | undefined {
  const doc = YAML.parseDocument(text, PARSE);
  if (doc.errors.length > 0) return undefined;
  try {
    return { doc, value: doc.toJS() };
  } catch {
    return undefined;
  }
}

/** The credentials a config holds in its text: every secret key that is set to something other than a reference. */
function secretValues(config: unknown): string[] {
  const found: string[] = [];
  const collect = (node: unknown, prefix: string): void => {
    if (Array.isArray(node)) for (const item of node) collect(item, prefix);
    else if (typeof node === 'object' && node !== null) for (const [name, value] of Object.entries(node)) collect(value, prefix ? `${prefix}.${name}` : name);
    else if (typeof node === 'string' && node !== '') {
      if (isSecretConfigKey(prefix) && !isSecretReference(node)) found.push(node);
      found.push(...urlPasswords(node));
    }
  };
  collect(config, '');
  return found;
}

/** Sets every secret scalar of a parsed document to the mask, keeping comments and layout. */
function maskNode(node: unknown, prefix: string): void {
  if (YAML.isScalar(node) && typeof node.value === 'string' && urlPasswords(node.value).length > 0) node.value = maskUrlPasswords(node.value);
  else if (YAML.isSeq(node)) for (const item of node.items) maskNode(item, prefix);
  else if (YAML.isMap(node)) {
    for (const pair of node.items) {
      const name = YAML.isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      const key = prefix ? `${prefix}.${name}` : name;
      const value = pair.value;
      if (YAML.isScalar(value) && isSecretConfigKey(key) && typeof value.value === 'string' && value.value !== '' && !isSecretReference(value.value)) {
        value.value = CONFIG_SECRET_MASK;
        value.type = 'PLAIN';
      } else if (YAML.isAlias(value) && isSecretConfigKey(key)) pair.value = new YAML.Scalar(CONFIG_SECRET_MASK);
      else if (YAML.isScalar(value) && typeof value.value === 'string' && urlPasswords(value.value).length > 0) value.value = maskUrlPasswords(value.value);
      else maskNode(value, key);
    }
  }
}

/** A comment that holds a credential (`# api_key: sk-…`, a line the owner switched off) keeps its key and loses the value. */
function maskComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s*#\s*)([\w.-]+)(\s*[:=]\s*)(?!['"]{0,2}$)(\S.*)$/, (whole, lead: string, name: string, sep: string, value: string) => (isSecretConfigKey(name) && !isSecretReference(value.trim()) ? `${lead}${name}${sep}${CONFIG_SECRET_MASK}` : whole)))
    .map(maskUrlPasswords)
    .join('\n');
}

/**
 * Hermes's config file with every credential replaced by the mask. A file that does not parse (the one reason the owner would open the
 * raw editor) is masked line by line instead. Whatever the way, a credential that is still in the text (in a comment, or under an
 * anchor) sends the answer through the parsed config, which carries no comments.
 */
export function maskRawConfig(text: string): string {
  const parsed = parseConfig(text);
  if (parsed === undefined) {
    return text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .map((line) => line.replace(/^(\s*(?:-\s+)?)([^\s:#]+):[ \t]*(\S.*)$/, (whole, lead: string, name: string, value: string) => (isSecretConfigKey(name) && !isSecretReference(value.trim()) ? `${lead}${name}: ${CONFIG_SECRET_MASK}` : whole)))
      .map(maskUrlPasswords)
      .join('\n');
  }
  const { doc, value } = parsed;
  const secrets = secretValues(value);
  maskNode(doc.contents, '');
  const masked = maskComments(doc.toString());
  if (!secrets.some((secret) => masked.includes(secret))) return masked;
  return YAML.stringify(maskConfigSecrets(value, { keepReferences: true }));
}

/** What Hermes keeps for a profile now, as an object: the credentials masks stand for. `undefined` when Hermes does not answer with a file. */
export function parseRawConfig(text: string): unknown {
  return parseConfig(text)?.value;
}

export type Unmasked = { ok: true; body: string } | { ok: false; unresolved: string[] };

/**
 * A write whose `config` or `yaml_text` came from a masked answer, with every mask put back as the credential Hermes holds for the same
 * key. `current` is Hermes's own config of the profile. A mask with no credential behind it makes the write refuse (`unresolved`):
 * writing the mask would store it as the credential.
 */
export function unmaskWrite(route: 'config' | 'raw' | 'mcp', body: Record<string, unknown>, current: unknown): Unmasked {
  const unresolved: string[] = [];
  if (route === 'mcp') {
    const heldServers = typeof current === 'object' && current !== null && 'mcp_servers' in current ? current.mcp_servers : undefined;
    const servers = restoreMaskedSecrets(body.servers, heldServers, unresolved, 'mcp_servers');
    return unresolved.length > 0 ? { ok: false, unresolved } : { ok: true, body: JSON.stringify({ ...body, servers }) };
  }
  if (route === 'config') {
    const config = restoreMaskedSecrets(body.config, current, unresolved);
    return unresolved.length > 0 ? { ok: false, unresolved } : { ok: true, body: JSON.stringify({ ...body, config }) };
  }
  const text = body.yaml_text;
  if (typeof text !== 'string' || !text.includes(CONFIG_SECRET_MASK)) return { ok: true, body: JSON.stringify(body) };
  const parsed = parseConfig(text);
  // Text that does not parse is Hermes's to refuse, with its own line numbers.
  if (parsed === undefined) return { ok: true, body: JSON.stringify(body) };
  const restored = restoreMaskedSecrets(parsed.value, current, unresolved);
  if (unresolved.length > 0) return { ok: false, unresolved };
  // Hermes replaces its file with the parsed text and keeps no comments of it, so what is sent is the parsed config, not the text.
  return { ok: true, body: JSON.stringify({ ...body, yaml_text: YAML.stringify(restored) }) };
}
