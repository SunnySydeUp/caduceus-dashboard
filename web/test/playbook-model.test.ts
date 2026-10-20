import { describe, expect, test } from 'vitest';
import type { Playbook } from '@caduceus/contracts/playbooks';
import { kindOf, offsetOfLine, outgoingEdges, playbookHits, readCheck, readDetail, runConfirmation, runPath, saveBlock, stageProfiles, yamlNotes } from '../src/modules/work/playbook-model.ts';

const STAGE = { brief: { goal: 'Do it.' } };

const LOOP: Playbook = {
  id: 'build-review',
  version: 3,
  name: 'Build then review',
  description: 'Build, then have it reviewed, and rework until approved.',
  category: 'engineering',
  inputs: [{ key: 'feature', label: 'Which feature?', required: true }],
  stages: [
    { key: 'build', title: 'Build {{feature}}', ...STAGE, max_attempts: 3 },
    { key: 'review', title: 'Review the build', ...STAGE, gate: 'approval' },
    { key: 'ship', title: 'Ship it', ...STAGE },
  ],
  edges: [
    { from: 'build', to: 'review', when: 'on_done' },
    { from: 'review', to: 'ship', when: 'on_approve' },
    { from: 'review', to: 'build', when: 'on_reject' },
  ],
};

const ONE: Playbook = { id: 'bug-hunt', version: 1, name: 'Bug hunt', category: 'engineering', inputs: [], stages: [{ key: 'main', title: 'Fix it', ...STAGE }], edges: [] };

describe('the kind of a definition', () => {
  test('a seed is a seed whatever its shape; otherwise one stage and no edges is a template and anything else a playbook', () => {
    expect(kindOf(LOOP, true)).toBe('seed');
    expect(kindOf(ONE, true)).toBe('seed');
    expect(kindOf(ONE, false)).toBe('template');
    expect(kindOf(LOOP, false)).toBe('playbook');
    expect(kindOf({ stages: ONE.stages, edges: [{ from: 'main', to: 'main', when: 'always' }] }, false)).toBe('playbook');
  });
});

describe('the edges that leave a stage', () => {
  test('they come in the order the definition writes them, each with the title of the stage it leads to', () => {
    expect(outgoingEdges(LOOP, 'review')).toEqual([
      { when: 'on_approve', to: 'ship', title: 'Ship it' },
      { when: 'on_reject', to: 'build', title: 'Build {{feature}}' },
    ]);
  });

  test('a stage nothing leaves has none, and an edge to an unknown stage shows its key', () => {
    expect(outgoingEdges(LOOP, 'ship')).toEqual([]);
    expect(outgoingEdges({ stages: LOOP.stages, edges: [{ from: 'ship', to: 'gone', when: 'always' }] }, 'ship')).toEqual([{ when: 'always', to: 'gone', title: 'gone' }]);
  });
});

describe('what the server answers', () => {
  test('a definition’s detail is read with the shape the page trusts: a valid definition, its YAML, its versions and its warnings', () => {
    const detail = readDetail({ playbook: LOOP, yaml: 'id: build-review\n', seed: false, versions: [1, 2, 3], warnings: [{ stage: 'build', message: 'Hermes has no profile “coder”.', line: 12 }, { stage: 5 }] });

    expect(detail).toEqual({ playbook: LOOP, yaml: 'id: build-review\n', seed: false, versions: [1, 2, 3], warnings: [{ stage: 'build', message: 'Hermes has no profile “coder”.', line: 12 }] });
  });

  test('an answer that is not a definition is refused, and a missing list of versions is the version it holds', () => {
    expect(readDetail({ playbook: { id: 'x' }, yaml: '' })).toBeUndefined();
    expect(readDetail({ playbook: LOOP })).toBeUndefined();
    expect(readDetail({ playbook: LOOP, yaml: '', seed: true })).toMatchObject({ seed: true, versions: [3], warnings: [] });
  });

  test('a check holds errors with or without a line, and warnings by stage', () => {
    expect(readCheck({ errors: [{ line: 4, message: 'edges[0].to: no stage “x”.' }, { message: 'Not valid YAML.' }, 'nope'], warnings: [{ stage: 'a', message: 'No skill.' }] })).toEqual({
      errors: [{ line: 4, message: 'edges[0].to: no stage “x”.' }, { message: 'Not valid YAML.' }],
      warnings: [{ stage: 'a', message: 'No skill.' }],
    });
    expect(readCheck({ error: 'bad-request' })).toBeUndefined();
  });
});

describe('what shows under the YAML editor', () => {
  test('errors come before warnings, each group by line, and what has no line comes last in its group', () => {
    expect(
      yamlNotes({
        errors: [{ message: 'no line' }, { line: 9, message: 'late' }, { line: 2, message: 'early' }],
        warnings: [{ stage: 'a', line: 7, message: 'warned late' }, { stage: 'b', line: 3, message: 'warned early' }],
      }),
    ).toEqual([
      { tone: 'danger', line: 2, message: 'early' },
      { tone: 'danger', line: 9, message: 'late' },
      { tone: 'danger', message: 'no line' },
      { tone: 'warning', line: 3, message: 'warned early' },
      { tone: 'warning', line: 7, message: 'warned late' },
    ]);
  });

  test('a line number is the offset its text starts at, and a line past the end is the end', () => {
    const text = 'a\nbb\nccc';

    expect(offsetOfLine(text, 1)).toBe(0);
    expect(offsetOfLine(text, 2)).toBe(2);
    expect(offsetOfLine(text, 3)).toBe(5);
    expect(offsetOfLine(text, 9)).toBe(text.length);
  });
});

