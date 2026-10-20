// The Hindsight browser (R10, M4 #10). Hermes keeps only the memory provider's settings (`hindsight/config.json`) and its key (`.env`), so Caduceus
// reads both from Hermes (the settings through the provider's config route, the key through Hermes's audited `env/reveal`), calls Hindsight's own HTTP
// API itself (the routes of its OpenAPI document, and only the few listed below), and gives the page what Hindsight answered. The key stays in this
// process: it is held in memory for a minute (Hermes allows five reveals per half minute), never written down and never part of an answer, an error
// message or an audit entry. Nothing Hindsight said is kept except the list of banks (D1): it shows which banks there were when Hindsight cannot be reached.
import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { HindsightBankRow, HindsightStatus } from '@caduceus/contracts/hindsight-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuditLog } from './audit-log.ts';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { judgeOwned } from './owned-request.ts';
import type { RestPolicy } from './policy.ts';

export interface HindsightRoutesDeps {
  backend: HermesBackend;
  policy: RestPolicy;
  audit: AuditLog;
  store: CaduceusStore;
}

/** How long a key revealed by Hermes is kept in memory. */
const KEY_KEPT_MS = 60_000;
/** How long Hindsight gets to answer: a reflect asks a language model, and Hindsight's own client allows two minutes. */
const READ_TIMEOUT_MS = 30_000;
const REFLECT_TIMEOUT_MS = 120_000;
/** Banks and rows asked of Hindsight at a time. */
const BANK_LIMIT = 200;
const MAX_ROWS = 100;
const MAX_QUERY_CHARS = 2000;
const MAX_CONTENT_CHARS = 20_000;
const BUDGETS = ['low', 'mid', 'high'];
const FACT_TYPES = ['world', 'experience', 'observation'];
const BANK_ID = /^[^/\\?#%\0-\x1f]{1,128}$/;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const jsonOf = (res: Response): Promise<unknown> => res.json().catch(() => undefined);

/** Where a profile's Hindsight is and how to ask it. */
interface Connection {
  profile: string;
  mode: string;
  apiUrl: string;
  bank: string;
  key: string | undefined;
  /** The address the key is pinned to, when Hermes's setting no longer names it: the key is not sent until the owner says the new address is right. */
  pinnedTo?: string;
}

type Resolved = { state: 'off' } | { state: 'embedded'; mode: string } | { state: 'ready'; connection: Connection } | { state: 'hermes-error'; message: string };

type Upstream = { ok: true; body: unknown } | { ok: false; kind: 'unreachable' | 'rejected' | 'bad-request' | 'upstream'; message: string };

/** The value a field of Hermes's provider form has for the mode in use (the schema lists `api_url` once per mode). */
function fieldValue(fields: unknown[], key: string, mode: string): string {
  const matching = fields.filter((field): field is Record<string, unknown> => isRecord(field) && field.key === key && (!isRecord(field.when) || field.when.mode === mode || field.when.mode === undefined));
  return text(matching.at(-1)?.value);
}

/** A bank id template rendered for the profile, the way the provider does for `{profile}`; the placeholders only a running session knows are empty, and the runs of `-` or `_` they leave are collapsed. */
function renderBankTemplate(template: string, profile: string, fallback: string): string {
  if (template === '') return fallback;
  const segment = profile.replace(/[^A-Za-z0-9_-]/g, '-');
  const rendered = template.replace(/\{(\w+)\}/g, (_whole, name: string) => (name === 'profile' ? segment : '')).replace(/([-_])\1+/g, '$1').replace(/^[-_]+|[-_]+$/g, '');
  return rendered || fallback;
}

/** A URL Caduceus is willing to call: http or https, no user name or password in it. */
function apiUrlOf(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') return undefined;
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/** Whether a host is this Mac's own or a private network's: a loopback, link-local or private address, `localhost`, or a name that only a local network resolves. */
function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.internal') || name.endsWith('.lan') || !name.includes('.') && !name.includes(':')) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(name);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return name.includes(':') && (name === '::1' || name === '::' || /^f[cd]/.test(name) || name.startsWith('fe80') || name.startsWith('::ffff:'));
}

export function mountHindsightRoutes(app: Hono<AuthEnv>, { backend, policy, audit, store }: HindsightRoutesDeps): void {
  const { db } = store;
  const keys = new Map<string, { key: string | undefined; at: number }>();

  async function revealKey(profile: string): Promise<{ key: string | undefined } | 'rate-limited' | 'failed'> {
    const held = keys.get(profile);
    if (held && Date.now() - held.at < KEY_KEPT_MS) return { key: held.key };
    const reveal = await backend.fetch(`/api/env/reveal?profile=${encodeURIComponent(profile)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'HINDSIGHT_API_KEY' }) });
    if (reveal.status === 404) {
      keys.set(profile, { key: undefined, at: Date.now() });
      return { key: undefined };
    }
    if (reveal.status === 429) return held ? { key: held.key } : 'rate-limited';
    const revealed = await jsonOf(reveal);
    if (!reveal.ok || !isRecord(revealed) || typeof revealed.value !== 'string') return 'failed';
    keys.set(profile, { key: revealed.value, at: Date.now() });
    return { key: revealed.value };
  }

  async function resolve(profile: string): Promise<Resolved> {
    const memory = await jsonOf(await backend.fetch(`/api/memory?profile=${encodeURIComponent(profile)}`));
    if (!isRecord(memory) || memory.active !== 'hindsight') return { state: 'off' };
    // Since Hermes 0.22 Hindsight is a plugin installed from the catalogue, not part of Hermes: a profile can still name it with no code behind the name.
    const named = Array.isArray(memory.providers) ? memory.providers.find((row) => isRecord(row) && row.name === 'hindsight') : undefined;
    if (isRecord(named) && named.status === 'missing') return { state: 'hermes-error', message: 'Hermes names Hindsight as this profile’s memory provider, but the Hindsight plugin is not installed. Install it with “hermes plugins install hindsight”, then look again.' };
    const form = await jsonOf(await backend.fetch(`/api/memory/providers/hindsight/config?profile=${encodeURIComponent(profile)}`));
    const fields = isRecord(form) && Array.isArray(form.fields) ? form.fields : [];
    const mode = fieldValue(fields, 'mode', '') || 'cloud';
    if (mode === 'local_embedded') return { state: 'embedded', mode };
    const apiUrl = apiUrlOf(fieldValue(fields, 'api_url', mode));
    if (apiUrl === undefined) return { state: 'hermes-error', message: 'The Hindsight address in Hermes’s settings is not a web address Caduceus can call.' };
    // Hindsight Cloud is a public https service: an address on this Mac or a private network in that mode is not it, and is not sent the key.
    const target = new URL(apiUrl);
    if (mode === 'cloud' && (target.protocol !== 'https:' || isPrivateHost(target.hostname))) return { state: 'hermes-error', message: 'In cloud mode Hindsight must be a public https address. The one in Hermes’s settings is not, so Caduceus did not call it.' };
    // The key goes only to the address it was first used with. A changed address is called without it (a key a changed setting could send anywhere is not one Caduceus holds).
    const pinned = db.prepare('SELECT api_url FROM hindsight_key_urls WHERE profile = ?').get(profile) as { api_url: string } | undefined;
    if (pinned && pinned.api_url !== apiUrl) {
      const bank = renderBankTemplate(fieldValue(fields, 'bank_id_template', mode), profile, fieldValue(fields, 'bank_id', mode) || 'hermes');
      return { state: 'ready', connection: { profile, mode, apiUrl, bank, key: undefined, pinnedTo: pinned.api_url } };
    }
    const revealed = await revealKey(profile);
    if (revealed === 'rate-limited') return { state: 'hermes-error', message: 'Hermes limits how often a key can be read. Try again in a few seconds.' };
    if (revealed === 'failed') return { state: 'hermes-error', message: 'Hermes did not give the Hindsight key.' };
    const bank = renderBankTemplate(fieldValue(fields, 'bank_id_template', mode), profile, fieldValue(fields, 'bank_id', mode) || 'hermes');
    if (!pinned && revealed.key) db.prepare('INSERT OR IGNORE INTO hindsight_key_urls (profile, api_url) VALUES (?, ?)').run(profile, apiUrl);
    return { state: 'ready', connection: { profile, mode, apiUrl, bank, key: revealed.key } };
  }

  /** One call to Hindsight. A failure is an answer, in words that quote nothing the owner did not send. */
  async function ask(connection: Connection, method: string, route: string, init: { body?: unknown; timeoutMs?: number } = {}): Promise<Upstream> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (connection.key) headers.authorization = `Bearer ${connection.key}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${connection.apiUrl}${route}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), redirect: 'manual', signal: AbortSignal.timeout(init.timeoutMs ?? READ_TIMEOUT_MS) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { ok: false, kind: 'unreachable', message: timedOut ? 'Hindsight did not answer in time.' : 'Hindsight did not answer. Check that it is running and that its address in Hermes’s settings is right.' };
    }
    const body = await jsonOf(res);
    if (res.ok) return { ok: true, body };
    if (res.status === 401 || res.status === 403) {
      // The key may have been changed in Hermes since it was read: the next call reads it again.
      keys.delete(connection.profile);
      return { ok: false, kind: 'rejected', message: connection.key ? 'Hindsight refused the key Hermes holds for it.' : 'Hindsight wants a key, and Hermes holds none for this profile.' };
    }
    if (res.status === 422 || res.status === 400) return { ok: false, kind: 'bad-request', message: 'Hindsight did not accept the request.' };
    return { ok: false, kind: 'upstream', message: `Hindsight answered HTTP ${res.status}.` };
  }

  const note = (c: Context<AuthEnv>, requester: { source: string }, action: string, target: string, profile: string) => audit.record({ actor: 'owner', action, target, source: requester.source, tier: 'T0', profile });

  const knownBanks = (profile: string): HindsightBankRow[] =>
    (db.prepare('SELECT bank_id, name, mission, facts, updated_at FROM hindsight_banks WHERE profile = ? ORDER BY bank_id').all(profile) as { bank_id: string; name: string | null; mission: string | null; facts: number; updated_at: string | null }[]).map((row) => ({
      id: row.bank_id,
      name: row.name,
      mission: row.mission,
      facts: row.facts,
      updatedAt: row.updated_at,
    }));

  const rememberBanks = (profile: string, banks: HindsightBankRow[]) => {
    db.exec('BEGIN');
    db.prepare('DELETE FROM hindsight_banks WHERE profile = ?').run(profile);
    const insert = db.prepare('INSERT INTO hindsight_banks (profile, bank_id, name, mission, facts, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const bank of banks) insert.run(profile, bank.id, bank.name, bank.mission, bank.facts, bank.updatedAt);
    db.exec('COMMIT');
  };

  /**
   * The shared run of a call about one bank: the policy has judged it, the profile's Hindsight is found, the call is recorded in the audit log (a T0 read
   * is not recorded by the policy) and Hindsight's answer becomes the page's: its data as it came, or a failure in words. A refusal of the key is a 502 and
   * not a 401, which the page would take for the end of its own session.
   */
  async function inBank(c: Context<AuthEnv>, action: string, tier: 'T0' | 'T1', run: (connection: Connection, bank: string, query: URLSearchParams, body: unknown) => string | (() => Promise<Upstream>)): Promise<Response> {
    const judged = await judgeOwned(c, policy);
    if (!judged.ok) return judged.response;
    const bank = c.req.param('bank') ?? '';
    if (!BANK_ID.test(bank) || bank === '.' || bank === '..') return c.json({ error: 'bad-request', message: 'That is not a bank name Hindsight would have.' }, 400);
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);
    const profile = judged.url.searchParams.get('profile') || 'default';
    const resolved = await resolve(profile);
    if (resolved.state === 'off') return c.json({ error: 'not-connected', message: 'Hindsight is not this profile’s memory provider.' }, 409);
    if (resolved.state === 'embedded') return c.json({ error: 'not-connected', message: 'Hindsight runs inside Hermes and cannot be reached from here.' }, 409);
    if (resolved.state === 'hermes-error') return c.json({ error: 'upstream', message: resolved.message }, 502);
    const call = run(resolved.connection, bank, judged.url.searchParams, judged.body);
    if (typeof call === 'string') return c.json({ error: 'bad-request', message: call }, 400);
    // The policy records a T1 itself; a read is recorded here, with the bank it was about, once it is known to go out.
    if (tier === 'T0') audit.record({ actor: 'owner', action: `hindsight.${action}`, target: bank, source: judged.requester.source, tier: 'T0', profile });
    const answer = await call();
    if (answer.ok) return c.json(answer.body ?? {});
    return c.json({ error: answer.kind, message: answer.message }, answer.kind === 'bad-request' ? 400 : 502);
  }

  const page = (query: URLSearchParams) => {
    const limit = Math.min(MAX_ROWS, Math.max(1, Number(query.get('limit')) || 50));
    const offset = Math.max(0, Number(query.get('offset')) || 0);
    return `limit=${limit}&offset=${Math.floor(offset)}`;
  };
  const bankPath = (bank: string) => `/v1/default/banks/${encodeURIComponent(bank)}`;

  app.get('/_caduceus/api/hindsight/banks/:bank/memories', (c) =>
    inBank(c, 'memories', 'T0', (connection, bank, query) => {
      const parts: string[] = [];
      const q = query.get('q')?.trim();
      if (q) parts.push(`q=${encodeURIComponent(q.slice(0, MAX_QUERY_CHARS))}`);
      const type = query.get('type');
      if (type && FACT_TYPES.includes(type)) parts.push(`type=${type}`);
      parts.push(page(query));
      return () => ask(connection, 'GET', `${bankPath(bank)}/memories/list?${parts.join('&')}`);
    }),
  );
  app.get('/_caduceus/api/hindsight/banks/:bank/directives', (c) => inBank(c, 'directives', 'T0', (connection, bank, query) => () => ask(connection, 'GET', `${bankPath(bank)}/directives?active_only=false&${page(query)}`)));
  app.get('/_caduceus/api/hindsight/banks/:bank/mental-models', (c) => inBank(c, 'mental-models', 'T0', (connection, bank, query) => () => ask(connection, 'GET', `${bankPath(bank)}/mental-models?detail=full&${page(query)}`)));

  /** The words a query, a budget and the fact types of a body give for Hindsight, or what is wrong with them. */
  const askOf = (body: unknown): { query: string; budget: string | undefined; types: string[] | undefined } | string => {
    if (!isRecord(body)) return 'Send the question as JSON.';
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (query === '' || query.length > MAX_QUERY_CHARS) return `Ask in 1 to ${MAX_QUERY_CHARS} characters.`;
    if (body.budget !== undefined && (typeof body.budget !== 'string' || !BUDGETS.includes(body.budget))) return 'The budget is low, mid or high.';
    const types = body.types;
    if (types !== undefined && (!Array.isArray(types) || types.some((type) => typeof type !== 'string' || !FACT_TYPES.includes(type)))) return 'The kinds of memory are world, experience and observation.';
    return { query, budget: body.budget as string | undefined, types: types as string[] | undefined };
  };

  app.post('/_caduceus/api/hindsight/banks/:bank/recall', (c) =>
    inBank(c, 'recall', 'T0', (connection, bank, _query, body) => {
      const asked = askOf(body);
      if (typeof asked === 'string') return asked;
      return () => ask(connection, 'POST', `${bankPath(bank)}/memories/recall`, { body: { query: asked.query, ...(asked.budget ? { budget: asked.budget } : {}), ...(asked.types && asked.types.length > 0 ? { types: asked.types } : {}), max_tokens: 2048 } });
    }),
  );
  app.post('/_caduceus/api/hindsight/banks/:bank/reflect', (c) =>
    inBank(c, 'reflect', 'T0', (connection, bank, _query, body) => {
      const asked = askOf(body);
      if (typeof asked === 'string') return asked;
      return () => ask(connection, 'POST', `${bankPath(bank)}/reflect`, { body: { query: asked.query, ...(asked.budget ? { budget: asked.budget } : {}) }, timeoutMs: REFLECT_TIMEOUT_MS });
    }),
  );

  app.post('/_caduceus/api/hindsight/banks/:bank/memories', (c) =>
    inBank(c, 'retain', 'T1', (connection, bank, _query, body) => {
      if (!isRecord(body)) return 'Send the memory as JSON.';
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (content === '' || content.length > MAX_CONTENT_CHARS) return `A memory is 1 to ${MAX_CONTENT_CHARS} characters.`;
      const tags = body.tags;
      if (tags !== undefined && (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => typeof tag !== 'string' || tag.trim() === '' || tag.length > 64))) return 'Tags are up to 20 short words.';
      const item = { content, context: 'Added by the owner in Caduceus', ...(Array.isArray(tags) && tags.length > 0 ? { tags: (tags as string[]).map((tag) => tag.trim()) } : {}), metadata: { source: 'caduceus' } };
      // Asynchronous, as Hermes's own provider retains: Hindsight takes the memory in and extracts facts from it in the background.
      return () => ask(connection, 'POST', `${bankPath(bank)}/memories`, { body: { items: [item], async: true } });
    }),
  );

  /**
   * The owner says the address Hermes's setting now names is right: the key is used with it from now on (a T3, the new address typed). The body names the
   * address the owner was shown; if Hermes's setting has moved again since, nothing changes.
   */
  app.post('/_caduceus/api/hindsight/key-address', async (c) => {
    const judged = await judgeOwned(c, policy);
    if (!judged.ok) return judged.response;
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);
    const profile = judged.url.searchParams.get('profile') || 'default';
    if (!isRecord(judged.body) || typeof judged.body.to !== 'string') return c.json({ error: 'bad-request', message: 'Say which address to use the key with.' }, 400);
    const resolved = await resolve(profile);
    if (resolved.state !== 'ready' || !resolved.connection.pinnedTo) return c.json({ error: 'nothing-to-change', message: 'The key is not held back for this profile.' }, 409);
    const { apiUrl, pinnedTo } = resolved.connection;
    if (apiUrl !== judged.body.to) return c.json({ error: 'address-moved', message: 'Hermes’s Hindsight address changed again. Look at the new one and decide again.' }, 409);
    db.prepare('UPDATE hindsight_key_urls SET api_url = ? WHERE profile = ?').run(apiUrl, profile);
    audit.record({ actor: 'owner', action: 'hindsight.key-address', target: `${pinnedTo} → ${apiUrl}`, source: judged.requester.source, tier: 'T3', profile });
    return c.json({ apiUrl });
  });

  app.get('/_caduceus/api/hindsight/status', async (c) => {
    const judged = await judgeOwned(c, policy);
    if (!judged.ok) return judged.response;
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);
    const profile = judged.url.searchParams.get('profile') || 'default';
    const resolved = await resolve(profile);
    if (resolved.state === 'off') {
      return c.json<HindsightStatus>({ state: 'off', message: 'Hindsight is not this profile’s memory provider. Choose it on the Provider tab, then come back here.', banks: [] });
    }
    if (resolved.state === 'embedded') {
      return c.json<HindsightStatus>({
        state: 'embedded',
        mode: resolved.mode,
        message: 'Hindsight runs inside Hermes on a port of its own that only Hermes knows, so it cannot be browsed here. Switch the provider to “local_external” and run Hindsight’s own server, or use Hindsight Cloud.',
        banks: [],
      });
    }
    if (resolved.state === 'hermes-error') return c.json<HindsightStatus>({ state: 'unreachable', message: resolved.message, banks: knownBanks(profile), stale: true });
    const { connection } = resolved;
    note(c, judged.requester, 'hindsight.status', `${connection.apiUrl}`, profile);
    const [listed, version] = await Promise.all([ask(connection, 'GET', `/v1/default/banks?limit=${BANK_LIMIT}`), ask(connection, 'GET', '/version')]);
    const base = { mode: connection.mode, apiUrl: connection.apiUrl, bank: connection.bank, ...(connection.pinnedTo ? { keyPinnedTo: connection.pinnedTo } : {}) };
    if (!listed.ok) {
      const stale = knownBanks(profile);
      return c.json<HindsightStatus>({ state: listed.kind === 'rejected' ? 'rejected' : 'unreachable', message: listed.message, ...base, banks: stale, ...(stale.length > 0 ? { stale: true } : {}) });
    }
    const banks = (isRecord(listed.body) && Array.isArray(listed.body.banks) ? listed.body.banks : []).flatMap((row): HindsightBankRow[] =>
      isRecord(row) && typeof row.bank_id === 'string'
        ? [{ id: row.bank_id, name: typeof row.name === 'string' ? row.name : null, mission: typeof row.mission === 'string' ? row.mission : null, facts: typeof row.fact_count === 'number' ? row.fact_count : 0, updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null }]
        : [],
    );
    rememberBanks(profile, banks);
    const apiVersion = version.ok && isRecord(version.body) ? text(version.body.api_version) : '';
    return c.json<HindsightStatus>({ state: 'connected', message: '', ...base, ...(apiVersion ? { version: apiVersion } : {}), banks });
  });
}
