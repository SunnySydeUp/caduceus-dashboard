// The profile builder (M4 #12), free of the DOM and of React: what the owner has entered (the draft), what each step checks, what a new
// profile starts with, and the plan Finish carries out in Hermes (ordered steps, each a Hermes call that other tickets already make).
// Nothing here is stored: the draft lives in the tab (see `builder-draft.ts`), and the profile and everything in it are Hermes's (D1).
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { ModelChoice } from '../models/model-catalogue.ts';
import { formOf, type CatalogEntry, type McpServer } from '../tools/mcp-model.ts';
import { personaById, type Persona } from './personas.ts';
import { renameProblem } from './profiles-model.ts';

export type StepId = 'identity' | 'model' | 'skills' | 'mcps' | 'review';

export const STEPS: readonly { id: StepId; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'model', label: 'Model' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcps', label: 'MCP servers' },
  { id: 'review', label: 'Review' },
];

/** How the profile starts: empty, from a persona of the catalogue, or as a clone of a profile Hermes has. */
export type Start = { kind: 'blank' } | { kind: 'persona'; persona: string } | { kind: 'clone'; source: string };

/** A skill of the hub the owner chose to install after the profile is made (its identifier is Hermes's). */
export interface HubPick {
  identifier: string;
  name: string;
}

export interface Draft {
  start: Start;
  /** The profile's name: Hermes's id for it, and the name on the command line. */
  name: string;
  /** What chat headers call the assistant (Caduceus's own preference for the profile); may be empty. */
  displayName: string;
  /** The profile description Hermes keeps; may be empty. */
  description: string;
  /** The text of SOUL.md. Empty leaves Hermes's own. */
  soul: string;
  /** The main model; `undefined` leaves what Hermes gives the profile. */
  model: ModelChoice | undefined;
  /** Installed skills the new profile gets switched off. */
  skillsOff: string[];
  hubSkills: HubPick[];
  /** Servers of the source profile (a blank or persona start: the default profile) to add to the new one. */
  mcpCopy: string[];
  /** Entries of Hermes's MCP catalogue to install in the new profile. */
  mcpCatalogue: string[];
}

/** What a new profile starts with, as Hermes would make it: read from Hermes, so a step can say what changes. */
export interface Baseline {
  /** The profile the starting SOUL, model, skills and servers are read from: the clone's source, or `default`. */
  source: string;
  soul: string;
  model: ModelChoice | undefined;
  skills: { name: string; description: string; enabled: boolean }[];
  /** The source's MCP servers, with their definitions in its config. */
  servers: { server: McpServer; definition: Readonly<Record<string, unknown>> | undefined }[];
}

export const emptyDraft = (start: Start): Draft => ({ start, name: '', displayName: '', description: '', soul: '', model: undefined, skillsOff: [], hubSkills: [], mcpCopy: [], mcpCatalogue: [] });

/** The first name from `base` that no profile has: `base`, then `base-2`, `base-3`… */
export function freeName(base: string, taken: readonly string[]): string {
  const root = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/-+$/, '').slice(0, 56) || 'profile';
  if (!taken.includes(root)) return root;
  for (let n = 2; ; n++) if (!taken.includes(`${root}-${n}`)) return `${root}-${n}`;
}

/**
 * The draft a start begins with. A persona fills in the identity and SOUL; a clone takes the source's SOUL and model (Hermes copies the
 * rest when it makes the profile, so the draft only needs what the owner may change).
 */
export function startDraft(start: Start, taken: readonly string[], baseline: Baseline | undefined, persona: Persona | undefined = start.kind === 'persona' ? personaById(start.persona) : undefined): Draft {
  const draft = emptyDraft(start);
  if (start.kind === 'persona' && persona) return { ...draft, name: freeName(persona.id, taken), displayName: persona.displayName, description: persona.description, soul: persona.soul };
  if (start.kind === 'clone') return { ...draft, name: freeName(`${start.source}-copy`, taken), soul: baseline?.soul ?? '', model: baseline?.model };
  return draft;
}