describe('when the YAML view can save', () => {
  const ok = { errors: [], warnings: [] };

  test('it can when the text changed and the server found no error; a warning does not stop it', () => {
    expect(saveBlock({ seed: false, older: false, changed: true, check: ok })).toBeUndefined();
    expect(saveBlock({ seed: false, older: false, changed: true, check: { errors: [], warnings: [{ stage: 'a', message: 'No such skill.' }] } })).toBeUndefined();
  });

  test('a seed and an older version never save, and say why', () => {
    expect(saveBlock({ seed: true, older: false, changed: true, check: ok })).toMatch(/Duplicate it/);
    expect(saveBlock({ seed: false, older: true, changed: true, check: ok })).toMatch(/older version/);
    expect(saveBlock({ seed: true, older: true, changed: true, check: ok })).toMatch(/built-in/);
  });

  test('nothing to save, text the server has not checked yet, and text with errors each say why not', () => {
    expect(saveBlock({ seed: false, older: false, changed: false, check: ok })).toBe('Nothing has changed yet.');
    expect(saveBlock({ seed: false, older: false, changed: true, check: undefined })).toBe('Checking the YAML…');
    expect(saveBlock({ seed: false, older: false, changed: true, check: { errors: [{ message: 'a' }], warnings: [] } })).toBe('Fix the problem under the editor first.');
    expect(saveBlock({ seed: false, older: false, changed: true, check: { errors: [{ message: 'a' }, { message: 'b' }], warnings: [] } })).toBe('Fix the 2 problems under the editor first.');
  });
});

describe('the palette’s search of the library', () => {
  const library = { templates: [ONE, LOOP], seeds: [{ ...LOOP, id: 'software-delivery', name: 'Software Delivery', description: 'Sixteen stages from idea to release.' }] };

  test('a hit is a definition whose name or description has every word, opening its detail page, with its kind and stages', () => {
    expect(playbookHits(library, 'review')).toEqual([
      { id: 'build-review', label: 'Build then review', sub: 'Playbook · 3 stages · Build, then have it reviewed, and rework until approved.', icon: 'playbook', group: 'Playbooks', path: '/work/playbooks/build-review' },
    ]);
    expect(playbookHits(library, 'delivery idea')).toEqual([
      { id: 'software-delivery', label: 'Software Delivery', sub: 'Seed · 3 stages · Sixteen stages from idea to release.', icon: 'playbook', group: 'Playbooks', path: '/work/playbooks/software-delivery' },
    ]);
    expect(playbookHits(library, 'bug')).toEqual([{ id: 'bug-hunt', label: 'Bug hunt', sub: 'Template · 1 stage', icon: 'playbook', group: 'Playbooks', path: '/work/playbooks/bug-hunt' }]);
  });

  test('a stage’s title is not a reason to list a definition in the palette, and the list is capped', () => {
    expect(playbookHits(library, 'ship')).toEqual([]);
    const many = Array.from({ length: 12 }, (_, index) => ({ ...ONE, id: `t-${index}`, name: `Template ${index}` }));
    expect(playbookHits({ templates: many, seeds: [] }, 'template')).toHaveLength(8);
  });
});

describe('starting a run', () => {
  const TEAM: Playbook = {
    ...LOOP,
    stages: [
      { key: 'build', title: 'Build', ...STAGE, assignee: 'coder' },
      { key: 'review', title: 'Review', ...STAGE, assignee: 'reviewer', gate: 'approval' },
      { key: 'rework', title: 'Rework', ...STAGE, assignee: 'coder' },
      { key: 'ship', title: 'Ship', ...STAGE },
    ],
  };

  test('the profiles a run assigns are each named once, in the order the stages name them, and a stage with none is left unassigned', () => {
    expect(stageProfiles(TEAM)).toEqual(['coder', 'reviewer', 'nobody (left unassigned)']);
    expect(stageProfiles(ONE)).toEqual(['nobody (left unassigned)']);
    expect(stageProfiles({ stages: [] })).toEqual([]);
  });

  test('the confirmation names the playbook with its version, how many stages, and the profiles', () => {
    expect(runConfirmation(TEAM)).toEqual({
      title: 'Run “Build then review”?',
      text: 'This starts a run of “Build then review” version 3: 4 stages, each made as a Kanban task when the one before it ends. The tasks are assigned to coder, reviewer and nobody (left unassigned).',
      object: 'Build then review',
      confirmLabel: 'Run',
    });
    expect(runConfirmation(ONE).text).toBe('This starts a run of “Bug hunt” version 1: 1 stage, each made as a Kanban task when the one before it ends. The tasks are assigned to nobody (left unassigned).');
  });

  test('a run started as a profile gives it to the stages that name none, and the confirmation says so', () => {
    expect(stageProfiles(TEAM, 'writer')).toEqual(['coder', 'reviewer', 'writer']);
    expect(runConfirmation(ONE, 'writer').text).toContain('assigned to writer.');
  });

  test('a run’s address names its board unless it is the default one', () => {
    expect(runPath('build-review', 't_ab12')).toBe('/work/playbooks/build-review/runs/t_ab12');
    expect(runPath('build-review', 't_ab12', 'default')).toBe('/work/playbooks/build-review/runs/t_ab12');
    expect(runPath('build-review', 't_ab12', 'client-work')).toBe('/work/playbooks/build-review/runs/t_ab12?board=client-work');
  });
});
