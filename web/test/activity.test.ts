import { describe, expect, test } from 'vitest';
import fixture from './fixtures/activity-events.json';
import {
  ACTIVITY_MODES,
  endTurn,
  entriesOf,
  failureOf,
  foldSubagents,
  foldTurn,
  hermesSettingsFor,
  noticeOf,
  opensByDefault,
  parseActivityMode,
  shownActivity,
  statsOf,
  todosOf,
  withLiveSubagents,
  withSnapshots,
  type ActivityItem,
  type SubagentActivity,
  type TurnSegment,
} from '../src/modules/chat/activity.ts';

type Event = Parameters<typeof foldTurn>[1];
const recorded = fixture.events as unknown as Event[];
const fold = (events: readonly Event[], from: readonly TurnSegment[] = []) => events.reduce<readonly TurnSegment[]>(foldTurn, from);
const items = (segments: readonly TurnSegment[]): ActivityItem[] => segments.flatMap((segment) => (segment.kind === 'activity' ? segment.items : []));
const event = (type: string, payload: unknown): Event => ({ type, payload }) as Event;

describe('a turn as Hermes sent it (events recorded from a real Hermes)', () => {
  const segments = fold(recorded.filter((entry) => !['subagent.thinking', 'subagent.complete', 'message.complete'].includes(entry.type)));

  test('text and activity keep the order they came in; the reasoning is one card, the spinner captions are not reasoning', () => {
    expect(segments.map((segment) => (segment.kind === 'text' ? `text:${segment.text.trim()}` : `activity:${segment.items.map((item) => (item.kind === 'tool' ? item.name : item.kind)).join(',')}`))).toEqual([
      'activity:reasoning',
      'text:Let me plan.',
      'activity:todo_list,patch,read_file,memory,delegate_task,subagent',
      'text:child says hi',
    ]);
    const reasoning = items(segments).find((item) => item.kind === 'reasoning');
    expect(reasoning).toMatchObject({ text: 'think hard' });
    expect(JSON.stringify(segments)).not.toContain('synthesizing');
  });

  test('the model writing a call is a generating card; tool.start adopts it, and the completion fills in the result, diff, duration and failure', () => {
    const generating = items(fold(recorded.slice(0, 11)));
    expect(generating.filter((item) => item.kind === 'tool').map((item) => [item.name, item.status, item.id])).toEqual(
      ['todo_list', 'patch', 'read_file', 'memory', 'delegate_task'].map((name) => [name, 'generating', undefined]),
    );
    const tools = items(segments).filter((item) => item.kind === 'tool');
    expect(tools.map((item) => [item.id, item.status])).toEqual([
      ['call_1', 'done'],
      ['call_2', 'done'],
      ['call_3', 'failed'],
      ['call_4', 'done'],
      ['call_5', 'done'],
    ]);
    expect(tools[1]!.diff).toBe('--- a//private/tmp/probe-file.txt\n+++ b//private/tmp/probe-file.txt\n@@ -1 +1 @@\n-hello\n+bye\n');
    expect(tools[2]!.error).toBe('File not found: /tmp/nonexistent-zzz');
    expect(tools[0]).toMatchObject({ context: 'planning 1 task(s)', args: { todos: [{ id: 'a' }] } });
    expect(tools[0]!.durationS).toBeGreaterThan(0);
    expect(tools[3]!.output).toContain('Entry added.');
  });

  test('the diff Hermes rendered for a terminal is shown without its colours when the result carries no plain one', () => {
    const complete = event('tool.complete', { tool_id: 't', name: 'patch', args: {}, result: { success: true }, inline_diff: '\u001b[32m+added line\u001b[0m\n' });
    const [tool] = items(foldTurn([], complete));
    expect(tool).toMatchObject({ kind: 'tool', diff: '+added line\n' });
  });

  test('a completion whose start never came still makes a card; one that was cut off by the end of the turn is incomplete, not running', () => {
    expect(items(foldTurn([], event('tool.complete', { tool_id: 'x', name: 'terminal', result: 'ok' })))[0]).toMatchObject({ id: 'x', name: 'terminal', status: 'done', output: 'ok' });
    const cut = endTurn(fold([event('reasoning.delta', { text: 'hm' }), event('tool.start', { tool_id: 'y', name: 'terminal', args: {} })]));
    expect(items(cut).map((item) => (item.kind === 'tool' ? item.status : item.kind === 'reasoning' ? item.streaming : '?'))).toEqual([false, 'incomplete']);
  });

  test('a risk finding on a tool\'s output is on its card; a low risk is not', () => {
    const started = fold([event('tool.start', { tool_id: 'w', name: 'web_extract', args: {} })]);
    const risky = fold([event('tool.output_risk', { tool_id: 'w', name: 'web_extract', risk: 'high', findings: ['prompt injection'], redacted: true })], started);
    expect(items(risky)[0]).toMatchObject({ risk: { level: 'high', findings: ['prompt injection'], redacted: true } });
    expect(items(fold([event('tool.output_risk', { tool_id: 'w', name: 'web_extract', risk: 'low', findings: [], redacted: false })], started))[0]).not.toHaveProperty('risk');
  });
});

