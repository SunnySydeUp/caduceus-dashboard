import { describe, expect, test } from 'vitest';
import { exportFile, exportFilename, EXPORT_TOKENS, readExport } from '../src/modules/chat/session-export.ts';

// Exporting a session (M1 #17): Hermes's `GET /api/sessions/{id}/export` JSON becomes a Markdown, JSON or themed HTML file in the browser.
// The shape below is what that endpoint answers (a session row with its messages), checked against a real Hermes in server/test/session-export-import.test.ts.
const message = (id: number, fields: Record<string, unknown>) => ({
  id,
  session_id: 'trip-1',
  tool_call_id: null,
  tool_calls: null,
  tool_name: null,
  timestamp: 1_792_343_553 + id,
  reasoning: null,
  active: 1,
  compacted: 0,
  ...fields,
});

const EXPORT_BODY = {
  id: 'trip-1',
  source: 'cli',
  model: 'gpt-test',
  title: 'Plan <the> trip & "more"',
  cwd: '/work/trip',
  started_at: 1_792_343_553,
  message_count: 5,
  messages: [
    message(1, { role: 'user', content: 'Where do we start?' }),
    message(2, { role: 'assistant', content: 'Look at this:\n```js\nconst a = "<b>";\n```\nThen book.', reasoning: 'The user wants a plan.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"q":"flights"}' } }] }),
    message(3, { role: 'tool', content: 'three results', tool_call_id: 'c1', tool_name: 'web_search' }),
    message(4, { role: 'assistant', content: 'A rewound answer.', active: 0 }),
    message(5, { role: 'user', content: [{ type: 'text', text: 'Thanks' }, { type: 'image_url', image_url: { url: 'x' } }] }),
  ],
};

const TOKENS = Object.fromEntries(EXPORT_TOKENS.map((name, index) => [name, `value-${index}`]));

describe('reading Hermes’s export', () => {
  test('keeps the session’s fields and its messages, and says what is wrong with an answer that is not an export', () => {
    const session = readExport(EXPORT_BODY);
    expect(session).toMatchObject({ id: 'trip-1', title: 'Plan <the> trip & "more"', source: 'cli', model: 'gpt-test', cwd: '/work/trip', startedAt: 1_792_343_553 });
    expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(() => readExport(null)).toThrow('Hermes’s export is not a session');
    expect(() => readExport({ id: 'x' })).toThrow('Hermes’s export has no messages list');
  });

  test('reads a message’s text from a plain string or from the text parts of a list, and keeps its tool calls and reasoning', () => {
    const { messages } = readExport(EXPORT_BODY);
    expect(messages[3]!.text).toBe('Thanks');
    expect(messages[1]).toMatchObject({ reasoning: 'The user wants a plan.', toolCalls: [{ name: 'web_search', arguments: '{"q":"flights"}' }] });
    expect(messages[2]).toMatchObject({ toolName: 'web_search', text: 'three results' });
  });
});

describe('the file name', () => {
  test('is the title as a safe slug with the start of the id, and the format’s extension', () => {
    const session = readExport(EXPORT_BODY);
    expect(exportFilename(session, 'markdown')).toBe('plan-the-trip-more-trip-1.md');
    expect(exportFilename(session, 'json')).toBe('plan-the-trip-more-trip-1.json');
    expect(exportFilename(session, 'html')).toBe('plan-the-trip-more-trip-1.html');
    expect(exportFilename({ ...session, title: '', id: '20261001_abcdef123456' }, 'json')).toBe('session-abcdef123456.json');
  });
});

describe('the JSON file', () => {
  test('is Hermes’s own export, every field and every message including the rewound one, so that it imports again', () => {
    const file = exportFile(readExport(EXPORT_BODY), 'json', { tokens: TOKENS });
    expect(file.mime).toBe('application/json');
    expect(JSON.parse(file.content)).toEqual(EXPORT_BODY);
  });
});

describe('the Markdown file', () => {
  const file = exportFile(readExport(EXPORT_BODY), 'markdown', { tokens: TOKENS });

  test('has the title and the facts, then each visible message under who said it', () => {
    expect(file.mime).toBe('text/markdown');
    expect(file.content).toMatch(/^# Plan <the> trip & "more"\n/);
    expect(file.content).toContain('- Session: trip-1');
    expect(file.content).toContain('- Source: cli');
    expect(file.content).toContain('- Folder: /work/trip');
    expect(file.content).toContain('- Started: 2026-10-18T17:12:33Z');
    expect(file.content.indexOf('## You')).toBeLessThan(file.content.indexOf('## Hermes'));
  });

  test('puts tool calls and results in code blocks, long enough fences around text that holds fences, and leaves a rewound message out', () => {
    expect(file.content).toContain('**Tool call: web_search**\n\n```json\n{"q":"flights"}\n```');
    expect(file.content).toContain('**Tool result: web_search**\n\n```\nthree results\n```');
    expect(file.content).toContain('Look at this:\n```js\nconst a = "<b>";\n```\nThen book.');
    expect(file.content).not.toContain('A rewound answer.');
    const fenced = exportFile(readExport({ ...EXPORT_BODY, messages: [message(1, { role: 'tool', tool_name: 't', content: 'a\n```\nb' })] }), 'markdown', { tokens: TOKENS });
    expect(fenced.content).toContain('````\na\n```\nb\n````');
  });

  test('keeps reasoning in a collapsed section', () => {
    expect(file.content).toContain('<details><summary>Reasoning</summary>\n\nThe user wants a plan.\n\n</details>');
  });
});

describe('the HTML file', () => {
  const file = exportFile(readExport(EXPORT_BODY), 'html', { tokens: TOKENS });

  test('is one themed page: the resolved tokens in its own style, nothing fetched from outside, nothing from the conversation as markup', () => {
    expect(file.mime).toBe('text/html');
    for (const name of EXPORT_TOKENS) expect(file.content).toContain(`${name}:value-${EXPORT_TOKENS.indexOf(name)};`);
    expect(file.content).toContain(`default-src 'none'`);
    expect(file.content).not.toMatch(/<(script|link|img|iframe)\b/i);
    expect(file.content).not.toMatch(/(src|href)=/i);
    expect(file.content).toContain('Plan &lt;the&gt; trip &amp; &quot;more&quot;');
    expect(file.content).toContain('const a = &quot;&lt;b&gt;&quot;;');
    expect(file.content).not.toContain('A rewound answer.');
  });

  test('is the same page for the same session (a snapshot)', () => {
    expect(file.content).toMatchSnapshot();
  });
});
