// Agents › Tools & MCP › MCP servers: Hermes's MCP servers read as rows, the add and edit forms checked and turned into the requests
// Hermes takes. Pure: no DOM, no React, no fetch. Hermes is the source of truth (D1): a row is what Hermes lists now, and an edit starts
// from the server's own definition in the profile's config, so what the form does not show is sent back as it was.
import { isRecord } from '@caduceus/contracts/policy/guards';

export type McpTransport = 'stdio' | 'http' | 'sse';

/** A request to Hermes: the route's tier is the policy map's, not decided here. */
export interface McpRequest {
  method: 'POST' | 'PUT' | 'DELETE';
  /** The Hermes path with its query, exactly as it is sent. */
  path: string;
  body?: Record<string, unknown>;
}

const scoped = (route: string, profile: string) => `${route}?profile=${encodeURIComponent(profile)}`;
const serverRoute = (name: string, suffix = '') => `/api/mcp/servers/${encodeURIComponent(name)}${suffix}`;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** One configured server, as Hermes lists it. */
export interface McpServer {
  name: string;
  /** `sse` is a url server whose config says so; Hermes's list calls every url server `http`. */
  transport: McpTransport | 'unknown';
  url: string | undefined;
  command: string | undefined;
  args: string[];
  /** The names of the environment variables the server is given. Hermes masks the values and so does this page. */
  envNames: string[];
  auth: 'header' | 'oauth' | undefined;
  enabled: boolean;
  /** The tool filter in the config (which tools the agent may use), as Hermes keeps it; undefined means all tools. */
  filter: unknown;
}

/** The raw `mcp_servers` map of the profile's config: the definitions an edit starts from. */
export function serverDefinitions(config: unknown): Record<string, Record<string, unknown>> {
  const servers = isRecord(config) ? config.mcp_servers : undefined;
  if (!isRecord(servers)) return {};
  return Object.fromEntries(Object.entries(servers).flatMap(([name, definition]) => (isRecord(definition) ? [[name, definition]] : [])));
}

/** `GET /api/mcp/servers` (with the profile's config, for what the list does not say: the SSE transport). Servers come in name order, as Hermes sends them. */
export function parseServers(list: unknown, config: unknown): McpServer[] {
  const rows = isRecord(list) && Array.isArray(list.servers) ? list.servers : [];
  const definitions = serverDefinitions(config);
  return rows.flatMap((row): McpServer[] => {
    if (!isRecord(row) || typeof row.name !== 'string') return [];
    const url = text(row.url);
    const command = text(row.command);
    const transport: McpServer['transport'] = url ? (definitions[row.name]?.transport === 'sse' ? 'sse' : 'http') : command ? 'stdio' : 'unknown';
    return [
      {
        name: row.name,
        transport,
        url,
        command,
        args: strings(row.args),
        envNames: isRecord(row.env) ? Object.keys(row.env) : [],
        auth: row.auth === 'oauth' ? 'oauth' : row.auth === 'header' ? 'header' : undefined,
        enabled: row.enabled !== false,
        filter: row.tools ?? undefined,
      },
    ];
  });
}

/** What the owner types to add or edit a server. */
export interface ServerForm {
  transport: McpTransport;
  name: string;
  url: string;
  command: string;
  /** One argument per line, exactly as the program receives them. */
  args: string;
  env: { key: string; value: string }[];
  auth: 'none' | 'header' | 'oauth';
  /** The Bearer token of a header-authenticated HTTP server. Only ever sent to Hermes, which keeps it in the profile's .env. */
  bearerToken: string;
}

export const emptyForm = (transport: McpTransport): ServerForm => ({ transport, name: '', url: '', command: '', args: '', env: [], auth: 'none', bearerToken: '' });

/** The arguments of a form: one per line, a line of only spaces is nothing. */
export const argsOf = (args: string): string[] => args.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line.trim() !== '');

/** A command and its arguments as one line to read: an argument with a space or a quote is quoted. */
export function commandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map((part) => (/^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replaceAll("'", `'\\''`)}'`)).join(' ');
}

const envOf = (rows: ServerForm['env']): Record<string, string> => Object.fromEntries(rows.filter((row) => row.key.trim() !== '').map((row) => [row.key.trim(), row.value]));

