import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import fixture from './fixtures/activity-events.json';
import { entriesOf, foldTurn, footerText, withLiveSubagents, foldSubagents, type ActivityItem, type ActivityMode, type TurnSegment } from '../src/modules/chat/activity.ts';

// The overlay layer stack is loaded with the shell's pieces; there is neither a window nor a document here.
vi.stubGlobal('window', { addEventListener: () => undefined });
vi.stubGlobal('document', { addEventListener: () => undefined });
const { ActivityGroup } = await import('../src/modules/chat/ActivityCards.tsx');
const { ContextPanel, usageRows, openWork } = await import('../src/modules/chat/ContextPanel.tsx');

type Event = Parameters<typeof foldTurn>[1];
const events = fixture.events as unknown as Event[];
/** The cards of the recorded turn, as the live transcript has them once the children have reported. */
const live = (): ActivityItem[] => {
  const segments = events.reduce<readonly TurnSegment[]>(foldTurn, []);
  const children = events.reduce(foldSubagents, [] as ReturnType<typeof foldSubagents>);
  return withLiveSubagents(segments.flatMap((segment) => (segment.kind === 'activity' ? segment.items : [])), children);
};
const html = (items: readonly ActivityItem[], mode: ActivityMode) => renderToStaticMarkup(createElement(ActivityGroup, { items, mode, openChild: (id: string) => createElement('a', { href: `/chat/${id}` }, 'Open its activity') }));
const cards = (markup: string) => markup.split('<section ').slice(1);

describe('cards from a recorded turn, live', () => {
  const items = live();

  test('Worklog: one closed card for the reasoning, each tool call and the subagent, each with its state in words; the failed call is open', () => {
    const out = cards(html(items, 'worklog'));
    expect(out).toHaveLength(7);
    const toggles = out.map((card) => /aria-expanded="(true|false)"/.exec(card)![1]);
    // reasoning, todo_list, patch, read_file (failed), memory, delegate_task, the child it started
    expect(toggles).toEqual(['false', 'false', 'false', 'true', 'false', 'false', 'false']);
    expect(out[0]).toContain('Reasoning');
    expect(out[1]).toContain('todo_list');
    expect(out[3]).toContain('data-status="failed"');
    expect(out[3]).toContain('Failed');
    expect(out[3]).toContain('File not found: /tmp/nonexistent-zzz');
    expect(out[6]).toContain('Say hi');
    expect(out[6]).toContain('Done');
    // A closed card has no body in the page.
    expect(out[1]).not.toContain('Arguments');
  });

  test('every card header is a real button that names the body it opens', () => {
    for (const card of cards(html(items, 'worklog'))) expect(card).toMatch(/<button type="button" class="act__toggle" aria-expanded="(true|false)" aria-controls="([^"]+)"[^>]*>[\s\S]*<div id="\2" class="act__body"/);
  });

  test('Stream: every card is open, with arguments, the diff lines and the output', () => {
    const out = html(items, 'stream');
    expect(cards(out).every((card) => card.includes('aria-expanded="true"'))).toBe(true);
    expect(out).toContain('Arguments');
    expect(out).toContain('<span class="act__line" data-line="remove">-hello\n</span>');
    expect(out).toContain('<span class="act__line" data-line="add">+bye\n</span>');
    expect(out).toContain('Entry added.');
    expect(out).toContain('think hard');
    expect(out).toContain('Open its activity');
  });

  test('Final only: no cards', () => {
    expect(html(items, 'final')).toBe('');
  });

  test('output is text: markup in it is escaped', () => {
    const tool: ActivityItem = { kind: 'tool', key: 'k', id: 'a', name: 'terminal', status: 'done', output: '<img src=x onerror=alert(1)>' };
    const out = html([tool], 'stream');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('a reasoning card with no words yet is not drawn', () => {
    expect(html([{ kind: 'reasoning', key: 'r', text: '', streaming: true }], 'stream')).toBe('');
  });
});

describe('the same cards from Hermes\'s stored rows', () => {
  test('a failed call and its diff survive the reload; an unanswered call says Hermes has no result', () => {
    const entries = entriesOf([
      { id: 1, role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'patch', arguments: '{"path":"/a"}' } }, { id: 'c2', function: { name: 'read_file', arguments: '{}' } }, { id: 'c3', function: { name: 'terminal', arguments: '{}' } }] },
      { id: 2, role: 'tool', tool_call_id: 'c1', content: '{"success":true,"diff":"--- a/a\\n+++ b/a\\n@@ -1 +1 @@\\n-x\\n+y\\n"}' },
      { id: 3, role: 'tool', tool_call_id: 'c2', content: '{"error":"nope"}' },
    ]);
    const out = html((entries[0] as { items: ActivityItem[] }).items, 'worklog');
    expect(cards(out).map((card) => /data-status="(\w+)"/.exec(card)![1])).toEqual(['done', 'failed', 'incomplete']);
    expect(out).toContain('nope');
    const open = html((entries[0] as { items: ActivityItem[] }).items, 'stream');
    expect(open).toContain('data-line="add">+y');
    expect(open).toContain('Hermes has no result for this call.');
  });
});

describe('the context panel', () => {
  const todos = [
    { id: 'a', content: 'Read the brief', status: 'completed' as const },
    { id: 'b', content: 'Write <the> plan', status: 'in_progress' as const },
  ];
  const children = events.reduce(foldSubagents, [] as ReturnType<typeof foldSubagents>);

  test('Todo lists the tasks with their state in words, and the tab counts the finished ones; text is escaped', () => {
    const out = renderToStaticMarkup(createElement(ContextPanel, { todos, subagents: [], usage: undefined }));
    expect(out).toContain('Todo 1/2');
    expect(out).toContain('Read the brief');
    expect(out).toContain('Write &lt;the&gt; plan');
    expect(out).toMatch(/data-status="in_progress"[\s\S]*In progress/);
    expect(renderToStaticMarkup(createElement(ContextPanel, { todos: [], subagents: [], usage: undefined }))).toContain('No tasks yet');
  });

  test('Run lists the subagents (open) and the session usage in words', () => {
    const out = renderToStaticMarkup(createElement(ContextPanel, { todos: [], subagents: children, usage: { input: 80, output: 20, total: 100, calls: 2, context_used: 20, context_max: 256000, context_percent: 0.4, cache_hit_pct: 12.4, avg_tps: 42.46, cost_usd: 0.01234 } }));
    expect(out).toContain('Say hi');
    expect(out).toContain('Total tokens');
    expect(out).toContain('20 of 256,000 (0%)');
    expect(out).toContain('42.5 tokens/s');
    expect(out).toContain('$0.0123');
    expect(usageRows({ model: 'm' })).toEqual([]);
  });

  test('the button on a phone counts the tasks not finished and the children still running', () => {
    expect(openWork(todos, [])).toBe(1);
    expect(openWork([], children)).toBe(0);
    expect(openWork(todos, [{ ...children[0]!, status: 'running' }])).toBe(2);
  });
});

describe('reply footers', () => {
  test('say tokens in and out, and tokens per second', () => {
    expect(footerText({ input: 1200, output: 20, total: 1220, tps: 42.46 })).toBe('1,200 in · 20 out · 42.5 tokens/s');
    expect(footerText({ input: undefined, output: 20, total: undefined, tps: undefined })).toBe('20 out');
  });
});
