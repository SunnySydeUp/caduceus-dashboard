// Importing sessions from a JSON or JSONL file (M1 #17). The file is read and checked in the browser, so that a malformed one says exactly where it is
// wrong and nothing is sent; Hermes's `POST /api/sessions/import` (Tier 1) then restores the sessions into a profile and skips the ids it already has.
// No DOM and no React, so it runs under test.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { TieredRequest, TieredResult } from '../../tiered-fetch.ts';
import type { Outcome } from './sessions-actions.ts';

/** What Hermes's `SessionDB.import_sessions` takes (`hermes_state.py`): more is refused as a whole, so the file is checked against it first. */
export const IMPORT_LIMITS = {
  sessions: 500,
  messagesPerSession: 10_000,
  totalMessages: 50_000,
  sessionBytes: 5 * 1024 * 1024,
  totalBytes: 25 * 1024 * 1024,
};

export interface ImportSession {
  id: string;
  title: string;
  messageCount: number;
  /** The session as the file has it: what is sent. */
  record: Record<string, unknown>;
}

/** Where a file is wrong. A syntax error has a line and a column; a session Hermes would refuse has the line it is on, in JSONL. */
export interface ImportProblem {
  line?: number;
  column?: number;
  message: string;
}

export type ParsedImport =
  | { ok: true; format: 'json' | 'jsonl'; sessions: ImportSession[]; messageCount: number }
  /** `problems` are the first few; `more` counts the rest. */
  | { ok: false; problems: ImportProblem[]; more: number };

/** How many problems are listed; a file with a thousand wrong lines is one mistake repeated. */
const SHOWN_PROBLEMS = 10;

const NOT_A_SESSION_FILE = 'This is not a session export: expected a session (an object with messages), a list of sessions, or an object with a "sessions" list.';

export function describeProblem({ line, column, message }: ImportProblem): string {
  if (line === undefined) return message;
  return `Line ${line}${column === undefined ? '' : `, column ${column}`}: ${message}`;
}

class SyntaxProblem extends Error {
  constructor(
    readonly offset: number,
    message: string,
  ) {
    super(message);
  }
}

const LITERAL = /(?:true|false|null)(?![A-Za-z0-9_])/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const DELIMITER = /[\s,:\]}[{]/;
const MAX_DEPTH = 200;

/**
 * The first syntax error of a JSON text, or `undefined` when there is none. The browser's own parser words its errors differently in each engine and
 * not always with a position, so the position is found here, the same way everywhere.
 */
function findSyntaxError(text: string): { offset: number; message: string } | undefined {
  const end = text.trimEnd().length;
  let at = 0;
  const skip = () => {
    while (at < end && ' \t\n\r'.includes(text[at]!)) at += 1;
  };
  const here = (): string => {
    if (DELIMITER.test(text[at]!)) return text[at]!;
    let stop = at;
    while (stop < end && stop - at < 20 && !DELIMITER.test(text[stop]!)) stop += 1;
    return text.slice(at, stop);
  };
  const need = () => {
    skip();
    if (at >= end) throw new SyntaxProblem(end, 'The file ends before the data does.');
  };
  const string = () => {
    const start = at;
    at += 1;
    for (;;) {
      const char = text[at];
      if (char === undefined || char === '\n') throw new SyntaxProblem(start, 'A string is not closed.');
      if (char === '"') {
        at += 1;
        return;
      }
      if (char === '\\') {
        const escape = text[at + 1];
        if (escape === 'u' ? !/^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6)) : escape === undefined || !'"\\/bfnrt'.includes(escape)) throw new SyntaxProblem(at, 'A string has an escape that JSON does not know.');
        at += escape === 'u' ? 6 : 2;
      } else if (char < ' ') throw new SyntaxProblem(at, 'A string has a raw control character; write it as an escape such as \\t.');
      else at += 1;
    }
  };
  const value = (depth: number): void => {
    need();
    if (depth > MAX_DEPTH) throw new SyntaxProblem(at, 'The data is nested too deeply.');
    const char = text[at]!;
    if (char === '{') {
      at += 1;
      skip();
      if (text[at] === '}') {
        at += 1;
        return;
      }
      for (;;) {
        need();
        if (text[at] !== '"') throw new SyntaxProblem(at, 'Expected a property name in double quotes.');
        string();
        need();
        if (text[at] !== ':') throw new SyntaxProblem(at, 'Expected ":" after the property name.');
        at += 1;
        value(depth + 1);
        need();
        if (text[at] === ',') at += 1;
        else if (text[at] === '}') {
          at += 1;
          return;
        } else throw new SyntaxProblem(at, 'Expected "," or "}" after a value.');
      }
    } else if (char === '[') {
      at += 1;
      skip();
      if (text[at] === ']') {
        at += 1;
        return;
      }
      for (;;) {
        value(depth + 1);
        need();
        if (text[at] === ',') at += 1;
        else if (text[at] === ']') {
          at += 1;
          return;
        } else throw new SyntaxProblem(at, 'Expected "," or "]" after a value.');
      }
    } else if (char === '"') string();
    else if (char === '-' || (char >= '0' && char <= '9')) {
      if (/^-?0\d/.test(text.slice(at, at + 3))) throw new SyntaxProblem(at, 'A number cannot start with 0 followed by a digit.');
      NUMBER.lastIndex = at;
      const match = NUMBER.exec(text);
      const next = match ? text[at + match[0].length] : undefined;
      if (!match || (next !== undefined && !DELIMITER.test(next))) throw new SyntaxProblem(at, 'This is not a valid number.');
      at += match[0].length;
    } else {
      LITERAL.lastIndex = at;
      const match = LITERAL.exec(text);
      if (!match) throw new SyntaxProblem(at, `Unexpected "${here()}". Expected a value.`);
      at += match[0].length;
    }
  };
  try {
    value(0);
    skip();
    if (at < end) throw new SyntaxProblem(at, `Unexpected "${here()}" after the end of the data.`);
  } catch (error) {
    if (error instanceof SyntaxProblem) return { offset: error.offset, message: error.message };
    throw error;
  }
  return undefined;
}