describe('reasoning', () => {
  test('streamed chunks of reasoning.delta and of a thinking.delta that is words make one open card; a new card starts after a tool call', () => {
    const turn = fold([
      event('reasoning.delta', { text: 'First ' }),
      event('thinking.delta', { text: 'idea' }),
      event('tool.start', { tool_id: 'a', name: 'terminal', args: {} }),
      event('reasoning.delta', { text: 'Second' }),
    ]);
    expect(items(turn).map((item) => (item.kind === 'reasoning' ? [item.text, item.streaming] : item.kind))).toEqual([['First idea', false], 'tool', ['Second', true]]);
  });

  test('a spinner caption captions the open card and never opens one', () => {
    expect(items(fold([event('thinking.delta', { text: '(⊙_⊙) analyzing...' })]))).toEqual([]);
    const open = fold([event('reasoning.delta', { text: 'hm' }), event('thinking.delta', { text: '( ͡° ͜ʖ ͡°) synthesizing...' })]);
    expect(items(open)[0]).toMatchObject({ text: 'hm', caption: '( ͡° ͜ʖ ͡°) synthesizing...' });
  });

  test('a whole block from a provider that does not stream is a card, unless it is the reply itself or what already streamed', () => {
    expect(items(fold([event('reasoning.available', { text: 'Weighing the options.' })]))[0]).toMatchObject({ kind: 'reasoning', text: 'Weighing the options.', streaming: false });
    expect(items(fold([event('message.delta', { text: 'Done.' }), event('reasoning.available', { text: 'Done.' })]))).toEqual([]);
    expect(items(fold([event('reasoning.delta', { text: 'same' }), event('reasoning.available', { text: 'same' })]))).toHaveLength(1);
  });
});

describe('failures', () => {
  test.each([
    [{ error: 'File not found' }, 'File not found'],
    [{ success: false, message: 'Edit did not apply' }, 'Edit did not apply'],
    [{ success: false }, 'The tool reported a failure.'],
    [{ status: 'error', message: 'timeout' }, 'timeout'],
    ["Tool 'todo' does not exist. Available tools: a, b", "Tool 'todo' does not exist. Available tools: a, b"],
    ['Error: permission denied', 'Error: permission denied'],
    [{ success: true, error: '' }, undefined],
    [{ content: 'fine' }, undefined],
    ['all good', undefined],
  ])('%j', (result, expected) => {
    expect(failureOf(result)).toBe(expected);
  });
});

describe('subagents', () => {
  const payload = { goal: 'Say hi', task_count: 1, task_index: 0, subagent_id: 'sa-1', child_session_id: 'child-1', model: 'm' };

  test('a child starts, reports and finishes; a late line about a finished child does not reopen it', () => {
    let children: readonly SubagentActivity[] = [];
    children = foldSubagents(children, event('subagent.start', { ...payload, text: 'Say hi' }));
    children = foldSubagents(children, event('subagent.tool', { ...payload, tool_name: 'read_file', tool_count: 1 }));
    expect(children).toEqual([expect.objectContaining({ id: 'sa-1', status: 'running', lastTool: 'read_file', toolCount: 1, childSessionId: 'child-1' })]);
    children = foldSubagents(children, event('subagent.complete', { ...payload, status: 'completed', summary: 'Hi!', duration_seconds: 1.5, input_tokens: 20, output_tokens: 10 }));
    children = foldSubagents(children, event('subagent.thinking', { ...payload, text: 'late' }));
    expect(children).toEqual([expect.objectContaining({ status: 'completed', summary: 'Hi!', durationS: 1.5, inputTokens: 20, outputTokens: 10, lastTool: 'read_file', note: 'Say hi' })]);
  });

  test('the card in the transcript shows the child as the session knows it now', () => {
    const turn = fold([event('subagent.start', payload)]);
    const children = foldSubagents([], event('subagent.complete', { ...payload, status: 'failed' }));
    expect(withLiveSubagents(items(turn), children)[0]).toMatchObject({ id: 'sa-1', status: 'failed' });
    expect(withLiveSubagents(items(turn), [])[0]).toMatchObject({ id: 'sa-1', status: 'running' });
  });

  test('Hermes\'s list of running children adds the ones the page missed and keeps what it has seen of the rest', () => {
    const known = foldSubagents([], event('subagent.start', payload));
    const listed = withSnapshots(known, [{ subagent_id: 'sa-1', goal: 'other words' }, { subagent_id: 'sa-2', goal: 'Second', status: 'running', tool_count: 3, last_tool: 'terminal' }]);
    expect(listed.map((child) => [child.id, child.goal])).toEqual([['sa-1', 'Say hi'], ['sa-2', 'Second']]);
    expect(listed[1]).toMatchObject({ toolCount: 3, lastTool: 'terminal' });
  });
});

