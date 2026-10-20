// Which tools of a notes source Caduceus may call, and what it makes of their answers (R11, M4 #10). Pure: no network, no process.
//
// The allow-list is by what a tool is called and says about itself, because an MCP server tells nothing more: a tool is a **search** tool when its name has a word
// like `search` or `find`, and a **read** tool when it has a word like `get` or `read`, and it is neither when its name has any word of a change (`create`, `delete`,
// `update`, `run`, `send`…) or its annotations say it is destructive or not read-only. A server's own claim that a tool only reads (`readOnlyHint`) never allows a tool
// by itself: it can lie, and the name still has to be a reading one. Anything else is refused, whatever the page asks for.
import type { NoteHit } from '@caduceus/contracts/hindsight-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { McpTool, McpToolResult } from './notes-mcp.ts';

export type ToolRole = 'search' | 'read';

const SEARCH_WORDS = ['search', 'find', 'query', 'lookup'];
const READ_WORDS = ['get', 'read', 'fetch', 'open', 'view', 'retrieve', 'show', 'load'];
const CHANGE_WORDS = [
  'create', 'add', 'new', 'update', 'edit', 'write', 'append', 'prepend', 'delete', 'remove', 'rm', 'move', 'rename', 'set', 'run', 'exec', 'execute', 'eval', 'send', 'post', 'put',
  'patch', 'save', 'insert', 'upload', 'import', 'publish', 'commit', 'push', 'clear', 'reset', 'drop', 'kill', 'start', 'stop', 'install', 'trash', 'archive', 'pin', 'tag', 'share', 'replace', 'change', 'modify', 'swap', 'overwrite', 'sync', 'toggle', 'enable', 'disable', 'apply', 'merge', 'copy', 'duplicate',
  'restore', 'revert', 'undo', 'mark', 'complete', 'close',
];

/** A tool name as lower-case words: `searchNotes`, `search_notes` and `search-notes` are `search`, `notes`. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** What a tool may be used for: `undefined` for a tool Caduceus never calls. */
export function toolRole(tool: Pick<McpTool, 'name' | 'annotations'>): ToolRole | undefined {
  const words = wordsOf(tool.name);
  if (words.some((word) => CHANGE_WORDS.includes(word))) return undefined;
  if (tool.annotations.destructiveHint === true || tool.annotations.readOnlyHint === false) return undefined;
  if (words.some((word) => SEARCH_WORDS.includes(word))) return 'search';
  if (words.some((word) => READ_WORDS.includes(word))) return 'read';
  return undefined;
}

/** The tool that does a role, among a server's tools: the first whose name says `note` is preferred, then the first. */
export function pickTool(tools: McpTool[], role: ToolRole): McpTool | undefined {
  const candidates = tools.filter((tool) => toolRole(tool) === role);
  return candidates.find((tool) => wordsOf(tool.name).some((word) => word.startsWith('note'))) ?? candidates[0];
}

/** The tools a notes page may name, by role. */
export function notesTools(tools: McpTool[]): { search: string | undefined; read: string | undefined } {
  return { search: pickTool(tools, 'search')?.name, read: pickTool(tools, 'read')?.name };
}

const QUERY_ARGUMENTS = ['query', 'q', 'search', 'text', 'keyword', 'keywords', 'term', 'terms', 'pattern', 'input'];
const REFERENCE_ARGUMENTS = ['id', 'note_id', 'noteId', 'path', 'file', 'filename', 'uri', 'url', 'name', 'title', 'ref', 'identifier'];
const LIMIT_ARGUMENTS = ['limit', 'max_results', 'maxResults', 'top_k', 'topK', 'count'];
/** How many hits a search asks for. */
export const SEARCH_LIMIT = 10;

/** The name of the string argument of a tool among `preferred`, else its first required string argument, else its first string argument. */
function stringArgument(tool: McpTool, preferred: string[]): string | undefined {
  const properties = tool.inputSchema.properties ?? {};
  const isString = (name: string) => properties[name]?.type === 'string' || properties[name]?.type === undefined;
  return preferred.find((name) => name in properties && isString(name)) ?? (tool.inputSchema.required ?? []).find((name) => properties[name]?.type === 'string') ?? Object.keys(properties).find((name) => properties[name]?.type === 'string');
}

/** The arguments of a search tool's call for a query, from its input schema; `undefined` when it takes no text. */
export function searchArguments(tool: McpTool, query: string): Record<string, unknown> | undefined {
  const name = stringArgument(tool, QUERY_ARGUMENTS);
  if (name === undefined) return undefined;
  const limit = LIMIT_ARGUMENTS.find((candidate) => tool.inputSchema.properties?.[candidate]?.type === 'number' || tool.inputSchema.properties?.[candidate]?.type === 'integer');
  return { [name]: query, ...(limit ? { [limit]: SEARCH_LIMIT } : {}) };
}

/** The arguments of a read tool's call for a note's reference. */
export function readArguments(tool: McpTool, ref: string): Record<string, unknown> | undefined {
  const name = stringArgument(tool, REFERENCE_ARGUMENTS);
  return name === undefined ? undefined : { [name]: ref };
}

const REFERENCE_FIELDS = ['id', 'path', 'uri', 'url', 'name', 'title', 'file', 'filename'];
const TITLE_FIELDS = ['title', 'name', 'path', 'file', 'filename', 'id'];
const SNIPPET_FIELDS = ['snippet', 'excerpt', 'content', 'text', 'summary', 'description', 'body', 'preview'];
/** A snippet is a few lines; the page shows it in a list. */
export const SNIPPET_CHARS = 300;
const MAX_HITS = 50;

const firstText = (record: Record<string, unknown>, fields: string[]): string => {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
};

/** The first array of objects in a value (the value itself, or one of its fields), which is where a search tool puts its results. */
function rowsIn(value: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(value)) return value.every(isRecord) && value.length > 0 ? (value as Record<string, unknown>[]) : value.length === 0 ? [] : undefined;
  if (!isRecord(value)) return undefined;
  for (const field of ['results', 'notes', 'items', 'matches', 'hits', 'documents', 'files']) {
    const found = rowsIn(value[field]);
    if (found) return found;
  }
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      const found = rowsIn(nested);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * The hits of a search tool's answer: its structured content when it has any, else its text read as JSON. A hit with no reference to open it by is left out. An answer that
 * is neither (plain prose) has no hits, and the caller shows its text.
 */
export function hitsOf(result: McpToolResult): NoteHit[] | undefined {
  let rows = rowsIn(result.structured);
  if (!rows) {
    try {
      rows = rowsIn(JSON.parse(result.text));
    } catch {
      rows = undefined;
    }
  }
  if (!rows) return undefined;
  return rows.slice(0, MAX_HITS).flatMap((row): NoteHit[] => {
    const ref = firstText(row, REFERENCE_FIELDS);
    if (ref === '') return [];
    return [{ ref, title: firstText(row, TITLE_FIELDS) || ref, snippet: firstText(row, SNIPPET_FIELDS).replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS) }];
  });
}
