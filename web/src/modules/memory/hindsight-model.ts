// Agents › Memory › Hindsight and Notes (M4 #10): what the Caduceus server answers, read as rows, and the requests the screens send. Pure: no DOM, no React, no fetch.
// Hindsight's own answers (memories, directives, mental models, recall, reflect) are read here by the field names of its OpenAPI document; the status and the notes
// answers are the shapes of `contracts/hindsight-api.ts`. Nothing here holds a credential: the server never sends one.
import type { HindsightBankRow, HindsightState, HindsightStatus, NoteHit, NotePreview, NotesSearchAnswer, NotesSourceRow } from '@caduceus/contracts/hindsight-api';
import { isRecord } from '@caduceus/contracts/policy/guards';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const scoped = (route: string, profile: string, extra = '') => `${route}?${extra}profile=${encodeURIComponent(profile)}`;

/** A request the screens send through `fetchTiered`: the route's tier is the policy map's. */
export interface BrowseRequest {
  method: 'POST' | 'PUT';
  path: string;
  body?: Record<string, unknown>;
}

const STATES: readonly HindsightState[] = ['off', 'embedded', 'unreachable', 'rejected', 'connected'];

/** `GET /_caduceus/api/hindsight/status`. */
export function parseStatus(body: unknown): HindsightStatus {
  const record = isRecord(body) ? body : {};
  const state = STATES.find((candidate) => candidate === record.state) ?? 'unreachable';
  const banks = (Array.isArray(record.banks) ? record.banks : []).flatMap((row): HindsightBankRow[] =>
    isRecord(row) && typeof row.id === 'string' ? [{ id: row.id, name: typeof row.name === 'string' ? row.name : null, mission: typeof row.mission === 'string' ? row.mission : null, facts: typeof row.facts === 'number' ? row.facts : 0, updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null }] : [],
  );
  return {
    state,
    message: text(record.message) || (state === 'unreachable' && !isRecord(body) ? 'Caduceus did not answer.' : ''),
    banks,
    ...(typeof record.mode === 'string' ? { mode: record.mode } : {}),
    ...(typeof record.apiUrl === 'string' ? { apiUrl: record.apiUrl } : {}),
    ...(typeof record.keyPinnedTo === 'string' ? { keyPinnedTo: record.keyPinnedTo } : {}),
    ...(typeof record.bank === 'string' ? { bank: record.bank } : {}),
    ...(typeof record.version === 'string' ? { version: record.version } : {}),
    ...(record.stale === true ? { stale: true } : {}),
  };
}

export const statusPath = (profile: string) => scoped('/_caduceus/api/hindsight/status', profile);

/** The bank the screen starts on: the one Hermes writes to when Hindsight lists it, else the first bank, else the one Hermes names. */
export function startBank(status: HindsightStatus): string | undefined {
  if (status.bank !== undefined && status.banks.some((bank) => bank.id === status.bank)) return status.bank;
  return status.banks[0]?.id ?? status.bank;
}

/** How a bank is named in a list: its name when it has one, with the id. */
export const bankLabel = (bank: HindsightBankRow): string => (bank.name && bank.name !== bank.id ? `${bank.name} (${bank.id})` : bank.id);

