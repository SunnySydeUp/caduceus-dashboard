import { describe, expect, test } from 'vitest';
import { fillPlaceholders, placeholdersIn, readPlaybook, type Playbook } from '@caduceus/contracts/playbooks';
import { newBriefFields, type BriefFields } from '../src/modules/work/brief-task.ts';
import { emptySections } from '../src/modules/work/brief.ts';
import { answerProblems, duplicateOf, groupTemplates, moveItem, moveItemTo, searchPlaybooks, startFields, stageFields, templateDraft } from '../src/modules/work/template-model.ts';

const BUG: Playbook = {
  id: 'bug-hunt',
  version: 1,
  name: 'Bug hunt',
  category: 'engineering',
  inputs: [
    { key: 'bug', label: 'What is broken?', required: true },
    { key: 'where', label: 'Where?' },
    { key: 'note', label: 'Note', default: 'none yet' },
  ],
  stages: [
    {
      key: 'main',
      title: 'Fix: {{bug}}',
      brief: { goal: 'Fix {{bug}}.', context: 'Seen in: {{where}}\nNote: {{ note }}\nAlways here.', constraints: 'Test first.' },
      assignee: 'coder',
      skills: ['github-code-review'],
      model: 'gpt-5',
      provider: 'openai',
      reasoning_effort: 'high',
      priority: 2,
      max_runtime: '2h',
      max_retries: 3,
      workspace: { kind: 'worktree', branch: 'wt/fix' },
      goal_mode: true,
      goal_max_turns: 9,
      completion_contract: 'acme/widgets',
    },
  ],
  edges: [],
};

describe('placeholders', () => {
  test('{{key}} and {{ key }} are placeholders; other braces are text', () => {
    expect(placeholdersIn('a {{x}} b {{ y_2 }} {{X}} {{x}} {{ }} {x}')).toEqual(['x', 'y_2']);
    expect(fillPlaceholders('{{a}}-{{ b }}-{{c}}', { a: '1', b: '2' })).toBe('1-2-');
  });

  test('an answer that looks like a placeholder is left as typed', () => {
    expect(fillPlaceholders('{{a}} {{b}}', { a: '{{b}}', b: 'B' })).toBe('{{b}} B');
  });
});

describe('starting a task from a template', () => {
  test('the answers fill the title and the sections, and a line whose answer is empty is left out', () => {
    const fields = startFields(BUG, { bug: 'the export drops rows', where: '', note: 'seen twice' });

    expect(fields.title).toBe('Fix: the export drops rows');
    expect(fields.brief).toEqual({ kind: 'sections', sections: { ...emptySections(), goal: 'Fix the export drops rows.', context: 'Note: seen twice\nAlways here.', constraints: 'Test first.' } });
  });

  test('every structured field of the stage becomes the Brief editor’s field, and none of a task’s run state or links comes with it', () => {
    const fields = startFields(BUG, { bug: 'x' });

    expect(fields).toEqual({
      ...newBriefFields(),
      title: 'Fix: x',
      brief: { kind: 'sections', sections: { ...emptySections(), goal: 'Fix x.', context: 'Note: none yet\nAlways here.', constraints: 'Test first.' } },
      assignee: 'coder',
      skills: ['github-code-review'],
      model: 'gpt-5',
      provider: 'openai',
      reasoningEffort: 'high',
      priority: 2,
      maxRuntime: '2h',
      maxRetries: 3,
      workspace: { kind: 'worktree', branch: 'wt/fix' },
      goalMode: true,
      goalMaxTurns: 9,
      completionContract: 'acme/widgets',
    });
    expect(fields.parents).toEqual([]);
    // Nothing in what is sent to Hermes is a category or a tenant.
    expect(JSON.stringify(fields)).not.toMatch(/tenant|category|engineering/);
  });

  test('a required input left empty is a problem; one with a default is not', () => {
    expect(answerProblems(BUG, { bug: '  ', where: '' })).toEqual({ bug: 'Answer “What is broken?”.' });
    expect(answerProblems(BUG, { bug: 'x' })).toEqual({});
  });
});

