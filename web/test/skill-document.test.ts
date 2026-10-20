import { describe, expect, test } from 'vitest';
import { checkSkill, checkSkillIdentity, joinSkill, newSkillText, splitSkill } from '../src/modules/skills/skill-document.ts';

// A SKILL.md with frontmatter keys the page does not know, in an order of the author's: a comment, a folded value, a nested block, a list.
const WITH_UNKNOWN_KEYS = `---
name: release-notes
description: Draft release notes from merged pull requests.
zeta: 1   # a comment the author kept
version: 2.1.0
metadata:
  hermes:
    tags: [writing, git]
    related_skills:
      - plan
alpha: >-
  folded text
  over two lines
---

# Release notes

Steps go here.
`;

describe('splitting a SKILL.md', () => {
  test('the frontmatter and the body join back into exactly the text they came from, with the keys unknown to the page in their order', () => {
    const parts = splitSkill(WITH_UNKNOWN_KEYS)!;
    expect(parts.frontmatter.split('\n').map((line) => line.split(':')[0])).toEqual(['name', 'description', 'zeta', 'version', 'metadata', '  hermes', '    tags', '    related_skills', '      - plan', 'alpha', '  folded text', '  over two lines']);
    expect(parts.body).toBe('\n# Release notes\n\nSteps go here.\n');
    expect(joinSkill(parts)).toBe(WITH_UNKNOWN_KEYS);
  });

  test('editing the body leaves every byte of the frontmatter as it was; editing the frontmatter leaves the body', () => {
    const parts = splitSkill(WITH_UNKNOWN_KEYS)!;
    const edited = joinSkill({ ...parts, body: '\n# Release notes\n\nA different step.\n' });
    expect(edited.slice(0, edited.indexOf('\n# Release'))).toBe(WITH_UNKNOWN_KEYS.slice(0, WITH_UNKNOWN_KEYS.indexOf('\n# Release')));
    const renamed = joinSkill({ ...parts, frontmatter: parts.frontmatter.replace('2.1.0', '2.2.0') });
    expect(renamed).toBe(WITH_UNKNOWN_KEYS.replace('2.1.0', '2.2.0'));
  });

  test('a byte-order mark, Windows line ends and trailing spaces on the fences come back as they were', () => {
    for (const text of ['\uFEFF---\nname: a\ndescription: b\n---\nBody\n', '---\r\nname: a\r\ndescription: b\r\n---\r\nBody\r\n', '--- \nname: a\ndescription: b\n---  \nBody\n', '---\n---\nBody\n']) {
      expect(joinSkill(splitSkill(text)!), JSON.stringify(text)).toBe(text);
    }
  });

  test('text without frontmatter, or whose frontmatter is not closed, does not split', () => {
    expect(splitSkill('# Just markdown\n')).toBeUndefined();
    expect(splitSkill('---\nname: a\ndescription: b\n')).toBeUndefined();
  });
});

describe('checking a SKILL.md before it is saved', () => {
  const frontmatter = (inner: string, body = '\nBody.\n') => `---\n${inner}\n---\n${body}`;

  test('a skill Hermes would take passes, and so does one with keys the page does not know', async () => {
    expect(await checkSkill(WITH_UNKNOWN_KEYS, { isNew: false })).toBeUndefined();
    expect(await checkSkill(frontmatter('name: a\ndescription: Short one.'), { isNew: true })).toBeUndefined();
  });

  test.each([
    ['', 'Content cannot be empty.'],
    ['   \n', 'Content cannot be empty.'],
    ['# No frontmatter\n', 'SKILL.md must start with YAML frontmatter (---). See existing skills for format.'],
    ['---\nname: a\ndescription: b\n', 'SKILL.md frontmatter is not closed. Ensure you have a closing \'---\' line.'],
    [frontmatter('- just\n- a list'), 'Frontmatter must be a YAML mapping (key: value pairs).'],
    [frontmatter('description: no name'), 'Frontmatter must include \'name\' field.'],
    [frontmatter('name: no-description'), 'Frontmatter must include \'description\' field.'],
    [frontmatter('name: a\ndescription: b', '\n  \n'), 'SKILL.md must have content after the frontmatter (instructions, procedures, etc.).'],
    [frontmatter(`name: a\ndescription: ${'x'.repeat(1025)}`), 'Description exceeds 1024 characters.'],
  ])('refuses %j with Hermes\'s own reason', async (text, reason) => {
    expect(await checkSkill(text, { isNew: false })).toBe(reason);
  });

  test('a frontmatter that is not YAML is refused with where it went wrong', async () => {
    const reason = await checkSkill(frontmatter('name: a\ndescription: [unclosed'), { isNew: false });
    expect(reason).toMatch(/^YAML frontmatter parse error: /);
  });

  test('a new skill must have a short description (Hermes\'s 60-character budget for its skill index); an existing one is left as it is', async () => {
    const long = frontmatter(`name: a\ndescription: ${'x'.repeat(61)}`);
    expect(await checkSkill(long, { isNew: true })).toMatch(/^Description is 61 chars/);
    expect(await checkSkill(long, { isNew: false })).toBeUndefined();
  });

  test('a SKILL.md over Hermes\'s size limit is refused', async () => {
    expect(await checkSkill(frontmatter('name: a\ndescription: b', 'y'.repeat(100_001)), { isNew: false })).toMatch(/^SKILL\.md content is 100,0\d\d characters \(limit: 100,000\)/);
  });
});

describe('a new skill\'s name and category', () => {
  test('a name is lowercase letters, digits, dots, hyphens and underscores, starting with a letter or digit, at most 64 long', () => {
    expect(checkSkillIdentity({ name: 'release-notes_2.0', category: '' })).toBeUndefined();
    expect(checkSkillIdentity({ name: '', category: '' })).toBe('Skill name is required.');
    expect(checkSkillIdentity({ name: 'Release Notes', category: '' })).toMatch(/^Invalid skill name 'Release Notes'\. Use lowercase letters, numbers, hyphens, dots, and underscores\./);
    expect(checkSkillIdentity({ name: '-a', category: '' })).toMatch(/^Invalid skill name/);
    expect(checkSkillIdentity({ name: 'a'.repeat(65), category: '' })).toBe('Skill name exceeds 64 characters.');
  });

  test('a category is one folder name, or nothing', () => {
    expect(checkSkillIdentity({ name: 'a', category: 'writing' })).toBeUndefined();
    expect(checkSkillIdentity({ name: 'a', category: '  ' })).toBeUndefined();
    expect(checkSkillIdentity({ name: 'a', category: 'a/b' })).toMatch(/^Invalid category 'a\/b'\./);
  });
});

describe('writing a new SKILL.md', () => {
  test('puts name and description first, quotes what YAML would misread, and then the keys the owner added, untouched', async () => {
    const text = await newSkillText({ name: 'release-notes', description: 'Draft notes: from PRs, #fast.', extra: 'version: 1.0.0\nmetadata:\n  tags: [a]', body: '# Release notes\n\nSteps.\n' });
    expect(text).toBe('---\nname: release-notes\ndescription: \'Draft notes: from PRs, #fast.\'\nversion: 1.0.0\nmetadata:\n  tags: [a]\n---\n\n# Release notes\n\nSteps.\n');
    expect(await checkSkill(text, { isNew: true })).toBeUndefined();
  });

  test('with no extra keys it is just the two', async () => {
    expect(await newSkillText({ name: 'a', description: 'b', extra: '', body: 'Body.\n' })).toBe('---\nname: a\ndescription: b\n---\n\nBody.\n');
  });
});