/** The line and column (both from 1) of an offset in a text. */
function placeOf(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 };
}

/** How many bytes a text takes in UTF-8, encoding it only when it could be over `limit` (a UTF-16 unit takes one to three bytes). */
function over(text: string, limit: number): { bytes: number; over: boolean } {
  const bytes = text.length * 3 <= limit ? text.length : new TextEncoder().encode(text).length;
  return { bytes, over: bytes > limit };
}

const kindOf = (value: unknown): string => (Array.isArray(value) ? 'a list' : value === null ? 'null' : `a ${typeof value}`);

/** Whether the text is JSONL: its first line is a whole JSON object and another line follows. */
function isJsonl(text: string): boolean {
  const rows = text.split('\n').filter((row) => row.trim() !== '');
  if (rows.length < 2) return false;
  try {
    return isRecord(JSON.parse(rows[0]!));
  } catch {
    return false;
  }
}

interface Entry {
  record: unknown;
  /** The line it is on, in JSONL. */
  line: number | undefined;
}

/** Checks one session the way Hermes does, and reports what it would refuse. */
function checkSession(entry: Entry, index: number, seen: Map<string, Entry & { index: number }>, problems: ImportProblem[]): ImportSession | undefined {
  const { record, line } = entry;
  const subject = (id = '') => `Session ${index + 1}${id === '' ? '' : ` (${id})`}`;
  const report = (id: string, message: string) => problems.push(line === undefined ? { message: `${subject(id)}: ${message}` } : { line, message });
  if (!isRecord(record)) {
    report('', 'it is not an object.');
    return undefined;
  }
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (id === '') {
    report('', 'it has no id.');
    return undefined;
  }
  const first = seen.get(id);
  if (first) {
    report('', `it repeats the id “${id}” of ${line === undefined ? `session ${first.index + 1}` : `line ${first.line}`}.`);
    return undefined;
  }
  seen.set(id, { ...entry, index });
  const messages = record.messages ?? [];
  if (!Array.isArray(messages)) {
    report(id, 'messages must be a list.');
    return undefined;
  }
  let sound = true;
  messages.forEach((message, at) => {
    if (!isRecord(message)) {
      report(id, `message ${at + 1} is not an object.`);
      sound = false;
    } else if (typeof message.role !== 'string' || message.role === '') {
      report(id, `message ${at + 1} has no role.`);
      sound = false;
    }
  });
  if (messages.length > IMPORT_LIMITS.messagesPerSession) {
    report(id, `it has ${messages.length} messages; Hermes takes at most ${IMPORT_LIMITS.messagesPerSession} in one session.`);
    return undefined;
  }
  const { timings: _timings, ...measured } = record;
  if (over(JSON.stringify(measured), IMPORT_LIMITS.sessionBytes).over) {
    report(id, `it is over ${IMPORT_LIMITS.sessionBytes / 1024 / 1024} MB, the most Hermes takes for one session.`);
    return undefined;
  }
  if (!sound) return undefined;
  return { id, title: typeof record.title === 'string' ? record.title : '', messageCount: messages.length, record };
}

/**
 * Reads a file's text as sessions: one session's export, a list of sessions, an object with a `sessions` list, or JSONL (a session a line; recognised
 * by its lines, or by `name` ending in `.jsonl`). A file that is wrong says where, with line numbers, and everything that Hermes would refuse is found
 * here first.
 */
