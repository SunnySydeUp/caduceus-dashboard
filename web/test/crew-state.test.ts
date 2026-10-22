import { describe, expect, test } from 'vitest';
import type { LiveRun, InboxApproval, InboxClarify, InboxNotice } from '@caduceus/contracts/inbox';
import type { ReadyItem } from '@caduceus/contracts/today';
import { crewStateLabel, deriveCrew, type CrewInput, type CrewMember } from '../src/modules/crew/crew-state.ts';

// What each agent of the crew is doing, from what Hermes and Caduceus already say. Pure: nothing is read or stored here.
const approval = (profile: string | undefined, command: string, at: number): InboxApproval => ({
  kind: 'approval',
  group: 'decision',
  ref: `approval:${command}`,
  stamp: '',
  category: 'approvals',
  id: `approval:${command}`,
  profile,
  sessionId: 'rt1',
  storedSessionId: 'stored-1',
  sessionTitle: 'Release',
  at,
  tool: 'terminal',
  command,
  description: '',
  choices: ['once', 'session', 'always', 'deny'],
});
const clarify = (profile: string, questions: string[], at: number): InboxClarify => ({
  kind: 'clarify',
  group: 'decision',
  ref: `clarify:${questions[0]}`,
  stamp: '',
  category: 'questions',
  id: `clarify:${questions[0]}`,
  profile,
  sessionId: 'rt2',
  storedSessionId: undefined,
  sessionTitle: 'Heating',
  at,
  questions: questions.map((question, index) => ({ qid: `q${index}`, question, choices: [], multiSelect: false })),
  expiresAt: undefined,
});
const failure = (profile: string | undefined, title: string, at: number): InboxNotice => ({
  kind: 'notice',
  group: 'failed',
  ref: `notice:${title}`,
  stamp: '',
  category: 'automation',
  id: `notice:${title}`,
  profile,
  at,
  title,
  detail: undefined,
  actions: [],
  link: undefined,
});
const run = (profile: string | undefined, title: string, since: number, status: LiveRun['status'] = 'running'): LiveRun => ({ sessionId: `rt-${title}`, storedSessionId: title, title, profile, status, since });
const finished = (profile: string | undefined, title: string, at: number): ReadyItem => ({ id: `run:${title}`, stamp: String(at), kind: 'run', title, summary: undefined, profile, at, to: `/chat/${title}` });

const NOTHING: CrewInput = { profiles: [], items: [], running: [], ready: [] };
const crew = (change: Partial<CrewInput>): CrewMember[] => deriveCrew({ ...NOTHING, profiles: ['coder', 'general'], ...change });
const of = (members: CrewMember[], profile: string): CrewMember => members.find((member) => member.profile === profile)!;

describe('an idle crew', () => {
  test('has one member per profile, in the order given, idle with no time', () => {
    expect(crew({ profiles: ['general', 'coder', 'property'] })).toEqual([
      { profile: 'general', state: 'idle', line: 'Nothing going on', since: undefined },
      { profile: 'coder', state: 'idle', line: 'Nothing going on', since: undefined },
      { profile: 'property', state: 'idle', line: 'Nothing going on', since: undefined },
    ]);
  });

  test('is empty with no profiles', () => {
    expect(deriveCrew(NOTHING)).toEqual([]);
  });
});

describe('waiting', () => {
  test('is a profile with an approval open: it says what it wants to run and since when', () => {
    const members = crew({ items: [approval('coder', 'git push origin feat/x', 5000)] });

    expect(of(members, 'coder')).toEqual({ profile: 'coder', state: 'waiting', line: 'Wants to run git push origin feat/x', since: 5000 });
    expect(of(members, 'general').state).toBe('idle');
  });

  test('is a profile with a question open: the line is the question', () => {
    const members = crew({ items: [clarify('general', ['Heating while you are away?'], 7000)] });

    expect(of(members, 'general')).toEqual({ profile: 'general', state: 'waiting', line: 'Heating while you are away?', since: 7000 });
  });

  test('says how many more are open and since when the oldest has waited', () => {
    const members = crew({ items: [approval('coder', 'make deploy', 9000), clarify('coder', ['Which tag?', 'Which region?'], 4000), approval('coder', 'rm -rf build', 6000)] });

    expect(of(members, 'coder')).toEqual({ profile: 'coder', state: 'waiting', line: 'Which tag? (and 1 more question) · 2 more waiting', since: 4000 });
  });

  test('keeps a long command to one short line', () => {
    const [member] = crew({ profiles: ['coder'], items: [approval('coder', `echo ${'a'.repeat(200)}`, 1)] });

    expect(member!.line.length).toBeLessThanOrEqual(64);
    expect(member!.line.startsWith('Wants to run echo aaa')).toBe(true);
    expect(member!.line.endsWith('…')).toBe(true);
  });

  test('is also a live run stopped on a decision, when its request is not in the list yet', () => {
    const members = crew({ running: [run('coder', 'Release notes', 3000, 'waiting')] });

    expect(of(members, 'coder')).toEqual({ profile: 'coder', state: 'waiting', line: 'Waiting for you in “Release notes”', since: 3000 });
  });

  test('ignores an item no profile can be named for, and a profile that is not in the crew', () => {
    const members = crew({ items: [approval(undefined, 'make deploy', 1), approval('stranger', 'make deploy', 2)] });

    expect(members.map((member) => member.state)).toEqual(['idle', 'idle']);
  });

  test('has words of its own', () => {
    expect(crewStateLabel.waiting).toBe('Waiting for you');
  });
});

