import { describe, expect, test } from 'vitest';
import { asks, buildPlan, catalogueEligible, copyable, emptyDraft, firstProblemStep, freeName, remaining, startDraft, stepProblems, STEPS, summary, type Baseline, type Draft, type StepResult } from '../src/modules/profiles/builder-model.ts';
import { clearSaved, loadSaved, parseSaved, save } from '../src/modules/profiles/builder-draft.ts';
import { PERSONAS, personaById, personaState } from '../src/modules/profiles/personas.ts';
import type { CatalogEntry, McpServer } from '../src/modules/tools/mcp-model.ts';

const server = (over: Partial<McpServer>): McpServer => ({ name: 'tool', transport: 'http', url: 'http://127.0.0.1:1/mcp', command: undefined, args: [], envNames: [], auth: undefined, enabled: true, filter: undefined, ...over });

const baseline = (over: Partial<Baseline> = {}): Baseline => ({
  source: 'coder',
  soul: 'You are the coder.\n',
  model: { provider: 'openrouter', model: 'anthropic/claude-sonnet' },
  skills: [{ name: 'plan', description: '', enabled: true }],
  servers: [],
  ...over,
});

const draft = (over: Partial<Draft> = {}): Draft => ({ ...emptyDraft({ kind: 'blank' }), name: 'writer', ...over });

describe('the steps', () => {
  test('are five, in the order the owner meets them, ending with the review', () => {
    expect(STEPS.map((step) => step.id)).toEqual(['identity', 'model', 'skills', 'mcps', 'review']);
  });

  test('identity is the step with a name to check: Hermes’s own rules, and a profile that exists', () => {
    expect(stepProblems('identity', draft({ name: '' }), [])).toEqual({ name: 'Enter a name.' });
    expect(stepProblems('identity', draft({ name: 'Bad Name!' }), [])).toEqual({ name: 'Use lowercase letters, numbers, - or _.' });
    expect(stepProblems('identity', draft({ name: 'new' }), [])).toEqual({ name: '“new” cannot be used: Caduceus uses it for the address of the profile builder.' });
    expect(stepProblems('identity', draft({ name: 'Coder' }), ['coder'])).toEqual({ name: 'A profile called “coder” already exists.' });
    expect(stepProblems('identity', draft({ displayName: 'x'.repeat(61) }), [])).toEqual({ displayName: 'Use up to 60 characters.' });
    expect(stepProblems('identity', draft(), [])).toEqual({});
  });

  test('the later steps check what they hold: a skill or a server chosen twice', () => {
    const twice = draft({ hubSkills: [{ identifier: 'official/a', name: 'a' }, { identifier: 'official/a', name: 'a' }], mcpCopy: ['fetch'], mcpCatalogue: ['fetch'] });

    expect(stepProblems('skills', twice, [])).toEqual({ hubSkills: 'A skill is chosen twice.' });
    expect(stepProblems('mcps', twice, [])).toEqual({ mcps: 'A server is chosen twice.' });
    expect(stepProblems('model', twice, [])).toEqual({});
  });

  test('Finish is held at the first step with a problem, so nothing is made half-checked', () => {
    expect(firstProblemStep(draft({ name: '' }), [])).toBe('identity');
    expect(firstProblemStep(draft({ hubSkills: [{ identifier: 'a', name: 'a' }, { identifier: 'a', name: 'a' }] }), [])).toBe('skills');
    expect(firstProblemStep(draft(), [])).toBeUndefined();
  });
});

describe('starting', () => {
  test('from a persona fills the identity and the SOUL, and takes a free name when the persona’s is taken', () => {
    const persona = personaById('pirate')!;

    const fresh = startDraft({ kind: 'persona', persona: 'pirate' }, [], undefined);
    const taken = startDraft({ kind: 'persona', persona: 'pirate' }, ['pirate'], undefined);

    expect(fresh).toMatchObject({ name: 'pirate', displayName: persona.displayName, description: persona.description, soul: persona.soul, model: undefined });
    expect(fresh.soul).toContain('Captain Hermes');
    expect(taken.name).toBe('pirate-2');
  });

  test('as a clone pre-fills the SOUL and the model of the source and suggests a free name', () => {
    const draftOfClone = startDraft({ kind: 'clone', source: 'coder' }, ['coder', 'coder-copy'], baseline());

    expect(draftOfClone).toMatchObject({ name: 'coder-copy-2', soul: 'You are the coder.\n', model: { provider: 'openrouter', model: 'anthropic/claude-sonnet' } });
  });

  test('blank is blank', () => {
    expect(startDraft({ kind: 'blank' }, [], undefined)).toEqual(emptyDraft({ kind: 'blank' }));
  });

  test('freeName makes a name Hermes accepts from anything', () => {
    expect(freeName('My New Agent!', [])).toBe('my-new-agent');
    expect(freeName('work', ['work', 'work-2'])).toBe('work-3');
    expect(freeName('***', [])).toBe('profile');
  });
});

