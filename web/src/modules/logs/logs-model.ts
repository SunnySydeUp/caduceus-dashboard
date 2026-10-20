// Observe › Logs (M5 #06): the pure half of the screen. The view is Hermes's own log query (`GET /api/logs?file=&level=&component=&search=&lines=`),
// so what the address holds is what Hermes is asked. Reading the log, and every filter, are Hermes's; nothing here filters a line.

import { DEFAULT_LINES } from './logs-query.ts';

/** The log files Hermes serves (`LOG_FILES` in its `hermes_cli/logs.py`), as the page names them, and each one's name on disk (what Truncate file asks to be typed). */
export const LOG_FILE_CHOICES = [
  { value: 'agent', disk: 'agent.log', label: 'Agent', note: 'what the agent did: model calls, tools, sessions' },
  { value: 'errors', disk: 'errors.log', label: 'Errors', note: 'warnings and errors from everything' },
  { value: 'gateway', disk: 'gateway.log', label: 'Gateway', note: 'the messaging gateway and its platforms' },
  { value: 'gui', disk: 'gui.log', label: 'Dashboard', note: 'Hermes’s own web server' },
  { value: 'desktop', disk: 'desktop.log', label: 'Desktop', note: 'the Hermes desktop app' },
  { value: 'mcp', disk: 'mcp-stderr.log', label: 'MCP', note: 'the output of every MCP server' },
] as const;

/** Hermes's levels, quietest first. A level is a floor: `WARNING` shows warnings, errors and critical lines. */
export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;

/** The components Hermes can filter by (`COMPONENT_PREFIXES` in its `hermes_logging.py`): groups of logger names. */
export const LOG_COMPONENTS = ['gateway', 'agent', 'tools', 'cli', 'cron', 'gui'] as const;

export type LogFileName = (typeof LOG_FILE_CHOICES)[number]['value'];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogComponent = (typeof LOG_COMPONENTS)[number];

export const LINE_CHOICES = [100, 200, 500] as const;
const MAX_LINES = 500;

export interface LogsView {
  file: LogFileName;
  level?: LogLevel;
  component?: LogComponent;
  /** Hermes's `search`: a case-insensitive substring of the line. */
  search: string;
  /** How many of the last lines Hermes is asked for. */
  lines: number;
}

const fileOf = (value: unknown): LogFileName | undefined => LOG_FILE_CHOICES.find((choice) => choice.value === value)?.value;
const levelOf = (value: unknown): LogLevel | undefined => (typeof value === 'string' ? LOG_LEVELS.find((level) => level === value.toUpperCase()) : undefined);
const componentOf = (value: unknown): LogComponent | undefined => (typeof value === 'string' ? LOG_COMPONENTS.find((component) => component === value.toLowerCase()) : undefined);

/** Reads the view from the address's query; anything Hermes does not know is as if it were not there. */
export function readLogsView(search: Record<string, unknown>): LogsView {
  const level = levelOf(search.level);
  const component = componentOf(search.component);
  const lines = typeof search.lines === 'string' && /^\d+$/.test(search.lines) ? Number(search.lines) : DEFAULT_LINES;
  return {
    file: fileOf(search.file) ?? 'agent',
    ...(level ? { level } : {}),
    ...(component ? { component } : {}),
    search: typeof search.q === 'string' ? search.q.trim() : '',
    lines: lines >= 1 && lines <= MAX_LINES ? lines : DEFAULT_LINES,
  };
}

/** The live tail's address: the view as Hermes's own parameters, and the profile the tab is scoped to (Hermes's `profile`). */
export function streamPath(view: LogsView, profile: string | undefined): string {
  const params = new URLSearchParams({ file: view.file, lines: String(view.lines) });
  if (view.level) params.set('level', view.level);
  if (view.component) params.set('component', view.component);
  if (view.search.trim() !== '') params.set('search', view.search.trim());
  if (profile) params.set('profile', profile);
  return `/_caduceus/api/logs/stream?${params}`;
}

export interface LogsQuery {
  file?: LogFileName;
  level?: LogLevel;
  component?: LogComponent;
  search: string;
}

/**
 * The search box as a structured query: `level:error component:gateway file:errors` words are filters, and the rest is the search.
 * A filter word that names nothing Hermes has stays in the search, so nothing the owner typed is lost; of a filter given twice, the last counts.
 */
export function parseQuery(text: string): LogsQuery {
  const query: LogsQuery = { search: '' };
  const rest: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const colon = word.indexOf(':');
    const name = colon < 0 ? '' : word.slice(0, colon).toLowerCase();
    const value = colon < 0 ? '' : word.slice(colon + 1);
    const file = name === 'file' ? fileOf(value.toLowerCase()) : undefined;
    const level = name === 'level' ? levelOf(value) : undefined;
    const component = name === 'component' ? componentOf(value) : undefined;
    if (file) query.file = file;
    else if (level) query.level = level;
    else if (component) query.component = component;
    else rest.push(word);
  }
  query.search = rest.join(' ');
  return query;
}

/** One line of a log as the screen holds it. The key stays with the line while it is on screen. */
export interface LogRow {
  id: number;
  text: string;
}