describe('working', () => {
  test('is a profile with a live run: it names the run and since when it started', () => {
    const members = crew({ running: [run('general', 'Plumber quotes', 8000)] });

    expect(of(members, 'general')).toEqual({ profile: 'general', state: 'working', line: 'Working on “Plumber quotes”', since: 8000 });
    expect(of(members, 'coder').state).toBe('idle');
  });

  test('says how many other runs go on, and counts from the oldest', () => {
    const members = crew({ running: [run('coder', 'Newer', 9000), run('coder', 'Older', 2000), run('general', 'Elsewhere', 1)] });

    expect(of(members, 'coder')).toEqual({ profile: 'coder', state: 'working', line: 'Working on “Older” · 1 more running', since: 2000 });
  });

  test('says only that it works when the run has no title', () => {
    expect(of(crew({ running: [run('coder', '', 100)] }), 'coder').line).toBe('Working');
  });

  test('is never taken from a run that is stopped on the owner: that profile is waiting', () => {
    const members = crew({ running: [run('coder', 'Release', 100, 'waiting'), run('coder', 'Docs', 200)] });

    expect(of(members, 'coder').state).toBe('waiting');
  });
});

describe('blocked', () => {
  test('is a profile with a failure: the line is what failed', () => {
    const members = crew({ items: [failure('coder', 'Gave up: Fix the build', 4000), failure(undefined, 'Gateway is down', 1)] });

    expect(of(members, 'coder')).toEqual({ profile: 'coder', state: 'blocked', line: 'Gave up: Fix the build', since: 4000 });
    expect(of(members, 'general').state).toBe('idle');
  });

  test('says how many more failed, and shows the newest failure', () => {
    const members = crew({ items: [failure('coder', 'Nightly backup failed', 1000), failure('coder', 'Gave up: Fix the build', 4000)] });

    expect(of(members, 'coder')).toEqual({ profile: 'coder', state: 'blocked', line: 'Gave up: Fix the build · 1 more failed', since: 4000 });
  });
});

describe('done', () => {
  test('is a profile with finished work ready for review: the newest, and when', () => {
    const members = crew({ ready: [finished('general', 'Lease letter', 9000)] });

    expect(of(members, 'general')).toEqual({ profile: 'general', state: 'done', line: 'Finished “Lease letter”', since: 9000 });
    expect(of(members, 'coder').state).toBe('idle');
  });

  test('says how many more are ready', () => {
    const members = crew({ ready: [finished('coder', 'C', 30), finished('general', 'G', 20), finished('coder', 'B', 10)] });

    expect(of(members, 'coder')).toEqual({ profile: 'coder', state: 'done', line: 'Finished “C” · 1 more finished', since: 30 });
  });

  test('work that names no profile is nobody’s', () => {
    expect(crew({ ready: [finished(undefined, 'Orphan', 10)] }).map((member) => member.state)).toEqual(['idle', 'idle']);
  });
});

describe('precedence', () => {
  const everything = {
    items: [failure('coder', 'Gave up', 10), approval('coder', 'make deploy', 20)],
    running: [run('coder', 'Release', 30)],
    ready: [finished('coder', 'Docs', 40)],
  };

  test('waiting beats working, blocked and done', () => {
    expect(of(crew(everything), 'coder')).toMatchObject({ state: 'waiting', line: 'Wants to run make deploy', since: 20 });
  });

  test('working beats blocked and done', () => {
    expect(of(crew({ ...everything, items: [failure('coder', 'Gave up', 10)] }), 'coder')).toMatchObject({ state: 'working', since: 30 });
  });

  test('blocked beats done', () => {
    expect(of(crew({ ...everything, items: [failure('coder', 'Gave up', 10)], running: [] }), 'coder')).toMatchObject({ state: 'blocked', line: 'Gave up' });
  });

  test('done beats idle', () => {
    expect(of(crew({ ...everything, items: [], running: [] }), 'coder')).toMatchObject({ state: 'done' });
  });

  test('one profile’s state never leaks into another’s', () => {
    const members = crew({ items: [approval('coder', 'make deploy', 1)], running: [run('general', 'Plumber', 2)] });

    expect(members.map((member) => [member.profile, member.state])).toEqual([['coder', 'waiting'], ['general', 'working']]);
  });

  test('does not change its input', () => {
    const items = [approval('coder', 'b', 2), approval('coder', 'a', 1)];
    const copy = structuredClone(items);

    crew({ items });

    expect(items).toEqual(copy);
  });
});
