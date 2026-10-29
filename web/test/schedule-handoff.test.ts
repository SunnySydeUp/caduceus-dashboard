import { describe, expect, test } from 'vitest';
import { jobProblems } from '../src/modules/work/job-form.ts';
import { clearSchedule, OFFER_TTL_MS, offerSchedule, scheduleDraftFrom, takeSchedule } from '../src/modules/work/schedule-handoff.ts';

// What the composer's Repeat gives the schedule builder to start from (M8 #06): an agent job with the message as its prompt, for the chat's agent.
describe('the draft Repeat hands to the schedule builder', () => {
  test('it is an agent job for the agent that was talked to, with the message as the prompt and a name taken from its first line', () => {
    const draft = scheduleDraftFrom({ text: 'Summarise the week’s commits.\nKeep it short.', profile: 'coder' });
    expect(draft).toMatchObject({ type: 'agent', profile: 'coder', prompt: 'Summarise the week’s commits.\nKeep it short.', name: 'Summarise the week’s commits.' });
  });

  test('a long first line gives a short name', () => {
    const draft = scheduleDraftFrom({ text: 'word '.repeat(60), profile: 'default' });
    expect(draft.name.length).toBeLessThanOrEqual(60);
    expect(draft.name.endsWith('…')).toBe(true);
  });

  test('the draft is complete: the form has nothing to complain about before the owner confirms', () => {
    const profiles = ['default', 'coder'];
    const draft = scheduleDraftFrom({ text: 'Check the backups', profile: 'coder' });
    const problems = jobProblems(draft, { profiles, blueprints: [], now: Date.parse('2026-10-19T08:00:00Z'), zone: 'UTC' });
    expect(problems).toEqual({});
  });

  test('a profile Hermes no longer lists is not invented: the builder says it is unknown', () => {
    const draft = scheduleDraftFrom({ text: 'Check the backups', profile: 'gone' });
    expect(draft.profile).toBe('gone');
  });

  test('an offer is taken once, by the builder that opens next, and a later offer replaces one nobody took', () => {
    expect(takeSchedule()).toBeUndefined();
    offerSchedule({ text: 'first', profile: 'default' });
    offerSchedule({ text: 'second', profile: 'coder' });
    expect(takeSchedule()).toEqual({ text: 'second', profile: 'coder' });
    expect(takeSchedule()).toBeUndefined();
  });

  test('an offer older than the time limit is not taken, and clearing drops a waiting offer', () => {
    offerSchedule({ text: 'old', profile: 'default' }, 1000);
    expect(takeSchedule(1000 + OFFER_TTL_MS + 1)).toBeUndefined();
    offerSchedule({ text: 'fresh', profile: 'default' }, 1000);
    expect(takeSchedule(1000 + OFFER_TTL_MS)).toEqual({ text: 'fresh', profile: 'default' });
    offerSchedule({ text: 'dropped', profile: 'default' });
    clearSchedule();
    expect(takeSchedule()).toBeUndefined();
  });
});
