import { describe, expect, test } from 'vitest';
import { createOutlineBuilder } from '../src/modules/chat/outline.ts';

const transcript = [
  { key: 'm1', role: 'user' as const, text: 'Plan the migration\nand mention the risks' },
  { key: 'm2', role: 'assistant' as const, text: '# Migration plan\n\nIntro.\n\n## Steps\n\n```md\n# not a heading\n```\n\n#### too deep\n\n### Risks `high`' },
  { key: 'm3', role: 'user' as const, text: 'x'.repeat(200) },
  { key: 'm4', role: 'assistant' as const, text: 'No headings here.' },
];

describe('conversation outline', () => {
  test('lists each prompt, then the headings of the reply that answers it, down to level 3, in order', () => {
    const outline = createOutlineBuilder()(transcript);
    expect(outline.map((entry) => [entry.kind, entry.key, entry.level, entry.label])).toEqual([
      ['prompt', 'm1', 0, 'Plan the migration and mention the risks'],
      ['heading', 'm2', 1, 'Migration plan'],
      ['heading', 'm2', 2, 'Steps'],
      ['heading', 'm2', 3, 'Risks high'],
      ['prompt', 'm3', 0, `${'x'.repeat(79)}…`],
    ]);
  });

  test('a heading says which element of its message to scroll to', () => {
    const outline = createOutlineBuilder()(transcript);
    expect(outline.filter((entry) => entry.kind === 'heading').map((entry) => entry.anchor)).toEqual(['migration-plan', 'steps', 'risks-high']);
    expect(outline.find((entry) => entry.kind === 'prompt')?.anchor).toBeUndefined();
  });

  test('a half-streamed last reply gives its headings so far; the same text is not parsed twice', () => {
    const build = createOutlineBuilder();
    const streaming = [{ key: 'm9', role: 'assistant' as const, text: '## Now\n\nand the sec' }];
    expect(build(streaming).map((entry) => entry.label)).toEqual(['Now']);
    expect(build([...streaming, { key: 'm10', role: 'assistant' as const, text: '## Now\n\nand the sec' }]).map((entry) => entry.label)).toEqual(['Now', 'Now']);
  });
});