describe('the persona catalogue', () => {
  test('has Hermes’s fourteen built-in personalities, each with a name Hermes accepts and a SOUL', () => {
    expect(PERSONAS.map((persona) => persona.id)).toEqual(['helpful', 'concise', 'technical', 'creative', 'teacher', 'kawaii', 'catgirl', 'pirate', 'shakespeare', 'surfer', 'noir', 'uwu', 'philosopher', 'hype']);
    for (const persona of PERSONAS) {
      expect(stepProblems('identity', draft({ name: persona.id, displayName: persona.displayName, description: persona.description, soul: persona.soul }), [])).toEqual({});
      expect(persona.soul.startsWith(`# ${persona.title}\n`)).toBe(true);
    }
  });

  test('a persona is missing when no profile has its name, which is when it can be restored', () => {
    const pirate = personaById('pirate')!;

    expect(personaState(pirate, ['default', 'work'])).toBe('missing');
    expect(personaState(pirate, ['default', 'pirate'])).toBe('exists');
  });
});

describe('the plan', () => {
  test('makes the profile first and adds only what differs from what Hermes makes', () => {
    const plan = buildPlan(draft({ description: 'Writes.', displayName: 'Scribe', soul: 'You write.\n', model: { provider: 'openrouter', model: 'm1' }, skillsOff: ['plan'], hubSkills: [{ identifier: 'official/x', name: 'x' }], mcpCopy: ['fetch'], mcpCatalogue: ['time'] }), baseline({ source: 'default' }));

    expect(plan.map((step) => step.id)).toEqual(['create', 'description', 'display-name', 'soul', 'model', 'skill-off:plan', 'hub:official/x', 'mcp-copy:fetch', 'mcp-catalogue:time']);
    expect(plan[0]).toMatchObject({ kind: 'create', request: { name: 'writer', cloneFrom: undefined } });
  });

  test('a blank draft is only the profile', () => {
    expect(buildPlan(draft(), undefined).map((step) => step.id)).toEqual(['create']);
  });

  test('a clone is made by Hermes as a copy, and the SOUL, model and servers it already has are not sent again', () => {
    const cloned = draft({ start: { kind: 'clone', source: 'coder' }, name: 'coder-2', soul: 'You are the coder.\n', model: { provider: 'openrouter', model: 'anthropic/claude-sonnet' }, mcpCopy: ['fetch'] });

    expect(buildPlan(cloned, baseline()).map((step) => step.id)).toEqual(['create']);
    expect(buildPlan(cloned, baseline())[0]).toMatchObject({ request: { name: 'coder-2', cloneFrom: 'coder' } });
    expect(buildPlan({ ...cloned, soul: 'Changed.\n', model: { provider: 'openrouter', model: 'other' } }, baseline()).map((step) => step.id)).toEqual(['create', 'soul', 'model']);
  });

  test('the name is lowercase, as Hermes will make it', () => {
    expect(buildPlan(draft({ name: ' Writer ' }), undefined)[0]).toMatchObject({ request: { name: 'writer' } });
  });

  test('says what each step will ask: a typed name for the SOUL, a hub skill and a command server, a confirmation for an HTTP server, nothing for the rest', () => {
    const base = baseline({ servers: [{ server: server({ name: 'web' }), definition: undefined }, { server: server({ name: 'prog', transport: 'stdio', url: undefined, command: 'node', args: ['x.js'] }), definition: undefined }] });
    const plan = buildPlan(draft({ soul: 'x', model: { provider: 'p', model: 'm' }, skillsOff: ['plan'], hubSkills: [{ identifier: 'a', name: 'a' }], mcpCopy: ['web', 'prog'], mcpCatalogue: ['time'] }), base);

    expect(plan.map((step) => [step.id, asks(step, base)])).toEqual([
      ['create', 'nothing'],
      ['soul', 'type'],
      ['model', 'nothing'],
      ['skill-off:plan', 'nothing'],
      ['hub:a', 'type'],
      ['mcp-copy:web', 'confirm'],
      ['mcp-copy:prog', 'type'],
      ['mcp-catalogue:time', 'type'],
    ]);
  });
});