const bankRoute = (bank: string) => `/_caduceus/api/hindsight/banks/${encodeURIComponent(bank)}`;
export const MEMORY_KINDS = ['world', 'experience', 'observation'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
/** What each kind of memory means, in the words the screen shows. */
export const KIND_WORDS: Record<MemoryKind, string> = { world: 'Fact', experience: 'Experience', observation: 'Observation' };
export const PAGE_SIZE = 25;

export interface MemoryRow {
  id: string;
  text: string;
  kind: string;
  context: string;
  date: string;
  tags: string[];
}

export interface Page<Row> {
  rows: Row[];
  total: number;
}

function page<Row>(body: unknown, row: (raw: Record<string, unknown>) => Row | undefined): Page<Row> {
  const record = isRecord(body) ? body : {};
  const rows = (Array.isArray(record.items) ? record.items : []).flatMap((raw) => {
    const parsed = isRecord(raw) ? row(raw) : undefined;
    return parsed ? [parsed] : [];
  });
  return { rows, total: typeof record.total === 'number' ? record.total : rows.length };
}

/** `GET …/memories`: Hindsight's memory units. */
export const parseMemories = (body: unknown): Page<MemoryRow> =>
  page(body, (raw) => (typeof raw.id === 'string' && typeof raw.text === 'string' ? { id: raw.id, text: raw.text, kind: text(raw.fact_type), context: text(raw.context), date: text(raw.mentioned_at) || text(raw.date), tags: strings(raw.tags) } : undefined));

export interface MemoriesQuery {
  q: string;
  kind: MemoryKind | '';
  offset: number;
}

export const memoriesPath = (bank: string, profile: string, { q, kind, offset }: MemoriesQuery) =>
  scoped(`${bankRoute(bank)}/memories`, profile, `${q.trim() ? `q=${encodeURIComponent(q.trim())}&` : ''}${kind ? `type=${kind}&` : ''}limit=${PAGE_SIZE}&offset=${offset}&`);

export interface DirectiveRow {
  id: string;
  name: string;
  content: string;
  priority: number;
  active: boolean;
  tags: string[];
}

/** `GET …/directives`: the rules Hindsight always applies when it reflects. */
export const parseDirectives = (body: unknown): Page<DirectiveRow> =>
  page(body, (raw) =>
    typeof raw.id === 'string' && typeof raw.name === 'string' ? { id: raw.id, name: raw.name, content: text(raw.content), priority: typeof raw.priority === 'number' ? raw.priority : 0, active: raw.is_active !== false, tags: strings(raw.tags) } : undefined,
  );

export const directivesPath = (bank: string, profile: string) => scoped(`${bankRoute(bank)}/directives`, profile, `limit=${PAGE_SIZE * 2}&`);

export interface MentalModelRow {
  id: string;
  name: string;
  content: string;
  sourceQuery: string;
  tags: string[];
  refreshedAt: string;
  stale: boolean;
}

/** `GET …/mental-models`: the summaries Hindsight keeps up to date about a topic. */
export const parseMentalModels = (body: unknown): Page<MentalModelRow> =>
  page(body, (raw) =>
    typeof raw.id === 'string' && typeof raw.name === 'string'
      ? { id: raw.id, name: raw.name, content: text(raw.content), sourceQuery: text(raw.source_query), tags: strings(raw.tags), refreshedAt: text(raw.last_refreshed_at), stale: raw.is_stale === true }
      : undefined,
  );

export const mentalModelsPath = (bank: string, profile: string) => scoped(`${bankRoute(bank)}/mental-models`, profile, `limit=${PAGE_SIZE * 2}&`);

export const BUDGETS = ['low', 'mid', 'high'] as const;
export type Budget = (typeof BUDGETS)[number];

/** What the owner typed to ask Hindsight: a question and how hard it should look. */
export interface Question {
  query: string;
  budget: Budget;
}

/** The problem with a question, in words; `undefined` when it can be asked. */
export const questionProblem = (query: string): string | undefined => (query.trim() === '' ? 'Type a question first.' : query.trim().length > 2000 ? 'A question is at most 2000 characters.' : undefined);

export function recallRequest(bank: string, profile: string, { query, budget }: Question): BrowseRequest {
  return { method: 'POST', path: scoped(`${bankRoute(bank)}/recall`, profile), body: { query: query.trim(), budget } };
}

export function reflectRequest(bank: string, profile: string, { query, budget }: Question): BrowseRequest {
  return { method: 'POST', path: scoped(`${bankRoute(bank)}/reflect`, profile), body: { query: query.trim(), budget } };
}

export interface RecallHit {
  id: string;
  text: string;
  kind: string;
  context: string;
  score: number | undefined;
  date: string;
}

/** `POST …/recall`: the memories Hindsight found, best first. */
export function parseRecall(body: unknown): RecallHit[] {
  const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];
  return results.flatMap((raw): RecallHit[] => {
    if (!isRecord(raw) || typeof raw.text !== 'string') return [];
    const scores = isRecord(raw.scores) ? raw.scores : {};
    return [{ id: text(raw.id), text: raw.text, kind: text(raw.type), context: text(raw.context), score: typeof scores.final === 'number' ? scores.final : undefined, date: text(raw.mentioned_at) }];
  });
}

export interface Reflection {
  /** Hindsight's answer. */
  answer: string;
  /** What it says it was based on. */
  memories: { id: string; text: string }[];
  directives: { id: string; name: string }[];
  models: { id: string; text: string }[];
}

/** `POST …/reflect`: an answer Hindsight wrote from the bank, with what it used. */
export function parseReflect(body: unknown): Reflection {
  const record = isRecord(body) ? body : {};
  const basedOn = isRecord(record.based_on) ? record.based_on : {};
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
  return {
    answer: text(record.text),
    memories: list(basedOn.memories).flatMap((raw) => (typeof raw.text === 'string' ? [{ id: text(raw.id), text: raw.text }] : [])),
    directives: list(basedOn.directives).flatMap((raw) => (typeof raw.name === 'string' ? [{ id: text(raw.id), name: raw.name }] : [])),
    models: list(basedOn.mental_models).flatMap((raw) => (typeof raw.text === 'string' ? [{ id: text(raw.id), text: raw.text }] : [])),
  };
}