/** `POST /api/mcp/servers`: Tier 2 for a url server, Tier 3 for a command. An SSE server is made by `serverEdit`'s kind of request (see `sseCreate`). */
export function serverCreate(form: ServerForm, profile: string): McpRequest {
  const name = form.name.trim();
  if (form.transport === 'stdio') {
    const args = argsOf(form.args);
    const env = envOf(form.env);
    return { method: 'POST', path: scoped('/api/mcp/servers', profile), body: { name, command: form.command.trim(), ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}) } };
  }
  return { method: 'POST', path: scoped('/api/mcp/servers', profile), body: { name, url: form.url.trim(), auth: form.auth, ...(form.auth === 'header' ? { bearer_token: form.bearerToken.trim() } : {}) } };
}

/** The problems of a form, by field: the first one of each. Hermes decides the rest (a command it finds suspicious, a name that was taken a moment ago) and says so. */
export type FormProblems = Partial<Record<'name' | 'url' | 'command' | 'env' | 'auth' | 'bearerToken', string>>;

const NAME = /^[\w.-]+$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface FormContext {
  /** The names already taken (when adding). */
  names?: readonly string[];
  /** When editing: the variables the server already has. Their values are never shown, so a blank value keeps the saved one. */
  keeps?: readonly string[];
}

export function formProblems(form: ServerForm, { names = [], keeps }: FormContext): FormProblems {
  const problems: FormProblems = {};
  const name = form.name.trim();
  if (keeps === undefined) {
    if (name === '') problems.name = 'Give the server a name.';
    else if (!NAME.test(name)) problems.name = 'Use letters, digits, dots, dashes and underscores only.';
    else if (names.includes(name)) problems.name = 'A server with this name is already there.';
  }
  if (form.transport === 'stdio') {
    if (form.command.trim() === '') problems.command = 'Give the program to run.';
    const seen = new Set<string>();
    for (const { key: raw, value } of form.env) {
      const key = raw.trim();
      if (key === '') continue;
      if (!VARIABLE.test(key)) problems.env ??= `${key} is not a variable name: use letters, digits and underscores, and do not start with a digit.`;
      else if (seen.has(key)) problems.env ??= `${key} is given twice.`;
      else if (value === '' && !keeps?.includes(key)) problems.env ??= `Give ${key} a value.`;
      seen.add(key);
    }
    return problems;
  }
  const url = form.url.trim();
  if (url === '') problems.url = 'Give the server’s web address.';
  else if (!/^https?:\/\/[^\s/]+/i.test(url)) problems.url = 'Use a full address that starts with http:// or https://.';
  if (form.transport === 'sse' && form.auth === 'header') problems.auth = 'An SSE server can use OAuth or no sign-in here. Hermes saves a Bearer token only for an HTTP server.';
  else if (form.auth === 'header' && form.bearerToken.trim() === '' && keeps === undefined) problems.bearerToken = 'Give the Bearer token.';
  return problems;
}

/** `PUT /api/mcp/servers`: Hermes's own way to make an SSE server (its add route has no transport), by saving the map with one more server. Tier 2. */
export function sseCreate(form: ServerForm, definitions: Readonly<Record<string, Record<string, unknown>>>, profile: string): McpRequest {
  return { method: 'PUT', path: scoped('/api/mcp/servers', profile), body: { servers: { ...definitions, [form.name.trim()]: { url: form.url.trim(), transport: 'sse', ...(form.auth === 'oauth' ? { auth: 'oauth' } : {}) } } } };
}

/** The edit form of a server: what Hermes lists, and the variable names of its definition. A variable's value is not in the form: blank means "keep the saved one". */
export function formOf(server: McpServer, definition: Readonly<Record<string, unknown>> | undefined): ServerForm {
  const names = isRecord(definition?.env) ? Object.keys(definition.env) : server.envNames;
  return {
    transport: server.transport === 'unknown' ? 'stdio' : server.transport,
    name: server.name,
    url: server.url ?? '',
    command: server.command ?? '',
    args: server.args.join('\n'),
    env: names.map((key) => ({ key, value: '' })),
    auth: server.auth ?? 'none',
    bearerToken: '',
  };
}

/** The fields of a server's definition the form owns. Everything else in it (timeouts, tool filters, headers, OAuth settings, sampling…) is sent back as Hermes had it. */
const FORM_KEYS = ['url', 'transport', 'command', 'args', 'env'] as const;

