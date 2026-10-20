import { describe, expect, test } from 'vitest';
import type { ChatMessage } from '../src/modules/chat/chat-session.ts';
import type { ActivityItem } from '../src/modules/chat/activity.ts';
import { ALL_ROLES, filterItems, findMatches, findUnits, firstAtOrAfter, indexOfMatch, matchId, rolesAnnouncement, stepMatch, transcriptText, type RoleSet } from '../src/modules/chat/transcript-tools.ts';

// The transcript's own tools (M1 #15): role filters, search inside the transcript, and the transcript as text. Pure: they read the items the
// transcript draws (`{ key, message }`).
const tool = (name: string, extra: Partial<Extract<ActivityItem, { kind: 'tool' }>> = {}): ActivityItem => ({ kind: 'tool', key: `tool-${name}`, id: name, name, status: 'done', ...extra });
const reasoning = (text: string): ActivityItem => ({ kind: 'reasoning', key: `reasoning-${text.length}`, text, streaming: false });
const subagent = (goal: string): ActivityItem => ({ kind: 'subagent', key: `subagent-${goal.length}`, id: 'child', goal, status: 'completed', summary: 'Found the report' });
const item = (key: string, message: ChatMessage) => ({ key, message });
const items = [
  item('r1', { id: 1, role: 'user', text: 'Please find the **zeppelin** report' }),
  item('card-1', { role: 'assistant', text: '', activity: [reasoning('The zeppelin is a kind of airship'), tool('search_files', { context: 'reports', output: 'reports/zeppelin.md' }), subagent('Read the zeppelin report')] }),
  item('r2', { id: 2, role: 'assistant', text: 'It is in `reports/zeppelin.md`.' }),
];
const only = (...on: (keyof RoleSet)[]): RoleSet => ({ user: on.includes('user'), assistant: on.includes('assistant'), tool: on.includes('tool'), reasoning: on.includes('reasoning') });

describe('role filters', () => {
  test('a filter that is off hides that role: a run of cards keeps only the cards that are on, and a run with none left goes', () => {
    expect(filterItems(items, ALL_ROLES)).toEqual(items);
    expect(filterItems(items, only('user', 'assistant')).map((entry) => entry.key)).toEqual(['r1', 'r2']);
    const toolsOnly = filterItems(items, only('tool'));
    expect(toolsOnly.map((entry) => entry.key)).toEqual(['card-1']);
    // A subagent is a tool call that delegates: it follows the tool filter.
    expect(toolsOnly[0]!.message.activity!.map((card) => card.kind)).toEqual(['tool', 'subagent']);
    expect(filterItems(items, only('reasoning'))[0]!.message.activity!.map((card) => card.kind)).toEqual(['reasoning']);
    expect(filterItems(items, only())).toEqual([]);
  });
});