const MAX_DISPLAY_NAME = 60;
const MAX_DESCRIPTION = 400;
/** A SOUL is read into every conversation: Hermes has no limit, but one this long is a mistake. */
const MAX_SOUL = 60_000;

export type StepProblems = Partial<Record<'name' | 'displayName' | 'description' | 'soul' | 'model' | 'hubSkills' | 'mcps', string>>;

/** What is wrong with a step's entries, by field; empty when the owner may go on. Hermes has the last word on each. */
export function stepProblems(step: StepId, draft: Draft, taken: readonly string[]): StepProblems {
  const problems: StepProblems = {};
  if (step === 'identity') {
    const name = renameProblem('', draft.name, taken);
    if (name) problems.name = name;
    if (draft.displayName.trim().length > MAX_DISPLAY_NAME) problems.displayName = `Use up to ${MAX_DISPLAY_NAME} characters.`;
    if (draft.description.length > MAX_DESCRIPTION) problems.description = `Use up to ${MAX_DESCRIPTION} characters.`;
    if (draft.soul.length > MAX_SOUL) problems.soul = 'This SOUL is far longer than an agent can use well. Shorten it.';
  }
  if (step === 'skills' && new Set(draft.hubSkills.map((skill) => skill.identifier)).size !== draft.hubSkills.length) problems.hubSkills = 'A skill is chosen twice.';
  if (step === 'mcps' && new Set([...draft.mcpCopy, ...draft.mcpCatalogue]).size !== draft.mcpCopy.length + draft.mcpCatalogue.length) problems.mcps = 'A server is chosen twice.';
  return problems;
}

/** The first step whose entries have a problem (so Finish cannot be pressed past one), or `undefined`. */
export function firstProblemStep(draft: Draft, taken: readonly string[]): StepId | undefined {
  return STEPS.find((step) => Object.keys(stepProblems(step.id, draft, taken)).length > 0)?.id;
}

/** Whether a server of the source can be added to a new profile by its definition: nothing in it is a value Hermes keeps masked. */
export function copyable(server: McpServer, definition: Readonly<Record<string, unknown>> | undefined): boolean {
  if (server.transport !== 'stdio' && server.transport !== 'http') return false;
  if (server.envNames.length > 0 || server.auth !== undefined) return false;
  return !(isRecord(definition?.headers) && Object.keys(definition.headers).length > 0);
}

/**
 * Whether a catalogue entry can be installed by the builder: it asks the owner for no value (a key or a client secret is typed on the
 * Tools & MCP screen, where it is masked) and it needs no build (Hermes runs that as a background action with a log of its own).
 */
export const catalogueEligible = (entry: CatalogEntry): boolean => !entry.installed && !entry.needsInstall && entry.requiredEnv.every((spec) => !spec.required);

/** One thing Finish does in Hermes. `id` is stable, so a retry knows which steps are done. */
export type PlanStep =
  | { id: 'create'; label: string; kind: 'create'; request: { name: string; cloneFrom: string | undefined } }
  | { id: 'description'; label: string; kind: 'description'; text: string }
  | { id: 'display-name'; label: string; kind: 'display-name'; text: string }
  | { id: 'soul'; label: string; kind: 'soul'; text: string }
  | { id: 'model'; label: string; kind: 'model'; choice: ModelChoice }
  | { id: `skill-off:${string}`; label: string; kind: 'skill-off'; skill: string }
  | { id: `hub:${string}`; label: string; kind: 'hub'; skill: HubPick }
  | { id: `mcp-copy:${string}`; label: string; kind: 'mcp-copy'; server: string }
  | { id: `mcp-catalogue:${string}`; label: string; kind: 'mcp-catalogue'; entry: string };

/** What a step of the plan needs of the owner while it runs: nothing, a confirmation of its tier, or a typed name. */
export type Asks = 'nothing' | 'confirm' | 'type';

/**
 * Finish as an ordered list of Hermes calls. Only what differs from what Hermes makes is in it: a blank or persona start has Hermes's
 * SOUL, no model and its bundled skills; a clone has the source's. The profile is made first; the rest are the calls the other tickets make.
 */