const isAuthorization = (header: string) => header.toLowerCase() === 'authorization';

/**
 * `PUT /api/mcp/servers` for an edit: Hermes replaces the whole map, so the request is every definition as it is, with the edited one
 * changed only in what the form owns (Tier 2 while no server in the map is stdio, otherwise Tier 3). A blank variable value keeps the
 * value the definition has. Choosing no sign-in or OAuth for a server that used a Bearer header removes that header and no other.
 */
export function serverEdit(form: ServerForm, name: string, definitions: Readonly<Record<string, Record<string, unknown>>>, profile: string): McpRequest {
  const original = definitions[name] ?? {};
  const next: Record<string, unknown> = { ...original };
  for (const key of FORM_KEYS) delete next[key];
  if (form.transport === 'stdio') {
    next.command = form.command.trim();
    const args = argsOf(form.args);
    if (args.length) next.args = args;
    const saved = isRecord(original.env) ? original.env : {};
    const env = Object.fromEntries(form.env.filter((row) => row.key.trim() !== '').map((row) => [row.key.trim(), row.value !== '' ? row.value : (saved[row.key.trim()] ?? '')]));
    if (Object.keys(env).length) next.env = env;
    delete next.auth;
  } else {
    next.url = form.url.trim();
    if (form.transport === 'sse') next.transport = 'sse';
    if (form.auth === 'oauth') next.auth = 'oauth';
    else delete next.auth;
    if (form.auth !== 'header' && isRecord(next.headers)) {
      const headers = Object.fromEntries(Object.entries(next.headers).filter(([header]) => !isAuthorization(header)));
      if (Object.keys(headers).length) next.headers = headers;
      else delete next.headers;
    }
  }
  return { method: 'PUT', path: scoped('/api/mcp/servers', profile), body: { servers: { ...definitions, [name]: next } } };
}

/** `PUT /api/mcp/servers/{name}/enabled` (Tier 0): only `enabled` changes; the server stays in the config either way. */
export const serverEnabled = (name: string, enabled: boolean, profile: string): McpRequest => ({ method: 'PUT', path: scoped(serverRoute(name, '/enabled'), profile), body: { enabled } });

/** `DELETE /api/mcp/servers/{name}` (Tier 1). */
export const serverRemove = (name: string, profile: string): McpRequest => ({ method: 'DELETE', path: scoped(serverRoute(name), profile) });

/** `POST /api/mcp/servers/{name}/test` (Tier 1, a read): Hermes connects, lists the tools and disconnects. */
export const serverTest = (name: string, profile: string): McpRequest => ({ method: 'POST', path: scoped(serverRoute(name, '/test'), profile) });

export interface McpTool {
  name: string;
  description: string;
}

/** What a test of a server found: the full inventory of its tools on success, the reason on failure. */
export interface Probe {
  ok: boolean;
  error: string | undefined;
  tools: McpTool[];
  prompts: number;
  resources: number;
}

export function parseProbe(body: unknown): Probe {
  const answer = isRecord(body) ? body : {};
  const tools = Array.isArray(answer.tools) ? answer.tools.flatMap((tool): McpTool[] => (isRecord(tool) && typeof tool.name === 'string' ? [{ name: tool.name, description: typeof tool.description === 'string' ? tool.description : '' }] : [])) : [];
  const count = (value: unknown) => (typeof value === 'number' ? value : 0);
  return { ok: answer.ok === true, error: text(answer.error), tools, prompts: count(answer.prompts), resources: count(answer.resources) };
}

/** What Hermes has of a server at runtime, without connecting to it: its state and the tools it has registered so far. */
export interface RuntimeState {
  state: 'connected' | 'connecting' | 'failed' | 'lazy' | 'configured' | 'disabled';
  tools: number;
}

const RUNTIME_STATES: readonly RuntimeState['state'][] = ['connected', 'connecting', 'failed', 'lazy', 'configured', 'disabled'];

/** The gateway's `mcp.servers.status`, by server name. */
export function parseRuntime(result: unknown): Map<string, RuntimeState> {
  const rows = isRecord(result) && Array.isArray(result.servers) ? result.servers : [];
  return new Map(
    rows.flatMap((row): [string, RuntimeState][] => {
      if (!isRecord(row) || typeof row.name !== 'string') return [];
      const state = RUNTIME_STATES.find((candidate) => candidate === row.status) ?? 'configured';
      return [[row.name, { state, tools: typeof row.tools === 'number' ? row.tools : 0 }]];
    }),
  );
}

