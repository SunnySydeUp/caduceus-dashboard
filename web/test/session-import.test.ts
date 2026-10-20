import { describe, expect, test } from 'vitest';
import { describeProblem, IMPORT_LIMITS, parseImport, type ParsedImport } from '../src/modules/chat/session-import.ts';

// Importing sessions from a file (M1 #17): the file is checked in the browser before anything is sent, and a malformed one says where it is wrong.
const session = (id: string, messages: unknown[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], extra: Record<string, unknown> = {}) => ({ id, title: `Title of ${id}`, source: 'cli', messages, ...extra });
const lines = (...rows: unknown[]) => rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n');

function problemsOf(parsed: ParsedImport): string[] {
  if (parsed.ok) throw new Error('Expected problems, got a valid file');
  return parsed.problems.map(describeProblem);
}
function sessionsOf(parsed: ParsedImport) {
  if (!parsed.ok) throw new Error(`Expected a valid file: ${problemsOf(parsed).join('; ')}`);
  return parsed;
}

describe('a valid file', () => {
  test('is one session’s export (an object with messages)', () => {
    const parsed = sessionsOf(parseImport(JSON.stringify(session('a'), null, 2)));
    expect(parsed.format).toBe('json');
    expect(parsed.sessions).toMatchObject([{ id: 'a', title: 'Title of a', messageCount: 2 }]);
    expect(parsed.messageCount).toBe(2);
  });

  test('is a list of sessions, or an object that holds the list', () => {
    expect(sessionsOf(parseImport(JSON.stringify([session('a'), session('b', [])]))).sessions.map((s) => s.id)).toEqual(['a', 'b']);
    const wrapped = sessionsOf(parseImport(JSON.stringify({ sessions: [session('a'), session('b')] })));
    expect(wrapped.messageCount).toBe(4);
  });

  test('is JSONL, a session on each line, with blank lines left out; it is recognised by its lines and not by its name', () => {
    const parsed = sessionsOf(parseImport(`${lines(session('a'), '', session('b', [{ role: 'user', content: 'x' }]))}\n`));
    expect(parsed.format).toBe('jsonl');
    expect(parsed.sessions.map((s) => [s.id, s.messageCount])).toEqual([['a', 2], ['b', 1]]);
    expect(sessionsOf(parseImport(lines(session('a')))).format).toBe('json');
  });

  test('keeps each session’s record exactly, for the request', () => {
    const record = session('a', [{ role: 'user', content: 'hi', timestamp: 1 }], { archived: 1, parent_session_id: null });
    expect(sessionsOf(parseImport(JSON.stringify(record))).sessions[0]!.record).toEqual(record);
  });
});

describe('a malformed file', () => {
  test('that is not JSON says the line and column of the first mistake', () => {
    const text = '{\n  "id": "a",\n  "messages": [\n    { "role": "user" "content": "hi" }\n  ]\n}';
    expect(problemsOf(parseImport(text))).toEqual(['Line 4, column 22: Expected "," or "}" after a value.']);
  });

  test.each([
    ['{"id": "a"', 'Line 1, column 11: The file ends before the data does.'],
    ['{"id": "a",}', 'Line 1, column 12: Expected a property name in double quotes.'],
    ['[1, 2,\n  tru]', 'Line 2, column 3: Unexpected "tru". Expected a value.'],
    ['{"a": "unterminated}', 'Line 1, column 7: A string is not closed.'],
    ['{"a": 01}', 'Line 1, column 7: A number cannot start with 0 followed by a digit.'],
    ['{"id": "a"} x', 'Line 1, column 13: Unexpected "x" after the end of the data.'],
    ['', 'The file is empty.'],
  ])('%j says %j', (text, said) => {
    expect(problemsOf(parseImport(text))).toEqual([said]);
  });

  test('named .jsonl is read as JSONL even when its first line is the bad one', () => {
    expect(problemsOf(parseImport(lines('oops', session('a')), 'out.jsonl'))).toEqual(['Line 1, column 1: Unexpected "oops". Expected a value.']);
  });

  test('in JSONL names the line of each bad line, and reports every one', () => {
    const text = lines(session('a'), '{"id": "b", "messages": [}', '', session('c'), '[1, 2]', 'not json');
    expect(problemsOf(parseImport(text))).toEqual([
      'Line 2, column 26: Unexpected "}". Expected a value.',
      'Line 5: A line must be one session, an object; this is a list.',
      'Line 6, column 1: Unexpected "not". Expected a value.',
    ]);
  });

  test('that is JSON of the wrong kind says what a session file is', () => {
    expect(problemsOf(parseImport('42'))).toEqual(['This is not a session export: expected a session (an object with messages), a list of sessions, or an object with a "sessions" list.']);
    expect(problemsOf(parseImport('{"title": "x"}'))).toEqual(['This is not a session export: expected a session (an object with messages), a list of sessions, or an object with a "sessions" list.']);
    expect(problemsOf(parseImport('[]'))).toEqual(['The file has no sessions in it.']);
  });

  test('with a session Hermes would refuse says which one and why', () => {
    const text = JSON.stringify([session('a'), { title: 'no id', messages: [] }, session('a'), session('d', 'not a list' as never), session('e', [{ role: 'user' }, 'text', { content: 'no role' }]), 7]);
    expect(problemsOf(parseImport(text))).toEqual([
      'Session 2: it has no id.',
      'Session 3: it repeats the id “a” of session 1.',
      'Session 4 (d): messages must be a list.',
      'Session 5 (e): message 2 is not an object.',
      'Session 5 (e): message 3 has no role.',
      'Session 6: it is not an object.',
    ]);
  });

  test('in JSONL names the line for a session Hermes would refuse', () => {
    const text = lines(session('a'), { messages: [] }, session('a'));
    expect(problemsOf(parseImport(text))).toEqual(['Line 2: it has no id.', 'Line 3: it repeats the id “a” of line 1.']);
  });

  test('that is over Hermes’s limits says so, before anything is sent', () => {
    const many = Array.from({ length: IMPORT_LIMITS.messagesPerSession + 1 }, () => ({ role: 'user', content: '' }));
    expect(problemsOf(parseImport(JSON.stringify(session('big', many))))).toEqual([`Session 1 (big): it has ${IMPORT_LIMITS.messagesPerSession + 1} messages; Hermes takes at most ${IMPORT_LIMITS.messagesPerSession} in one session.`]);
    const sessions = Array.from({ length: IMPORT_LIMITS.sessions + 1 }, (_, i) => session(`s${i}`, []));
    expect(problemsOf(parseImport(JSON.stringify(sessions)))).toEqual([`The file has ${IMPORT_LIMITS.sessions + 1} sessions; Hermes takes at most ${IMPORT_LIMITS.sessions} at once.`]);
    const heavy = session('heavy', [{ role: 'user', content: 'x'.repeat(IMPORT_LIMITS.sessionBytes) }]);
    expect(problemsOf(parseImport(JSON.stringify(heavy)))).toEqual(['Session 1 (heavy): it is over 5 MB, the most Hermes takes for one session.']);
  });

  test('shows the first problems and counts the rest', () => {
    const parsed = parseImport(lines(...Array.from({ length: 14 }, () => 'bad')), 'chats.jsonl');
    if (parsed.ok) throw new Error('Expected problems');
    expect(parsed.problems).toHaveLength(10);
    expect(parsed.more).toBe(4);
  });
});