/** The tail's update, as the server pushes it (`server/src/log-relay.ts`). */
export type LogUpdate =
  | { kind: 'replace'; lines: string[] }
  | { kind: 'append'; lines: string[] }
  | { kind: 'unavailable'; message: string }
  | { kind: 'rejected'; message: string };

export interface LogBuffer {
  /** What is on screen. */
  rows: LogRow[];
  /** Lines that came while the screen was held, waiting for the reader. */
  held: LogRow[];
  /** The log was cleared or rotated while the screen was held: this is what it is now, and replaces the screen when the reader catches up. */
  heldReplace: string[] | undefined;
  nextId: number;
  phase: 'connecting' | 'live' | 'unavailable' | 'rejected';
  message?: string;
}

export const emptyBuffer: LogBuffer = { rows: [], held: [], heldReplace: undefined, nextId: 1, phase: 'connecting' };

/** The most lines the screen keeps: a log left open all day must stay light. */
export const MAX_ROWS = 5000;

const rowsOf = (lines: readonly string[], from: number): LogRow[] => lines.map((text, index) => ({ id: from + index, text }));
const lastRows = (rows: LogRow[]): LogRow[] => (rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : rows);

/**
 * What the screen holds after an update. While the reader is `holding` (paused, or scrolled away from the end) the screen stays as it
 * is and the new lines wait; `release` catches up. A view that has nothing yet takes its first answer whatever the reader does.
 */
export function receive(buffer: LogBuffer, update: LogUpdate, holding: boolean): LogBuffer {
  if (update.kind === 'unavailable') return { ...buffer, phase: 'unavailable', message: update.message };
  if (update.kind === 'rejected') return { ...buffer, phase: 'rejected', message: update.message };
  const fresh = { phase: 'live' as const, message: undefined };
  const first = buffer.phase === 'connecting' && buffer.rows.length === 0;
  if (update.kind === 'replace') {
    if (holding && !first) return { ...buffer, ...fresh, held: [], heldReplace: update.lines, nextId: buffer.nextId + update.lines.length };
    return { ...buffer, ...fresh, rows: lastRows(rowsOf(update.lines, buffer.nextId)), held: [], heldReplace: undefined, nextId: buffer.nextId + update.lines.length };
  }
  const added = rowsOf(update.lines, buffer.nextId);
  const next = { ...fresh, nextId: buffer.nextId + added.length };
  return holding && !first ? { ...buffer, ...next, held: [...buffer.held, ...added].slice(-MAX_ROWS) } : { ...buffer, ...next, rows: lastRows([...buffer.rows, ...added]) };
}

/** The reader caught up (Jump to live, Resume): what waited goes on screen. */
export function release(buffer: LogBuffer): LogBuffer {
  const base = buffer.heldReplace ? rowsOf(buffer.heldReplace, buffer.nextId) : buffer.rows;
  return { ...buffer, rows: lastRows([...base, ...buffer.held]), held: [], heldReplace: undefined, nextId: buffer.nextId + (buffer.heldReplace?.length ?? 0) };
}

/** How many lines wait for the reader. */
export const heldCount = (buffer: LogBuffer): number => (buffer.heldReplace?.length ?? 0) + buffer.held.length;

/** Every line of the view, the held ones too: what Download saves. */
export function viewText(buffer: LogBuffer): string {
  const rows = buffer.heldReplace ? [...buffer.heldReplace, ...buffer.held.map((row) => row.text)] : [...buffer.rows, ...buffer.held].map((row) => row.text);
  return rows.map((text) => `${text}\n`).join('');
}

/** `hermes-errors-error-cron-2026-10-18.log`: the file, the filters that narrowed it, and the day. */
export function downloadName(view: LogsView, day: Date): string {
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return ['hermes', view.file, view.level?.toLowerCase(), view.component, date].filter(Boolean).join('-') + '.log';
}

/** The selected lines, in the order of the log. */
export function selectedText(buffer: LogBuffer, selected: ReadonlySet<number>): string {
  return buffer.rows.filter((row) => selected.has(row.id)).map((row) => row.text).join('\n');
}

const LEVEL_AFTER_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[,.]\d+)?\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s/;

/** The level a line opens with, after its timestamp; `undefined` for a line that does not (a traceback's lines). For the colour of the line only. */
export const levelOfLine = (line: string): LogLevel | undefined => LEVEL_AFTER_TIMESTAMP.exec(line)?.[1] as LogLevel | undefined;

export interface LinePart {
  text: string;
  /** This part is what the search matched. */
  match: boolean;
}

/** A line cut into the parts the search matched and the parts between, so the line can show why Hermes kept it. The search is only text. */
export function splitMatches(line: string, search: string): LinePart[] {
  const words = search.trim();
  if (words === '') return [{ text: line, match: false }];
  const parts: LinePart[] = [];
  const found = new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let from = 0;
  for (const hit of line.matchAll(found)) {
    if (hit.index > from) parts.push({ text: line.slice(from, hit.index), match: false });
    parts.push({ text: hit[0], match: true });
    from = hit.index + hit[0].length;
  }
  if (from < line.length) parts.push({ text: line.slice(from), match: false });
  return parts.length === 0 ? [{ text: line, match: false }] : parts;
}