export function parseImport(text: string, name = ''): ParsedImport {
  const failed = (problems: ImportProblem[]): ParsedImport => ({ ok: false, problems: problems.slice(0, SHOWN_PROBLEMS), more: Math.max(0, problems.length - SHOWN_PROBLEMS) });
  if (text.trim() === '') return failed([{ message: 'The file is empty.' }]);
  const problems: ImportProblem[] = [];
  const jsonl = /\.(?:jsonl|ndjson)$/i.test(name) || isJsonl(text);
  let entries: Entry[];
  if (jsonl) {
    entries = [];
    text.split('\n').forEach((row, at) => {
      if (row.trim() === '') return;
      const line = at + 1;
      let record: unknown;
      try {
        record = JSON.parse(row);
      } catch {
        const found = findSyntaxError(row);
        problems.push({ line, column: found ? found.offset + 1 : undefined, message: found?.message ?? 'This line is not valid JSON.' });
        return;
      }
      if (isRecord(record)) entries.push({ record, line });
      else problems.push({ line, message: `A line must be one session, an object; this is ${kindOf(record)}.` });
    });
  } else {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      const found = findSyntaxError(text);
      if (!found) return failed([{ message: 'The file is not valid JSON.' }]);
      return failed([{ ...placeOf(text, found.offset), message: found.message }]);
    }
    const listed = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.sessions) ? body.sessions : isRecord(body) && Array.isArray(body.messages) ? [body] : undefined;
    if (listed === undefined) return failed([{ message: NOT_A_SESSION_FILE }]);
    entries = listed.map((record) => ({ record, line: undefined }));
  }
  if (entries.length === 0 && problems.length === 0) return failed([{ message: 'The file has no sessions in it.' }]);
  if (entries.length > IMPORT_LIMITS.sessions) return failed([{ message: `The file has ${entries.length} sessions; Hermes takes at most ${IMPORT_LIMITS.sessions} at once.` }]);
  const seen = new Map<string, Entry & { index: number }>();
  const sessions = entries.flatMap((entry, index) => checkSession(entry, index, seen, problems) ?? []);
  const messageCount = sessions.reduce((sum, session) => sum + session.messageCount, 0);
  if (problems.length === 0 && messageCount > IMPORT_LIMITS.totalMessages) problems.push({ message: `The sessions hold ${messageCount} messages in all; Hermes takes at most ${IMPORT_LIMITS.totalMessages} at once.` });
  if (problems.length === 0 && over(JSON.stringify(sessions.map((session) => session.record)), IMPORT_LIMITS.totalBytes).over) problems.push({ message: `The sessions add up to over ${IMPORT_LIMITS.totalBytes / 1024 / 1024} MB, the most Hermes takes at once.` });
  if (problems.length > 0) return failed(problems);
  return { ok: true, format: jsonl ? 'jsonl' : 'json', sessions, messageCount };
}

/** How an import ended: what Hermes imported and what it skipped, or why not. */
export type ImportOutcome = { kind: 'imported'; imported: number; skipped: number; message: string } | Extract<Outcome, { kind: 'cancelled' | 'failed' }>;

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** What Hermes said was wrong, in its words: a refused session (`errors`) or its `detail` string. */
function refusalOf(body: unknown, status: number): string {
  const detail = isRecord(body) ? body.detail : undefined;
  if (typeof detail === 'string' && detail !== '') return detail;
  if (isRecord(detail) && Array.isArray(detail.errors) && detail.errors.length > 0) {
    return detail.errors
      .filter(isRecord)
      .map((error) => `Session ${typeof error.index === 'number' ? error.index + 1 : '?'}${typeof error.session_id === 'string' ? ` (${error.session_id})` : ''}: ${String(error.error)}.`)
      .join(' ');
  }
  if (isRecord(body) && typeof body.message === 'string') return body.message;
  return `Hermes answered ${status}.`;
}

/**
 * Sends the checked sessions to Hermes's import (Tier 1: the owner confirms, and the dialog names the profile they go into). Hermes skips a session whose id
 * the profile already has, and says how many.
 */
export async function importSessions({ send, profile, sessions }: { send(request: TieredRequest): Promise<TieredResult>; profile: string; sessions: readonly ImportSession[] }): Promise<ImportOutcome> {
  const messages = sessions.reduce((sum, session) => sum + session.messageCount, 0);
  const result = await send({
    method: 'POST',
    path: '/api/sessions/import',
    body: { sessions: sessions.map((session) => session.record), profile },
    confirm: {
      title: `Import ${plural(sessions.length, 'session')} into ${profile}?`,
      text: `${plural(messages, 'message')} are added to this profile’s history. A session that is already there is skipped.`,
      profile,
      confirmLabel: 'Import',
    },
  });
  if (result.kind === 'cancelled') return result;
  if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
  const body: unknown = await result.response.json().catch(() => undefined);
  if (!result.response.ok || !isRecord(body)) return { kind: 'failed', message: refusalOf(body, result.response.status) };
  const imported = typeof body.imported === 'number' ? body.imported : 0;
  const skipped = typeof body.skipped === 'number' ? body.skipped : 0;
  const skippedText = skipped === 0 ? '' : ` ${plural(skipped, 'session')} ${skipped === 1 ? 'was' : 'were'} already there and skipped.`;
  return { kind: 'imported', imported, skipped, message: `Imported ${plural(imported, 'session')} into ${profile}.${skippedText}` };
}