/** Tags typed as words separated by commas or spaces: trimmed, without repeats. */
export const parseTags = (typed: string): string[] => [...new Set(typed.split(/[,\s]+/).filter(Boolean))];

/** The problem with a memory to add, in words. */
export function memoryProblem(content: string, tags: readonly string[]): string | undefined {
  if (content.trim() === '') return 'Write what Hindsight should remember.';
  if (content.trim().length > 20_000) return 'A memory is at most 20,000 characters.';
  if (tags.length > 20 || tags.some((tag) => tag.length > 64)) return 'Use up to 20 tags of up to 64 characters.';
  return undefined;
}

/** Adds a memory to a bank (T1). Hindsight extracts facts from it in the background, so it may take a moment to show in the list. */
export function retainRequest(bank: string, profile: string, content: string, tags: readonly string[]): BrowseRequest {
  return { method: 'POST', path: scoped(`${bankRoute(bank)}/memories`, profile), body: { content: content.trim(), ...(tags.length > 0 ? { tags } : {}) } };
}

/** The words of a failure answer of the Caduceus server: its `message`, else a plain sentence for the status. */
export function failureMessage(body: unknown, status: number): string {
  if (isRecord(body) && typeof body.message === 'string' && body.message !== '') return body.message;
  if (isRecord(body) && typeof body.detail === 'string') return body.detail;
  return `Caduceus answered HTTP ${status}.`;
}

// ---- External notes ----

export const sourcesPath = (profile: string) => scoped('/_caduceus/api/notes/sources', profile);

/** `GET /_caduceus/api/notes/sources`. */
export function parseSources(body: unknown): NotesSourceRow[] {
  const sources = isRecord(body) && Array.isArray(body.sources) ? body.sources : [];
  return sources.flatMap((raw): NotesSourceRow[] => {
    if (!isRecord(raw) || typeof raw.name !== 'string') return [];
    const transport = raw.transport === 'stdio' || raw.transport === 'http' ? raw.transport : 'unsupported';
    return [{ name: raw.name, transport, source: raw.source === true, disabled: raw.disabled === true, approved: raw.approved === true, ...(typeof raw.command === 'string' ? { command: raw.command } : {}), ...(typeof raw.note === 'string' ? { note: raw.note } : {}) }];
  });
}

/** What the owner can do with a server as a notes source, in a word: why it cannot be used, or that it can. */
export type SourceReadiness = 'unsupported' | 'disabled' | 'not-source' | 'needs-approval' | 'ready';

export function readiness(row: NotesSourceRow): SourceReadiness {
  if (row.transport === 'unsupported') return 'unsupported';
  if (row.disabled) return 'disabled';
  if (!row.source) return 'not-source';
  return row.approved ? 'ready' : 'needs-approval';
}

/** Marks a server as a notes source, or not (T0: Caduceus's own preference). */
export const markRequest = (server: string, profile: string, source: boolean): BrowseRequest => ({ method: 'PUT', path: scoped(`/_caduceus/api/notes/sources/${encodeURIComponent(server)}`, profile), body: { source } });

/** Approves running a stdio server's command (T3: the server's name typed). */
export const approveRequest = (server: string, profile: string): BrowseRequest => ({ method: 'POST', path: scoped(`/_caduceus/api/notes/sources/${encodeURIComponent(server)}/approve`, profile) });

export const searchNotesRequest = (server: string, profile: string, query: string): BrowseRequest => ({ method: 'POST', path: scoped('/_caduceus/api/notes/search', profile), body: { server, query: query.trim() } });
export const previewNoteRequest = (server: string, profile: string, ref: string): BrowseRequest => ({ method: 'POST', path: scoped('/_caduceus/api/notes/preview', profile), body: { server, ref } });

/** `POST /_caduceus/api/notes/search`. */
export function parseSearch(body: unknown): NotesSearchAnswer {
  const record = isRecord(body) ? body : {};
  const hits = (Array.isArray(record.hits) ? record.hits : []).flatMap((raw): NoteHit[] => (isRecord(raw) && typeof raw.ref === 'string' ? [{ ref: raw.ref, title: text(raw.title) || raw.ref, snippet: text(raw.snippet) }] : []));
  return { tool: text(record.tool), hits, ...(typeof record.text === 'string' ? { text: record.text } : {}) };
}

/** `POST /_caduceus/api/notes/preview`. */
export function parsePreview(body: unknown): NotePreview {
  const record = isRecord(body) ? body : {};
  return { tool: text(record.tool), title: text(record.title), text: text(record.text), truncated: record.truncated === true };
}