/** `POST /api/mcp/servers/{name}/auth` (Tier 1): starts Hermes's MCP sign-in. The answer is the flow. */
export const serverAuth = (name: string, profile: string): McpRequest => ({ method: 'POST', path: scoped(serverRoute(name, '/auth'), profile) });

export type OauthStatus = 'starting' | 'authorization_required' | 'approved' | 'error';

export interface OauthFlow {
  id: string;
  status: OauthStatus;
  /** Where the owner signs in: only ever opened as a web address. */
  url: string | undefined;
  /** Why the flow failed, in Hermes's words. */
  error: string | undefined;
}

export function parseOauthFlow(body: unknown): OauthFlow {
  const flow = isRecord(body) ? body : {};
  const status: OauthStatus = flow.status === 'authorization_required' || flow.status === 'approved' || flow.status === 'error' ? flow.status : 'starting';
  return { id: typeof flow.flow_id === 'string' ? flow.flow_id : '', status, url: text(flow.authorization_url), error: text(flow.error) };
}

/** `GET /api/mcp/oauth/flows/{id}`: a read, so a path. */
export const oauthFlowStatus = (id: string): { path: string } => ({ path: `/api/mcp/oauth/flows/${encodeURIComponent(id)}` });

/** `DELETE /api/mcp/oauth/flows/{id}` (Tier 0): ends a flow, which frees the server for another try. */
export const oauthCancel = (id: string): McpRequest => ({ method: 'DELETE', path: oauthFlowStatus(id).path });

/**
 * The request that hands the provider's redirect to Hermes. The redirect points at Hermes's own address on the computer it runs on, so
 * a browser on another device cannot follow it: the owner pastes the address it ended up on, and only the parameters Hermes's callback
 * reads are carried on (`GET /api/mcp/oauth/callback/{server}`, Tier 1), through Caduceus.
 */
export function oauthCallbackPath(pasted: string, server: string): { path: string } | { problem: string } {
  let address: URL;
  try {
    address = new URL(pasted.trim());
  } catch {
    return { problem: 'That is not a web address.' };
  }
  const marker = '/api/mcp/oauth/callback/';
  const at = address.pathname.indexOf(marker);
  if (at < 0) return { problem: `That is not the address Hermes’s sign-in sent the browser to: it should contain ${marker}${server}.` };
  if (decodeURIComponent(address.pathname.slice(at + marker.length)) !== server) return { problem: `That address is the sign-in of another server, not ${server}.` };
  const carried = new URLSearchParams();
  for (const key of ['code', 'state', 'error', 'iss']) {
    const value = address.searchParams.get(key);
    if (value !== null) carried.set(key, value);
  }
  if (!carried.has('code') && !carried.has('error')) return { problem: 'That address has no code in it. Copy it after the provider’s page redirects.' };
  return { path: `/api/mcp/oauth/callback/${encodeURIComponent(server)}?${carried}` };
}

/** One entry of Hermes's curated MCP catalogue. */
export interface CatalogEntry {
  name: string;
  description: string;
  /** Where the entry's maker documents it. */
  source: string | undefined;
  transport: McpTransport | 'unknown';
  authType: string;
  /** The values the entry asks the owner for: Hermes sends names and prompts, never values. */
  requiredEnv: { name: string; prompt: string; required: boolean }[];
  command: string | undefined;
  args: string[];
  url: string | undefined;
  /** Entries that clone and build run as a background action with a log. */
  needsInstall: boolean;
  installUrl: string | undefined;
  bootstrap: string[];
  /** What Hermes tells the owner to do after installing. */
  postInstall: string | undefined;
  installed: boolean;
  enabled: boolean;
}

export interface Catalog {
  entries: CatalogEntry[];
  /** Problems Hermes found in the catalogue's own manifests. */
  diagnostics: { name: string; message: string }[];
}

