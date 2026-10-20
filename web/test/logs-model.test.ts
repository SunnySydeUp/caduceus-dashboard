import { describe, expect, test } from 'vitest';
import { LOG_FILE_CHOICES, downloadName, emptyBuffer, heldCount, levelOfLine, parseQuery, readLogsView, receive, release, selectedText, splitMatches, streamPath, viewText, type LogBuffer, type LogsView } from '../src/modules/logs/logs-model.ts';
import { logsSearch } from '../src/modules/logs/logs-query.ts';

// Observe › Logs (M5 #06): the pure half of the screen. The view is Hermes's own log query (file, level, component, search, lines), so
// the address holds exactly what `GET /api/logs` is asked, and opening a deep link restores the view.

const DEFAULT: LogsView = { file: 'agent', lines: 200, search: '' };

describe('the view in the address', () => {
  test('is Hermes’s query: a deep link reads back as the view it was made from, and the default view is no query at all', () => {
    const view: LogsView = { file: 'gateway', level: 'WARNING', component: 'cron', search: 'rate limit', lines: 500 };

    expect(logsSearch(view)).toEqual({ file: 'gateway', level: 'WARNING', component: 'cron', q: 'rate limit', lines: '500' });
    expect(readLogsView(logsSearch(view))).toEqual(view);
    expect(logsSearch(DEFAULT)).toEqual({});
    expect(readLogsView({})).toEqual(DEFAULT);
  });

  test('ignores what Hermes does not know: another file, level or component, a number of lines that is not one, and a level in lower case is Hermes’s level', () => {
    expect(readLogsView({ file: 'secrets', level: 'LOUD', component: 'nope', lines: '9999' })).toEqual(DEFAULT);
    expect(readLogsView({ lines: 'many' })).toEqual(DEFAULT);
    expect(readLogsView({ level: 'error', component: 'gateway' })).toEqual({ ...DEFAULT, level: 'ERROR', component: 'gateway' });
  });
});

describe('what the live tail is asked', () => {
  test('is the view as Hermes’s own parameters, with the profile of the tab', () => {
    const view: LogsView = { file: 'errors', level: 'ERROR', search: 'a&b=c', lines: 100 };

    expect(streamPath(view, 'coder')).toBe('/_caduceus/api/logs/stream?file=errors&lines=100&level=ERROR&search=a%26b%3Dc&profile=coder');
    expect(streamPath(DEFAULT, undefined)).toBe('/_caduceus/api/logs/stream?file=agent&lines=200');
  });
});

describe('the search box as a structured query', () => {
  test('takes level:, component: and file: words as filters and leaves the rest as the search', () => {
    expect(parseQuery('level:error component:gateway telegram timeout')).toEqual({ level: 'ERROR', component: 'gateway', search: 'telegram timeout' });
    expect(parseQuery('timeout file:errors')).toEqual({ file: 'errors', search: 'timeout' });
    expect(parseQuery('  plain   words  ')).toEqual({ search: 'plain words' });
  });

  test('keeps a filter word that names nothing Hermes has as part of the search, and the last of a repeated filter wins', () => {
    expect(parseQuery('level:loud component:nope')).toEqual({ search: 'level:loud component:nope' });
    expect(parseQuery('level:info level:warning')).toEqual({ level: 'WARNING', search: '' });
  });
});

