import { describe, expect, test } from 'vitest';
import type { ActivityItem, ReasoningActivity, SubagentActivity, ToolActivity } from '../src/modules/chat/activity.ts';
import { summaryOf } from '../src/modules/chat/activity-summary.ts';

// The one line a run of the agent's cards folds into in the thread (M8 #09). Pure: it only counts what the cards already say.
let n = 0;
const tool = (name: string, status: ToolActivity['status'] = 'done'): ToolActivity => ({ kind: 'tool', key: `t${n++}`, id: undefined, name, status });
const helper = (status: SubagentActivity['status'] = 'completed'): SubagentActivity => ({ kind: 'subagent', key: `s${n++}`, id: `s${n}`, goal: 'Check', status });
const thought = (over: Partial<ReasoningActivity> = {}): ReasoningActivity => ({ kind: 'reasoning', key: `r${n++}`, text: 'hm', streaming: false, ...over });

describe('the one line a run of cards folds into', () => {
  test('counts commands, and says how many failed', () => {
    const summary = summaryOf([tool('terminal'), tool('terminal', 'failed'), tool('terminal')]);
    expect(summary).toMatchObject({ text: '3 commands ran, 1 failed', tone: 'failed', count: 3, failed: 1 });
  });

  test('says one command in the singular and has no failure to report when none failed', () => {
    expect(summaryOf([tool('terminal')])).toMatchObject({ text: '1 command ran', tone: 'done', failed: 0 });
  });

  test('calls a run of other tools, or a mix of tools, steps; and helpers helpers', () => {
    expect(summaryOf([tool('read_file'), tool('patch')])?.text).toBe('2 steps ran');
    expect(summaryOf([tool('terminal'), tool('patch')])?.text).toBe('2 steps ran');
    expect(summaryOf([helper(), helper('failed')])?.text).toBe('2 helpers ran, 1 failed');
    expect(summaryOf([helper(), tool('terminal')])?.text).toBe('2 steps ran');
  });

  test('a helper that timed out, errored or was stopped counts as failed', () => {
    for (const status of ['failed', 'error', 'timeout', 'interrupted'] as const) expect(summaryOf([helper(status)])?.failed).toBe(1);
    expect(summaryOf([helper('completed'), helper('delegated')])?.failed).toBe(0);
  });

  test('says how many are still running, and is running while any is', () => {
    expect(summaryOf([tool('terminal'), tool('terminal', 'running')])).toMatchObject({ text: '2 commands, 1 running', tone: 'running', running: 1 });
    expect(summaryOf([tool('terminal', 'generating'), tool('terminal', 'failed')])).toMatchObject({ text: '2 commands, 1 failed, 1 running', tone: 'running' });
    expect(summaryOf([helper('queued')])?.running).toBe(1);
  });

  test('says how many have no result', () => {
    expect(summaryOf([tool('terminal'), tool('terminal', 'incomplete')])).toMatchObject({ text: '2 commands ran, 1 had no result', tone: 'done' });
  });

  test('reasoning alone is one line of its own, and does not count as a step', () => {
    expect(summaryOf([thought()])).toMatchObject({ text: 'Reasoned', tone: 'done', count: 0 });
    expect(summaryOf([thought({ streaming: true })])).toMatchObject({ text: 'Thinking…', tone: 'running' });
    expect(summaryOf([thought(), tool('terminal')])?.text).toBe('1 command ran');
  });

  test('a reasoning card with no words is not a card, so it makes no line', () => {
    expect(summaryOf([thought({ text: '' })])).toBeUndefined();
    expect(summaryOf([])).toBeUndefined();
  });

  test('accepts every card the engine makes', () => {
    const items: ActivityItem[] = [thought(), tool('terminal'), helper()];
    expect(summaryOf(items)?.count).toBe(2);
  });
});