export function parseCatalog(body: unknown): Catalog {
  const answer = isRecord(body) ? body : {};
  const entries = (Array.isArray(answer.entries) ? answer.entries : []).flatMap((row): CatalogEntry[] => {
    if (!isRecord(row) || typeof row.name !== 'string') return [];
    const transport = row.transport === 'stdio' || row.transport === 'http' || row.transport === 'sse' ? row.transport : 'unknown';
    const requiredEnv = (Array.isArray(row.required_env) ? row.required_env : []).flatMap((spec) => (isRecord(spec) && typeof spec.name === 'string' ? [{ name: spec.name, prompt: text(spec.prompt) ?? spec.name, required: spec.required !== false }] : []));
    return [
      {
        name: row.name,
        description: typeof row.description === 'string' ? row.description : '',
        source: text(row.source),
        transport,
        authType: typeof row.auth_type === 'string' ? row.auth_type : 'none',
        requiredEnv,
        command: text(row.command),
        args: strings(row.args),
        url: text(row.url),
        needsInstall: row.needs_install === true,
        installUrl: text(row.install_url),
        bootstrap: strings(row.bootstrap),
        postInstall: text(row.post_install)?.trim(),
        installed: row.installed === true,
        enabled: row.enabled === true,
      },
    ];
  });
  const diagnostics = (Array.isArray(answer.diagnostics) ? answer.diagnostics : []).flatMap((row) => (isRecord(row) && typeof row.message === 'string' ? [{ name: typeof row.name === 'string' ? row.name : '', message: row.message }] : []));
  return { entries, diagnostics };
}

export type CatalogFilter = 'all' | 'installed' | 'available';

/** The entries that match the search (every word, in the name or description) and the filter. */
export function filterCatalog(entries: readonly CatalogEntry[], { query, show }: { query: string; show: CatalogFilter }): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (show === 'installed' && !entry.installed) return false;
    if (show === 'available' && entry.installed) return false;
    const haystack = `${entry.name} ${entry.description} ${entry.transport}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** The values still missing for an entry, by variable: each one it requires needs something typed. */
export function installProblems(entry: CatalogEntry, values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(entry.requiredEnv.filter((spec) => spec.required && (values[spec.name] ?? '').trim() === '').map((spec) => [spec.name, `Give ${spec.name}.`]));
}

/** `POST /api/mcp/catalog/install` (Tier 3): only the variables the entry declares and that were typed are sent, trimmed. Hermes keeps secrets in the profile's .env and the rest in the server's config. */
export function catalogInstall(entry: CatalogEntry, values: Readonly<Record<string, string>>, profile: string): McpRequest {
  const env = Object.fromEntries(entry.requiredEnv.flatMap((spec) => ((values[spec.name] ?? '').trim() === '' ? [] : [[spec.name, values[spec.name].trim()]])));
  return { method: 'POST', path: scoped('/api/mcp/catalog/install', profile), body: { name: entry.name, env, enable: true } };
}

/** How a server shows in the list: a state of the status ladder and its words. Off wins over what Hermes last had, and with no runtime answer the row says only what the config says. */
export function statusOf(server: McpServer, runtime: RuntimeState | undefined): { state: 'paused' | 'online' | 'reconnecting' | 'failed' | 'queued'; label: string; detail: string | undefined } {
  if (!server.enabled) return { state: 'paused', label: 'Off', detail: 'Switched off: new sessions do not load it.' };
  switch (runtime?.state) {
    case 'connected':
      return { state: 'online', label: 'Connected', detail: `${runtime.tools} ${runtime.tools === 1 ? 'tool' : 'tools'} loaded in Hermes` };
    case 'connecting':
      return { state: 'reconnecting', label: 'Connecting', detail: undefined };
    case 'failed':
      return { state: 'failed', label: 'Failed to connect', detail: 'Test it to see why.' };
    case 'lazy':
      return { state: 'queued', label: 'Starts on demand', detail: undefined };
    default:
      return { state: 'queued', label: 'Not started', detail: 'Hermes starts it with a session. Test it to see its tools.' };
  }
}

/** The tools a server's filter allows, as words: `undefined` means all of them. */
export function filterWords(filter: unknown): string | undefined {
  if (!isRecord(filter)) return undefined;
  const include = strings(filter.include);
  const exclude = strings(filter.exclude);
  if (include.length) return `Only ${include.join(', ')}`;
  if (exclude.length) return `All except ${exclude.join(', ')}`;
  return undefined;
}