describe('Hermes\'s stored rows as cards', () => {
  const rows = [
    { id: 1, role: 'user', content: 'go' },
    { id: 2, role: 'assistant', content: 'On it.', reasoning: 'I should look first.', tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"/a"}' } }, { id: 'c2', function: { name: 'delegate_task', arguments: '{"goal":"Dig"}' } }, { id: 'c3', function: { name: 'terminal', arguments: 'not json' } }] },
    { id: 3, role: 'tool', tool_call_id: 'c1', content: '{"error":"File not found: /a"}' },
    { id: 4, role: 'tool', tool_call_id: 'c2', content: '{"status":"dispatched","goals":["Dig"],"subagent_ids":["sa-9"]}' },
    { id: 5, role: 'assistant', content: 'Finished.' },
  ];

  test('reasoning comes before the words of its row and the calls after them; a call takes the row that answers it; a call with no answer is incomplete', () => {
    const entries = entriesOf(rows);
    expect(entries.map((entry) => (entry.kind === 'bubble' ? `${entry.role}:${entry.text}` : entry.items.map((item) => item.kind).join(',')))).toEqual(['user:go', 'reasoning', 'assistant:On it.', 'tool,tool,subagent,tool', 'assistant:Finished.']);
    const calls = (entries[3] as { items: ActivityItem[] }).items;
    expect(calls[0]).toMatchObject({ id: 'c1', name: 'read_file', status: 'failed', error: 'File not found: /a', args: { path: '/a' } });
    expect(calls[1]).toMatchObject({ id: 'c2', name: 'delegate_task', status: 'done', args: { goal: 'Dig' } });
    expect(calls[2]).toMatchObject({ kind: 'subagent', id: 'sa-9', goal: 'Dig', status: 'delegated' });
    expect(calls[3]).toMatchObject({ id: 'c3', status: 'incomplete' });
    expect(calls[3]).not.toHaveProperty('args');
  });

  test('a window that starts after the call that a tool row answers shows no card for the row', () => {
    expect(entriesOf([{ id: 3, role: 'tool', tool_call_id: 'gone', content: 'x' }, { id: 4, role: 'assistant', content: 'ok' }])).toEqual([{ kind: 'bubble', id: 4, role: 'assistant', text: 'ok' }]);
  });

  test('Hermes\'s failed-turn note and its crash-recovery note are marked, so that they are not drawn as an answer and a message of the owner\'s (M1 #12)', () => {
    const notice = 'Your request was not processed. Send it again if you still want me to carry it out.';
    const recovery = '[System note: Your previous turn was interrupted mid-run — the app or its backend process stopped before the turn could finish.]\n\nCount';

    expect(entriesOf([
      { id: 1, role: 'user', content: 'Count' },
      { id: 2, role: 'user', content: recovery },
      { id: 3, role: 'user', content: 'Go on', display_kind: 'auto_continue' },
      { id: 4, role: 'assistant', content: notice },
      { id: 5, role: 'assistant', content: `${notice} (That is what the stub said.)` },
    ])).toEqual([
      { kind: 'bubble', id: 1, role: 'user', text: 'Count' },
      { kind: 'bubble', id: 2, role: 'user', text: recovery, continued: true },
      { kind: 'bubble', id: 3, role: 'user', text: 'Go on', continued: true },
      { kind: 'bubble', id: 4, role: 'assistant', text: notice, failed: true },
      { kind: 'bubble', id: 5, role: 'assistant', text: `${notice} (That is what the stub said.)` },
    ]);
  });
});

