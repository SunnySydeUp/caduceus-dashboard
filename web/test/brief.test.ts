import { describe, expect, test } from 'vitest';
import { emptySections, parseBrief, serialiseBrief, type BriefSections, type BriefText } from '../src/modules/work/brief.ts';

// The Brief's sections are plain Markdown headings in the task body, the way a worker (or `hermes kanban show`) reads them.
const sections = (patch: Partial<BriefSections>): BriefText => ({ kind: 'sections', sections: { ...emptySections(), ...patch } });

describe('serialising the sections', () => {
  test('writes each filled section under its heading, in the Brief’s order, and leaves out the empty ones', () => {
    const body = serialiseBrief(sections({ constraints: 'No new dependencies.', goal: 'Ship the export.', scope: 'Read-only on production.' }));

    expect(body).toBe('## Goal\n\nShip the export.\n\n## Constraints\n\nNo new dependencies.\n\n## Scope and safety\n\nRead-only on production.\n');
  });

  test('a brief with nothing in it is an empty body', () => {
    expect(serialiseBrief(sections({ goal: '  \n ' }))).toBe('');
  });

  test('the free section is the body exactly as typed', () => {
    expect(serialiseBrief({ kind: 'free', text: '  Do X.\n\n\nThen Y.  ' })).toBe('  Do X.\n\n\nThen Y.  ');
  });
});

describe('reading a body back', () => {
  test('what the sections wrote comes back as the same sections', () => {
    const written = sections({
      goal: 'Ship the export.',
      context: 'The old exporter drops rows.\n\nSee the ticket.',
      references: '- https://example.com/spec\n- src/export.ts',
      constraints: 'No new dependencies.',
      expected: 'A pull request.',
      scope: 'Read-only on production.',
    });

    expect(parseBrief(serialiseBrief(written))).toEqual(written);
  });

  test('headings are matched without regard to case, spaces or a closing hash run', () => {
    expect(parseBrief('## goal\nA\n\n##  Expected   Output ##\nB\n')).toEqual(sections({ goal: 'A', expected: 'B' }));
  });

  test('a section keeps its own sub-headings, lists and code, even a code line that looks like a heading', () => {
    const goal = 'Fix it.\n\n### Why\n\n- one\n- two\n\n```md\n## Context\nnot a heading\n```';

    expect(parseBrief(`## Goal\n\n${goal}\n\n## Context\n\nreal\n`)).toEqual(sections({ goal, context: 'real' }));
  });

  test('a body the CLI wrote (no headings) is one free section, untouched', () => {
    const cli = 'Rotate the keys.\n\nTell me when done.';

    expect(parseBrief(cli)).toEqual({ kind: 'free', text: cli });
    expect(serialiseBrief(parseBrief(cli))).toBe(cli);
  });

  test('text before the first heading, a heading Caduceus does not know, or a repeated one makes the body free, so nothing is lost', () => {
    for (const body of ['Intro\n\n## Goal\nA\n', '## Goal\nA\n\n## Acceptance criteria\nB\n', '## Goal\nA\n\n## Goal\nB\n']) {
      expect(parseBrief(body)).toEqual({ kind: 'free', text: body });
    }
  });

  test('an empty body is an empty brief', () => {
    expect(parseBrief('')).toEqual(sections({}));
    expect(parseBrief(null)).toEqual(sections({}));
  });
});