describe('search inside the transcript', () => {
  const units = findUnits(items);

  test('every occurrence is a match, in order, whatever the case: in the owner’s words, the reply, and inside the cards (which say which card holds it)', () => {
    const matches = findMatches(units, 'ZEPPELIN');
    expect(matches.map((match) => [units[match.unit]!.itemKey, units[match.unit]!.cardKey, match.occurrence])).toEqual([
      ['r1', undefined, 0],
      ['card-1', 'reasoning-33', 0],
      ['card-1', 'tool-search_files', 0],
      ['card-1', 'subagent-24', 0],
      ['r2', undefined, 0],
    ]);
    // Two in one message are two matches.
    expect(findMatches(findUnits([item('x', { role: 'assistant', text: 'zeppelin and Zeppelin' })]), 'zeppelin').map((match) => match.occurrence)).toEqual([0, 1]);
  });

  test('the words searched are the words shown: Markdown marks are not part of them, and a blank query matches nothing', () => {
    expect(findMatches(units, 'find the zeppelin report')).toHaveLength(1);
    expect(findMatches(units, '**')).toEqual([]);
    expect(findMatches(units, '   ')).toEqual([]);
  });

  test('the filters decide what is searched: a hidden role has no matches', () => {
    expect(findMatches(findUnits(filterItems(items, only('assistant'))), 'zeppelin')).toHaveLength(1);
  });

  test('next and previous go round: past the last is the first, before the first is the last, and with no match there is no place', () => {
    expect(stepMatch(undefined, 5, 1)).toBe(0);
    expect(stepMatch(undefined, 5, -1)).toBe(4);
    expect(stepMatch(4, 5, 1)).toBe(0);
    expect(stepMatch(0, 5, -1)).toBe(4);
    expect(stepMatch(1, 5, 1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBeUndefined();
  });
});

describe('role filters, in words for a screen reader', () => {
  test('says what is shown and what is hidden, using the assistant’s name', () => {
    expect(rolesAnnouncement(ALL_ROLES, 'Hermes')).toBe('Showing everything.');
    expect(rolesAnnouncement(only('user', 'assistant'), 'Atlas')).toBe('Showing your messages and Atlas’s replies. Hiding tool calls and reasoning.');
    expect(rolesAnnouncement(only('tool'), 'Hermes')).toBe('Showing tool calls. Hiding your messages, Hermes’s replies and reasoning.');
    expect(rolesAnnouncement(only(), 'Hermes')).toBe('Everything is hidden.');
  });
});

describe('keeping the place among the matches', () => {
  test('a match is named by where it is, not by its number: older messages loading above it do not move the reader to another one', () => {
    const units = findUnits(items);
    const matches = findMatches(units, 'zeppelin');
    const named = matchId(units, matches[2]!);
    expect(named).toEqual({ itemKey: 'card-1', cardKey: 'tool-search_files', occurrence: 0 });
    const older = [item('r0', { id: 0, role: 'assistant', text: 'A zeppelin, too' }), ...items];
    const moreUnits = findUnits(older);
    expect(indexOfMatch(moreUnits, findMatches(moreUnits, 'zeppelin'), named)).toBe(3);
    expect(indexOfMatch(units, matches, { itemKey: 'gone', occurrence: 0 })).toBeUndefined();
    expect(indexOfMatch(units, matches, undefined)).toBeUndefined();
  });

  test('a search that opens at a message starts at the first match in it or after it, and at the first match when none follows', () => {
    const units = findUnits(items);
    const matches = findMatches(units, 'zeppelin');
    expect(firstAtOrAfter(units, matches, items, 'card-1')).toBe(1);
    expect(firstAtOrAfter(units, matches, items, 'r2')).toBe(4);
    expect(firstAtOrAfter(units, matches, items, undefined)).toBe(0);
    expect(firstAtOrAfter(units, matches, items, 'not-there')).toBe(0);
    expect(firstAtOrAfter(findUnits(items.slice(0, 1)), findMatches(findUnits(items.slice(0, 1)), 'zeppelin'), items.slice(0, 1), 'r1')).toBe(0);
  });
});

describe('the transcript as text', () => {
  const names = { user: 'You', assistant: 'Hermes' };

  test('Markdown keeps each message as it was written, under who said it, with the cards between', () => {
    expect(transcriptText(items, ALL_ROLES, 'markdown', names)).toBe(
      [
        '### You',
        'Please find the **zeppelin** report',
        '#### Reasoning',
        'The zeppelin is a kind of airship',
        '#### Tool: search_files (reports)',
        '```\nreports/zeppelin.md\n```',
        '#### Subagent: Read the zeppelin report',
        'Found the report',
        '### Hermes',
        'It is in `reports/zeppelin.md`.',
      ].join('\n\n'),
    );
  });

  test('plain text has the words and no marks', () => {
    expect(transcriptText(items, ALL_ROLES, 'plain', names)).toBe(
      ['You: Please find the zeppelin report', 'Reasoning: The zeppelin is a kind of airship', 'Tool search_files (reports): reports/zeppelin.md', 'Subagent: Read the zeppelin report: Found the report', 'Hermes: It is in reports/zeppelin.md.'].join('\n\n'),
    );
  });

  test('what the filters hide is not copied', () => {
    expect(transcriptText(items, only('user', 'assistant'), 'plain', names)).toBe('You: Please find the zeppelin report\n\nHermes: It is in reports/zeppelin.md.');
    expect(transcriptText(items, only(), 'markdown', names)).toBe('');
  });
});