describe('what a run left', () => {
  const plan = buildPlan(draft({ description: 'd', soul: 's', model: { provider: 'p', model: 'm' } }), undefined);
  const results: Record<string, StepResult> = { create: { state: 'done' }, description: { state: 'done' }, soul: { state: 'failed', message: 'Hermes said no.' } };

  test('a retry runs the steps that are not done, in plan order, and not the ones that are', () => {
    expect(remaining(plan, results).map((step) => step.id)).toEqual(['soul', 'model']);
  });

  test('the summary lists what succeeded and what is left with its reason, so no half-built profile is silent', () => {
    const said = summary(plan, results);

    expect(said.done.map((step) => step.id)).toEqual(['create', 'description']);
    expect(said.left.map(({ step, result }) => [step.id, result])).toEqual([['soul', { state: 'failed', message: 'Hermes said no.' }], ['model', undefined]]);
  });
});

describe('which servers can be copied', () => {
  test('a server with no variables and no sign-in can: nothing in it is a value Hermes keeps masked', () => {
    expect(copyable(server({}), undefined)).toBe(true);
    expect(copyable(server({ transport: 'stdio', url: undefined, command: 'node', args: ['a.js'] }), undefined)).toBe(true);
  });

  test('one with variables, a sign-in, headers or another transport cannot', () => {
    expect(copyable(server({ envNames: ['TOKEN'] }), undefined)).toBe(false);
    expect(copyable(server({ auth: 'oauth' }), undefined)).toBe(false);
    expect(copyable(server({}), { headers: { 'X-Key': 'masked' } })).toBe(false);
    expect(copyable(server({ transport: 'sse' }), undefined)).toBe(false);
  });
});

describe('which catalogue entries the builder installs', () => {
  const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({ name: 'time', description: '', source: undefined, transport: 'stdio', authType: 'none', requiredEnv: [], command: 'uvx', args: ['mcp-server-time'], url: undefined, needsInstall: false, installUrl: undefined, bootstrap: [], postInstall: undefined, installed: false, enabled: false, ...over });

  test('one that asks for no value, needs no build and is not in the profile', () => {
    expect(catalogueEligible(entry({}))).toBe(true);
    expect(catalogueEligible(entry({ requiredEnv: [{ name: 'OPTIONAL', prompt: '', required: false }] }))).toBe(true);
  });

  test('not one that needs a key, a build, or is already installed: those are done on Tools & MCP', () => {
    expect(catalogueEligible(entry({ requiredEnv: [{ name: 'API_KEY', prompt: 'Key', required: true }] }))).toBe(false);
    expect(catalogueEligible(entry({ needsInstall: true }))).toBe(false);
    expect(catalogueEligible(entry({ installed: true }))).toBe(false);
  });
});

describe('the builder kept in the tab', () => {
  const kept = { draft: draft({ name: 'writer', soul: 'x', model: { provider: 'p', model: 'm' }, skillsOff: ['plan'], hubSkills: [{ identifier: 'official/a', name: 'a' }], mcpCatalogue: ['time'] }), step: 'skills' as const, results: { create: { state: 'done' } as StepResult, soul: { state: 'failed', message: 'No.' } as StepResult } };

  test('is read back exactly as it was saved, so a reload resumes at the same step with every entry', () => {
    const storage = new Map<string, string>();
    const api = { setItem: (key: string, value: string) => void storage.set(key, value), getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => void storage.delete(key) };

    save(kept, api);

    expect(loadSaved(api)).toEqual(kept);
    clearSaved(api);
    expect(loadSaved(api)).toBeUndefined();
  });

  test('anything that is not a builder’s own save starts the builder afresh', () => {
    expect(parseSaved(null)).toBeUndefined();
    expect(parseSaved('not json')).toBeUndefined();
    expect(parseSaved(JSON.stringify({ ...kept, step: 'nowhere' }))).toBeUndefined();
    expect(parseSaved(JSON.stringify({ ...kept, draft: { ...kept.draft, skillsOff: [1] } }))).toBeUndefined();
    expect(parseSaved(JSON.stringify({ ...kept, draft: { ...kept.draft, start: { kind: 'clone' } } }))).toBeUndefined();
  });

  test('a result it does not know is dropped, so that step simply runs again', () => {
    expect(parseSaved(JSON.stringify({ ...kept, results: { create: { state: 'done' }, soul: { state: 'weird' } } }))?.results).toEqual({ create: { state: 'done' } });
  });
});
