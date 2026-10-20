import { describe, expect, test } from 'vitest';
import { categoriesOf, filterSkills, readSkillsView, skillsSearch, UNCATEGORISED, type SkillRow } from '../src/modules/skills/skills-model.ts';

const row = (name: string, extra: Partial<SkillRow> = {}): SkillRow => ({ name, description: '', category: '', enabled: true, usage: 0, provenance: 'agent', ...extra });

const skills: SkillRow[] = [
  row('release-notes', { description: 'Draft release notes from merged pull requests.', category: 'writing' }),
  row('plan', { description: 'Write an implementation plan.', category: 'software-development', provenance: 'bundled', usage: 4 }),
  row('debug', { description: 'Find the root cause of a bug.', category: 'software-development', provenance: 'bundled', enabled: false }),
  row('loose-notes'),
];

describe('the list view in the URL', () => {
  test('reads search, category and state from the query, and ignores what it does not know', () => {
    expect(readSkillsView({ q: 'notes', category: 'writing', state: 'disabled', profile: 'coder', skill: 'plan' })).toEqual({ q: 'notes', category: 'writing', state: 'disabled' });
    expect(readSkillsView({})).toEqual({ q: '', category: '', state: 'all' });
    expect(readSkillsView({ state: 'sideways', q: 4 })).toEqual({ q: '', category: '', state: 'all' });
  });

  test('writes only what differs from the default, so a clean list has a clean address', () => {
    expect(skillsSearch({ q: '', category: '', state: 'all' })).toEqual({});
    expect(skillsSearch({ q: 'notes', category: 'writing', state: 'enabled' })).toEqual({ q: 'notes', category: 'writing', state: 'enabled' });
  });
});

describe('searching and filtering', () => {
  test('search matches a name, a description or a category, ignoring case and spaces at the ends', () => {
    expect(filterSkills(skills, { q: '  NOTES ', category: '', state: 'all' }).map((s) => s.name)).toEqual(['release-notes', 'loose-notes']);
    expect(filterSkills(skills, { q: 'root cause', category: '', state: 'all' }).map((s) => s.name)).toEqual(['debug']);
    expect(filterSkills(skills, { q: 'software', category: '', state: 'all' }).map((s) => s.name)).toEqual(['plan', 'debug']);
  });

  test('a category keeps its skills; the uncategorised ones are a category of their own', () => {
    expect(filterSkills(skills, { q: '', category: 'writing', state: 'all' }).map((s) => s.name)).toEqual(['release-notes']);
    expect(filterSkills(skills, { q: '', category: UNCATEGORISED, state: 'all' }).map((s) => s.name)).toEqual(['loose-notes']);
  });

  test('the state keeps the enabled or the disabled ones', () => {
    expect(filterSkills(skills, { q: '', category: '', state: 'disabled' }).map((s) => s.name)).toEqual(['debug']);
    expect(filterSkills(skills, { q: '', category: 'software-development', state: 'enabled' }).map((s) => s.name)).toEqual(['plan']);
  });

  test('categories are counted over the whole list, sorted, with the uncategorised last', () => {
    expect(categoriesOf(skills)).toEqual([
      { name: 'software-development', count: 2 },
      { name: 'writing', count: 1 },
      { name: UNCATEGORISED, count: 1 },
    ]);
  });
});
