import { describe, expect, test } from 'vitest';
import { isTemplate, readPlaybook, type Playbook, type PlaybookStage } from '@caduceus/contracts/playbooks';
import { SEED_PLAYBOOKS } from '../src/playbook-seeds.ts';
import { SEED_TEMPLATES } from '../src/template-seeds.ts';

// The playbook definition format (M6 #01; work model §2.3), at the pure function the server and the web app both use: `readPlaybook`. A
// one-stage definition is a template and reads as M3 #08 read it; more stages need edges that name them, can all be reached, and bound every loop.
const stage = (key: string, more: Partial<PlaybookStage> = {}): PlaybookStage => ({ key, title: `Stage ${key}`, brief: { goal: `Do ${key}` }, ...more });
const base = { id: 'chain', version: 1, name: 'Chain', category: 'general', inputs: [] };

/** The problems of a definition (and where), or none. */
const problemsOf = (value: unknown) => {
  const reading = readPlaybook(value);
  return reading.problems === undefined ? [] : reading.problems;
};

describe('reading a definition', () => {
  test('a template saved before stages had edges reads unchanged, as a template', () => {
    for (const template of SEED_TEMPLATES) {
      const reading = readPlaybook(JSON.parse(JSON.stringify(template)));
      expect(reading.playbook, template.name).toEqual(template);
      expect(isTemplate(reading.playbook!)).toBe(true);
    }
  });

  test('edges join stages, and an edge without `when` leads on done', () => {
    const reading = readPlaybook({ ...base, stages: [stage('a'), stage('b')], edges: [{ from: 'a', to: 'b' }] });
    expect(reading.playbook?.edges).toEqual([{ from: 'a', to: 'b', when: 'on_done' }]);
    expect(isTemplate(reading.playbook!)).toBe(false);
  });

  test('an edge to a stage that is not there is refused, naming the edge and the stage', () => {
    const reading = readPlaybook({ ...base, stages: [stage('a'), stage('b')], edges: [{ from: 'a', to: 'b', when: 'on_done' }, { from: 'b', to: 'zz', when: 'on_done' }] });
    expect(reading.problems).toEqual(['edges[1].to: there is no stage “zz”.']);
    expect(reading.where).toEqual([['edges', 1, 'to']]);
  });

  test('a stage no edge leads to is refused as unreachable from the first stage', () => {
    expect(problemsOf({ ...base, stages: [stage('a'), stage('b'), stage('c')], edges: [{ from: 'a', to: 'b', when: 'on_done' }] })).toEqual(['stages[2]: “c” cannot be reached from the first stage “a”.']);
  });

  test('a loop needs max_attempts on the stage it comes back to, and bounded loops are accepted', () => {
    const edges = [
      { from: 'a', to: 'b', when: 'on_done' },
      { from: 'b', to: 'a', when: 'on_fail' },
    ];
    const problems = problemsOf({ ...base, stages: [stage('a'), stage('b')], edges });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/“a” is where edges\[1\] loops back to, so it needs max_attempts/);
    expect(readPlaybook({ ...base, stages: [stage('a', { max_attempts: 3 }), stage('b')], edges }).playbook).toBeDefined();
    // A stage that leads to itself is a loop too.
    expect(problemsOf({ ...base, stages: [stage('a')], edges: [{ from: 'a', to: 'a', when: 'on_fail' }] })[0]).toMatch(/needs max_attempts/);
  });

  test('an approval gate leads on approve and reject, any other stage on done and fail', () => {
    const gated = { ...base, stages: [stage('a'), stage('g', { gate: 'approval' }), stage('c')] };
    expect(readPlaybook({ ...gated, edges: [{ from: 'a', to: 'g', when: 'on_done' }, { from: 'g', to: 'c', when: 'on_approve' }] }).playbook).toBeDefined();
    expect(problemsOf({ ...gated, edges: [{ from: 'a', to: 'g', when: 'on_approve' }, { from: 'g', to: 'c', when: 'on_approve' }] })).toEqual(['edges[0]: “a” is not an approval gate, so it leads on on_done, on_fail or always, not on_approve.']);
    expect(problemsOf({ ...gated, edges: [{ from: 'a', to: 'g', when: 'on_done' }, { from: 'g', to: 'c', when: 'on_done' }] })).toEqual(['edges[1]: “g” is an approval gate, so it leads on on_approve, on_reject or always, not on_done.']);
  });

  test('a repeated stage key, a repeated edge, an unknown gate and an unknown key are each refused', () => {
    expect(problemsOf({ ...base, stages: [stage('a'), stage('a')], edges: [] })).toContain('stages[1].key: “a” is used twice.');
    expect(problemsOf({ ...base, stages: [stage('a'), stage('b')], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b', when: 'on_done' }] })).toEqual(['edges[1]: “a” already leads to “b” on on_done.']);
    expect(problemsOf({ ...base, stages: [stage('a', { gate: 'sign' as 'approval' })], edges: [] })).toEqual(['stages[0].gate must be approval or clarify.']);
    expect(problemsOf({ ...base, stages: [{ ...stage('a'), tenant: 'acme' }], edges: [] })).toEqual(['stages[0]: “tenant” is not part of a playbook definition.']);
  });

  test('a placeholder in a later stage needs an input, and the problem names the stage', () => {
    expect(problemsOf({ ...base, stages: [stage('a'), { ...stage('b'), title: 'Do {{topic}}' }], edges: [{ from: 'a', to: 'b' }] })).toEqual(['The stage “b” uses {{topic}}, but no input is called “topic”.']);
  });
});

describe('deliverable stages', () => {
  test('a stage may be marked a deliverable, and only with true', () => {
    expect(readPlaybook({ ...base, stages: [stage('a', { deliverable: true })], edges: [] }).playbook?.stages[0].deliverable).toBe(true);
    expect(problemsOf({ ...base, stages: [{ ...stage('a'), deliverable: false }], edges: [] })).toEqual(['stages[0].deliverable must be true when it is there.']);
  });
});

describe('the seeded playbooks', () => {
  test('every seed reads as it is written, is not a template, and Software delivery has 16 stages', () => {
    expect(SEED_PLAYBOOKS.map((seed) => seed.name)).toEqual(['Software delivery', 'Research → summarise', 'Draft → review', 'Deep Research']);
    for (const seed of SEED_PLAYBOOKS) {
      const reading = readPlaybook(JSON.parse(JSON.stringify(seed)) as Playbook);
      expect(reading.problems, seed.name).toBeUndefined();
      expect(reading.playbook, seed.name).toEqual(seed);
      expect(isTemplate(seed)).toBe(false);
    }
    expect(SEED_PLAYBOOKS[0].stages).toHaveLength(16);
    expect(SEED_PLAYBOOKS.map((seed) => seed.id)).toEqual(['software-delivery', 'research-summarise', 'draft-review', 'deep-research']);
  });
});
