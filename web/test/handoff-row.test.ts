import { describe, expect, test } from 'vitest';
import type { SubagentActivity } from '../src/modules/chat/activity.ts';
import { handoffOf } from '../src/modules/chat/handoff-row.ts';

// A handoff in the thread: one agent asking another (in Hermes, a delegated child agent). The row says only what the delegation event data says.
const child = (over: Partial<SubagentActivity> = {}): SubagentActivity => ({ kind: 'subagent', key: 's1', id: 'sa1', goal: 'Do fake timers behave differently in vitest 4?', status: 'running', ...over });

describe('the handoff row of a delegation', () => {
  test('asks with the goal Hermes sent and has no answer while the helper is still working', () => {
    expect(handoffOf(child())).toEqual({ asked: 'Asked a helper agent', goal: 'Do fake timers behave differently in vitest 4?', state: 'working', answer: undefined });
    expect(handoffOf(child({ status: 'queued' })).state).toBe('working');
    expect(handoffOf(child({ status: 'delegated' })).state).toBe('working');
  });

  test('shows what the helper answered: its summary, or the last thing it said when it left no summary', () => {
    expect(handoffOf(child({ status: 'completed', summary: 'Only useFakeTimers defaults changed.' }))).toMatchObject({ state: 'answered', answer: { label: 'The helper answered', text: 'Only useFakeTimers defaults changed.' } });
    expect(handoffOf(child({ status: 'completed', note: 'Looked at the changelog.' })).answer).toEqual({ label: 'The helper answered', text: 'Looked at the changelog.' });
  });

  test('is an answer with no words, not an invented one, when the helper finished and said nothing', () => {
    expect(handoffOf(child({ status: 'completed' })).answer).toEqual({ label: 'The helper answered', text: '' });
  });

  test('says how a helper that did not finish ended, in words of its own for each end', () => {
    expect(handoffOf(child({ status: 'failed', summary: 'No network.' }))).toMatchObject({ state: 'stopped', answer: { label: 'The helper failed', text: 'No network.' } });
    expect(handoffOf(child({ status: 'error' })).answer?.label).toBe('The helper failed');
    expect(handoffOf(child({ status: 'timeout' })).answer?.label).toBe('The helper timed out');
    expect(handoffOf(child({ status: 'interrupted' })).answer?.label).toBe('The helper was stopped');
  });
});