describe('the lines on screen', () => {
  const texts = (buffer: LogBuffer) => buffer.rows.map((row) => row.text);

  test('begin with the view Hermes gives and grow with what follows, each line keeping its key', () => {
    let buffer = receive(emptyBuffer, { kind: 'replace', lines: ['a', 'b'] }, false);
    const keys = buffer.rows.map((row) => row.id);
    buffer = receive(buffer, { kind: 'append', lines: ['c'] }, false);

    expect(texts(buffer)).toEqual(['a', 'b', 'c']);
    expect(buffer.rows.slice(0, 2).map((row) => row.id)).toEqual(keys);
    expect(new Set(buffer.rows.map((row) => row.id)).size).toBe(3);
    expect(buffer.phase).toBe('live');
  });

  test('while holding (paused, or scrolled up) keep the screen as it is and count the new lines; jumping to live catches up', () => {
    let buffer = receive(emptyBuffer, { kind: 'replace', lines: ['a'] }, false);
    buffer = receive(buffer, { kind: 'append', lines: ['b', 'c'] }, true);
    buffer = receive(buffer, { kind: 'append', lines: ['d'] }, true);

    expect(texts(buffer)).toEqual(['a']);
    expect(heldCount(buffer)).toBe(3);
    expect(texts(release(buffer))).toEqual(['a', 'b', 'c', 'd']);
    expect(heldCount(release(buffer))).toBe(0);
  });

  test('hold a log that was cleared or rotated under the reader too: the screen keeps what was read until the reader catches up', () => {
    let buffer = receive(emptyBuffer, { kind: 'replace', lines: ['a', 'b'] }, false);
    buffer = receive(buffer, { kind: 'replace', lines: ['x'] }, true);
    buffer = receive(buffer, { kind: 'append', lines: ['y'] }, true);

    expect(texts(buffer)).toEqual(['a', 'b']);
    expect(heldCount(buffer)).toBe(2);
    expect(texts(release(buffer))).toEqual(['x', 'y']);
  });

  test('keep only the last 5,000 lines, so a log left open all day stays light', () => {
    const many = Array.from({ length: 6000 }, (_, i) => `line ${i}`);
    const buffer = receive(receive(emptyBuffer, { kind: 'replace', lines: [] }, false), { kind: 'append', lines: many }, false);

    expect(buffer.rows).toHaveLength(5000);
    expect(buffer.rows[0].text).toBe('line 1000');
    expect(buffer.rows.at(-1)!.text).toBe('line 5999');
  });

  test('say when Hermes cannot be read or refuses the view, and the lines already read stay', () => {
    const live = receive(emptyBuffer, { kind: 'replace', lines: ['a'] }, false);
    const down = receive(live, { kind: 'unavailable', message: 'Hermes is not running.' }, false);
    const refused = receive(live, { kind: 'rejected', message: 'Unknown component: nope' }, false);

    expect(down).toMatchObject({ phase: 'unavailable', message: 'Hermes is not running.' });
    expect(texts(down)).toEqual(['a']);
    expect(refused).toMatchObject({ phase: 'rejected', message: 'Unknown component: nope' });
    expect(receive(down, { kind: 'replace', lines: ['a', 'b'] }, false).phase).toBe('live');
  });
});

describe('what is saved and copied', () => {
  test('the download is every line of the view, held ones too, one to a line, named for the view and the day', () => {
    let buffer = receive(emptyBuffer, { kind: 'replace', lines: ['a', 'b'] }, false);
    buffer = receive(buffer, { kind: 'append', lines: ['c'] }, true);

    expect(viewText(buffer)).toBe('a\nb\nc\n');
    expect(viewText(emptyBuffer)).toBe('');
    expect(downloadName({ file: 'errors', level: 'ERROR', component: 'cron', search: '', lines: 200 }, new Date('2026-10-18T21:35:00'))).toBe('hermes-errors-error-cron-2026-10-18.log');
    expect(downloadName(DEFAULT, new Date('2026-10-18T21:35:00'))).toBe('hermes-agent-2026-10-18.log');
  });

  test('copying lines gives the selected ones in the order of the log, however they were picked', () => {
    const buffer = receive(emptyBuffer, { kind: 'replace', lines: ['a', 'b', 'c'] }, false);
    const [a, , c] = buffer.rows;

    expect(selectedText(buffer, new Set([c.id, a.id]))).toBe('a\nc');
    expect(selectedText(buffer, new Set())).toBe('');
  });
});

describe('the level of a line', () => {
  test('is the word after the timestamp, for the colour of the line only: a line that merely says ERROR has no level', () => {
    expect(levelOfLine('2026-10-18 10:00:01,000 ERROR tools.terminal_tool: boom')).toBe('ERROR');
    expect(levelOfLine('2026-10-18 10:00:01,000 INFO [sess_abc] agent.core: hello')).toBe('INFO');
    expect(levelOfLine('Traceback (most recent call last):')).toBeUndefined();
    expect(levelOfLine('a message that says ERROR in the middle')).toBeUndefined();
  });
});

describe('where the search matched in a line', () => {
  test('is every case-insensitive occurrence of the words, so the line can show why Hermes kept it; a search with regex characters is only text', () => {
    expect(splitMatches('Rate limit hit: rate LIMIT', 'rate limit')).toEqual([{ text: 'Rate limit', match: true }, { text: ' hit: ', match: false }, { text: 'rate LIMIT', match: true }]);
    expect(splitMatches('a (b) c', '(b)')).toEqual([{ text: 'a ', match: false }, { text: '(b)', match: true }, { text: ' c', match: false }]);
    expect(splitMatches('nothing here', 'zzz')).toEqual([{ text: 'nothing here', match: false }]);
    expect(splitMatches('anything', '')).toEqual([{ text: 'anything', match: false }]);
  });

  test('names the file as it is on disk, which is what Truncate file asks the owner to type', () => {
    expect(LOG_FILE_CHOICES.map((choice) => choice.disk)).toEqual(['agent.log', 'errors.log', 'gateway.log', 'gui.log', 'desktop.log', 'mcp-stderr.log']);
  });
});