describe('saving a task as a template', () => {
  const task: BriefFields = {
    ...newBriefFields(),
    title: 'Ship the export',
    brief: { kind: 'sections', sections: { ...emptySections(), goal: 'Ship it.', expected: 'A PR.' } },
    assignee: 'coder',
    skills: ['translation'],
    workspace: { kind: 'dir', path: '/tmp/work' },
    maxRuntime: '30m',
    goalMode: true,
    parents: ['t_1a2b3c4d'],
  };

  test('captures the sections and the fields, without the links to other tasks, as a definition that validates', () => {
    const draft = templateDraft(task, { name: 'Export shipper', category: 'engineering' });

    expect(draft).toEqual({
      name: 'Export shipper',
      category: 'engineering',
      inputs: [],
      stages: [{ key: 'main', title: 'Ship the export', brief: { goal: 'Ship it.', expected: 'A PR.' }, assignee: 'coder', skills: ['translation'], workspace: { kind: 'dir', path: '/tmp/work' }, max_runtime: '30m', goal_mode: true }],
    });
    expect(readPlaybook({ ...draft, id: 'export-shipper', version: 1 }).problems).toBeUndefined();
  });

  test('a template read back gives the same fields (placeholders are kept as typed when none are answered)', () => {
    const draft = templateDraft(task, { name: 'Export shipper', category: 'engineering' });
    const playbook = readPlaybook({ ...draft, id: 'export-shipper', version: 1 }).playbook!;

    expect(stageFields(playbook)).toEqual({ ...task, parents: [] });
  });

  test('a brief that is one free section is kept whole, as the Goal', () => {
    const draft = templateDraft({ ...task, brief: { kind: 'free', text: 'Just do it.\n\n## Acceptance criteria\nIt works.' } }, { name: 'Free', category: 'general' });

    expect(draft.stages[0].brief).toEqual({ goal: 'Just do it.\n\n## Acceptance criteria\nIt works.' });
  });

  test('the placeholders a task’s text already holds become inputs the template asks for', () => {
    const draft = templateDraft({ ...task, title: 'Ship {{feature}}', brief: { kind: 'sections', sections: { ...emptySections(), goal: 'Ship {{feature}} to {{ where }}.' } } }, { name: 'Shipper', category: 'general' });

    expect(draft.inputs).toEqual([
      { key: 'feature', label: 'feature', required: true },
      { key: 'where', label: 'where', required: true },
    ]);
    expect(readPlaybook({ ...draft, id: 'shipper', version: 1 }).problems).toBeUndefined();
  });
});

describe('the library as groups', () => {
  const library = {
    categories: [
      { id: 'general', name: 'General' },
      { id: 'engineering', name: 'Engineering' },
      { id: 'empty', name: 'Empty' },
    ],
    templates: [
      { ...BUG, id: 'a', name: 'A' },
      { ...BUG, id: 'b', name: 'B', category: 'general' },
      { ...BUG, id: 'c', name: 'C', category: 'gone' },
    ],
    problems: [],
  };

  test('templates are grouped by category in the owner’s order, the ones whose category is gone last as Other, and an empty category has a group', () => {
    expect(groupTemplates(library).map((group) => [group.id, group.name, group.templates.map((template) => template.id)])).toEqual([
      ['general', 'General', ['b']],
      ['engineering', 'Engineering', ['a']],
      ['empty', 'Empty', []],
      ['', 'Other', ['c']],
    ]);
  });

  test('moving a category earlier or later, or to a place, keeps every id once', () => {
    expect(moveItem(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveItemTo(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(moveItemTo(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });
});

describe('searching the library', () => {
  const REVIEW: Playbook = {
    id: 'draft-review',
    version: 2,
    name: 'Draft then review',
    description: 'A writer drafts, an editor reviews.',
    category: 'content',
    inputs: [{ key: 'topic', label: 'What is the piece about?', required: true }],
    stages: [
      { key: 'draft', title: 'Write the first draft of {{topic}}', brief: { goal: 'Draft it.' } },
      { key: 'review', title: 'Editor’s pass', brief: { goal: 'Review it.' }, gate: 'approval' },
    ],
    edges: [{ from: 'draft', to: 'review', when: 'on_done' }],
  };
  const items = [BUG, REVIEW];

  test('every word has to be somewhere in the name, the description, a question’s label or a stage’s title, in any case', () => {
    expect(searchPlaybooks(items, 'bug').map((item) => item.id)).toEqual(['bug-hunt']);
    expect(searchPlaybooks(items, 'WRITER editor').map((item) => item.id)).toEqual(['draft-review']);
    expect(searchPlaybooks(items, 'about piece').map((item) => item.id)).toEqual(['draft-review']);
    expect(searchPlaybooks(items, 'first draft').map((item) => item.id)).toEqual(['draft-review']);
    expect(searchPlaybooks(items, 'editor bug')).toEqual([]);
  });

  test('no words keeps everything in the order given, and what a brief says is not searched', () => {
    expect(searchPlaybooks(items, '  ')).toEqual(items);
    expect(searchPlaybooks(items, 'Test first')).toEqual([]);
  });

  test('a copy has no id or version, is named as a copy, and falls back to a category that exists', () => {
    const categories = [{ id: 'general', name: 'General' }];
    const copy = duplicateOf(REVIEW, categories);

    expect(copy).not.toHaveProperty('id');
    expect(copy).not.toHaveProperty('version');
    expect(copy).toMatchObject({ name: 'Draft then review (copy)', category: 'general', edges: REVIEW.edges, stages: REVIEW.stages });
    expect(duplicateOf(REVIEW, [{ id: 'content', name: 'Content' }]).category).toBe('content');
    expect(duplicateOf({ ...REVIEW, name: 'x'.repeat(80) }, categories).name).toHaveLength(80);
  });
});