export function buildPlan(draft: Draft, baseline: Baseline | undefined): PlanStep[] {
  const name = draft.name.trim().toLowerCase();
  const clone = draft.start.kind === 'clone' ? draft.start.source : undefined;
  const plan: PlanStep[] = [{ id: 'create', kind: 'create', label: clone ? `Create ${name} as a copy of ${clone}` : `Create the profile ${name}`, request: { name, cloneFrom: clone } }];
  if (draft.description.trim() !== '') plan.push({ id: 'description', kind: 'description', label: 'Save the description', text: draft.description.trim() });
  if (draft.displayName.trim() !== '') plan.push({ id: 'display-name', kind: 'display-name', label: `Set the assistant name to “${draft.displayName.trim()}”`, text: draft.displayName.trim() });
  if (draft.soul.trim() !== '' && draft.soul !== (baseline?.soul ?? '')) plan.push({ id: 'soul', kind: 'soul', label: 'Write SOUL.md', text: draft.soul });
  if (draft.model && (draft.model.provider !== baseline?.model?.provider || draft.model.model !== baseline?.model?.model)) plan.push({ id: 'model', kind: 'model', label: `Use ${draft.model.model} as the main model`, choice: draft.model });
  for (const skill of draft.skillsOff) plan.push({ id: `skill-off:${skill}`, kind: 'skill-off', label: `Switch off the skill ${skill}`, skill });
  for (const skill of draft.hubSkills) plan.push({ id: `hub:${skill.identifier}`, kind: 'hub', label: `Install the hub skill ${skill.name}`, skill });
  // A clone already has the source's servers: only the copy of a blank or persona start is a step.
  if (!clone) for (const server of draft.mcpCopy) plan.push({ id: `mcp-copy:${server}`, kind: 'mcp-copy', label: `Add the MCP server ${server}`, server });
  for (const entry of draft.mcpCatalogue) plan.push({ id: `mcp-catalogue:${entry}`, kind: 'mcp-catalogue', label: `Install the MCP server ${entry} from the catalogue`, entry });
  return plan;
}

/**
 * What each step asks the owner while it runs, so the Review step can say it before Finish: the profile is made on Finish itself (the
 * Review step is its confirmation); SOUL, a hub skill and a command server are typed names; an HTTP server asks for a passkey.
 */
export function asks(step: PlanStep, baseline: Baseline | undefined): Asks {
  switch (step.kind) {
    case 'soul':
    case 'hub':
    case 'mcp-catalogue':
      return 'type';
    case 'mcp-copy': {
      const found = baseline?.servers.find((candidate) => candidate.server.name === step.server);
      return found?.server.transport === 'stdio' ? 'type' : 'confirm';
    }
    default:
      return 'nothing';
  }
}

/** The form a copied server is added with: the source's own definition, which has no values to lose (`copyable`). */
export function copyForm(baseline: Baseline, name: string) {
  const found = baseline.servers.find((candidate) => candidate.server.name === name);
  return found ? formOf(found.server, found.definition) : undefined;
}

/** How each step of a run ended. A step that is not in the record has not run. */
export type StepResult = { state: 'done' } | { state: 'failed'; message: string } | { state: 'cancelled' };

/** Which steps still need to run: all that are not done, in plan order. A retry runs exactly these. */
export const remaining = (plan: readonly PlanStep[], results: Readonly<Record<string, StepResult>>): PlanStep[] => plan.filter((step) => results[step.id]?.state !== 'done');

/** What a run came to, in words for the owner: what succeeded and what is left, never a silent half. */
export function summary(plan: readonly PlanStep[], results: Readonly<Record<string, StepResult>>): { done: PlanStep[]; left: { step: PlanStep; result: StepResult | undefined }[] } {
  return {
    done: plan.filter((step) => results[step.id]?.state === 'done'),
    left: remaining(plan, results).map((step) => ({ step, result: results[step.id] })),
  };
}