describe('todos', () => {
  test('the list Hermes sends; rows that are not tasks are left out and an unknown status is pending', () => {
    expect(todosOf([{ id: 'a', content: 'One', status: 'completed' }, { content: 'Two', status: 'weird' }, 'x', { id: 3 }])).toEqual([
      { id: 'a', content: 'One', status: 'completed' },
      { id: '1', content: 'Two', status: 'pending' },
    ]);
    expect(todosOf(undefined)).toEqual([]);
  });
});

describe('reply footers', () => {
  test('tokens as Hermes counts them; speed is Hermes\'s figure, or output over the time the turn took', () => {
    expect(statsOf({ input: 80, output: 20, total: 100, avg_tps: 42.5 }, 1000)).toEqual({ input: 80, output: 20, total: 100, tps: 42.5 });
    expect(statsOf({ prompt: 10, completion: 30 }, 2000)).toEqual({ input: 10, output: 30, total: 40, tps: 15 });
    expect(statsOf({ model: 'm' }, 1000)).toBeUndefined();
    expect(statsOf({ input: 0, output: 0, total: 0, avg_tps: 0 }, 1000)).toBeUndefined();
    expect(statsOf(undefined, 1000)).toBeUndefined();
    expect(statsOf({ output: 10 }, 0)?.tps).toBeUndefined();
  });
});

describe('activity modes', () => {
  test('each mode maps to Hermes settings, Final only shows no cards, and cards open by themselves only in Stream (a failure is never hidden in a closed card)', () => {
    expect(ACTIVITY_MODES.map((mode) => hermesSettingsFor(mode))).toEqual([
      { details_mode: 'collapsed', tool_progress: 'all' },
      { details_mode: 'expanded', tool_progress: 'all' },
      { details_mode: 'hidden', tool_progress: 'off' },
    ]);
    const ok: ActivityItem = { kind: 'tool', key: 'k', id: 'a', name: 'terminal', status: 'done' };
    const failed: ActivityItem = { ...ok, status: 'failed' };
    expect(shownActivity([ok, failed], 'worklog')).toHaveLength(2);
    expect(shownActivity([ok, failed], 'stream')).toHaveLength(2);
    expect(shownActivity([ok, failed], 'final')).toEqual([]);
    expect([ok, failed].map((item) => ['worklog', 'stream', 'final'].map((mode) => opensByDefault(item, mode as 'worklog')))).toEqual([
      [false, true, false],
      [true, true, true],
    ]);
  });

  test('only the three names are modes', () => {
    expect([parseActivityMode('stream'), parseActivityMode('verbose'), parseActivityMode(undefined)]).toEqual(['stream', undefined, undefined]);
  });
});

describe('notices', () => {
  const complete = (name: string, args: Record<string, unknown>, result: unknown) => event('tool.complete', { tool_id: 't', name, args, result });

  test('saving a memory or a skill is news; reading, removing or failing is not', () => {
    expect(noticeOf(complete('memory', { action: 'add', content: 'Likes tea' }, { success: true }))).toEqual({ tone: 'success', message: 'Memory saved', detail: 'Likes tea' });
    expect(noticeOf(complete('memory', { action: 'replace', content: 'Likes coffee' }, { success: true }))).toMatchObject({ message: 'Memory saved' });
    expect(noticeOf(complete('memory', { action: 'remove' }, { success: true }))).toBeUndefined();
    expect(noticeOf(complete('memory', { action: 'add', content: 'x' }, { success: false, error: 'full' }))).toBeUndefined();
    expect(noticeOf(complete('skill_manage', { action: 'create', name: 'tea' }, { success: true }))).toEqual({ tone: 'success', message: 'Skill saved', detail: 'tea' });
    expect(noticeOf(complete('skill_manage', { action: 'delete', name: 'tea' }, { success: true }))).toBeUndefined();
    expect(noticeOf(complete('terminal', { action: 'add' }, { success: true }))).toBeUndefined();
  });

  test('the summary Hermes\'s background review gives names what it saved; a long one is cut', () => {
    expect(noticeOf(event('review.summary', { text: '💾 Memory updated: likes tea' }))).toEqual({ tone: 'success', message: 'Memory saved', detail: 'Memory updated: likes tea' });
    expect(noticeOf(event('review.summary', { text: '💾 Skill "tea" created' }))).toMatchObject({ message: 'Skill saved' });
    expect(noticeOf(event('review.summary', { text: 'Nothing worth saving' }))).toBeUndefined();
    expect(noticeOf(event('review.summary', { text: `Memory ${'x'.repeat(300)}` }))!.detail).toHaveLength(120);
  });
});
