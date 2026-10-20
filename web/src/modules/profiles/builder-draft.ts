// The profile builder's progress, kept in the tab (sessionStorage) so that a reload of the page, or a step to another screen and back, finds the
// builder where it was: the start, every entry, the step, and what each Finish step did (so a retry does not make the profile twice). It is
// the tab's own and ends with it: nothing is sent to Caduceus or Hermes, and a draft holds no secret (the builder asks for none).
import { isRecord } from '@caduceus/contracts/policy/guards';
import { emptyDraft, STEPS, type Draft, type StepId, type StepResult } from './builder-model.ts';

export interface Saved {
  draft: Draft;
  step: StepId;
  results: Record<string, StepResult>;
}

export const BUILDER_KEY = 'caduceus.profile-builder';

const strings = (value: unknown): string[] | undefined => (Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : undefined);

function readStart(value: unknown): Draft['start'] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'blank') return { kind: 'blank' };
  if (value.kind === 'persona' && typeof value.persona === 'string') return { kind: 'persona', persona: value.persona };
  if (value.kind === 'clone' && typeof value.source === 'string') return { kind: 'clone', source: value.source };
  return undefined;
}

function readResult(value: unknown): StepResult | undefined {
  if (!isRecord(value)) return undefined;
  if (value.state === 'done' || value.state === 'cancelled') return { state: value.state };
  if (value.state === 'failed' && typeof value.message === 'string') return { state: 'failed', message: value.message };
  return undefined;
}

/** What `save` wrote, or `undefined` for anything else: a draft from another version of the page starts afresh rather than half-reading. */
export function parseSaved(text: string | null): Saved | undefined {
  if (!text) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(body) || !isRecord(body.draft) || !STEPS.some((step) => step.id === body.step)) return undefined;
  const { draft } = body;
  const start = readStart(draft.start);
  const skillsOff = strings(draft.skillsOff);
  const mcpCopy = strings(draft.mcpCopy);
  const mcpCatalogue = strings(draft.mcpCatalogue);
  const hubSkills = Array.isArray(draft.hubSkills) ? draft.hubSkills.flatMap((skill) => (isRecord(skill) && typeof skill.identifier === 'string' && typeof skill.name === 'string' ? [{ identifier: skill.identifier, name: skill.name }] : [])) : undefined;
  const model = isRecord(draft.model) && typeof draft.model.provider === 'string' && typeof draft.model.model === 'string' ? { provider: draft.model.provider, model: draft.model.model } : undefined;
  if (!start || !skillsOff || !mcpCopy || !mcpCatalogue || !hubSkills) return undefined;
  if (typeof draft.name !== 'string' || typeof draft.displayName !== 'string' || typeof draft.description !== 'string' || typeof draft.soul !== 'string') return undefined;
  const results: Record<string, StepResult> = {};
  if (isRecord(body.results)) for (const [id, result] of Object.entries(body.results)) {
    const read = readResult(result);
    if (read) results[id] = read;
  }
  return { draft: { ...emptyDraft(start), name: draft.name, displayName: draft.displayName, description: draft.description, soul: draft.soul, model, skillsOff, hubSkills, mcpCopy, mcpCatalogue }, step: body.step as StepId, results };
}

export function loadSaved(storage: Pick<Storage, 'getItem'> = sessionStorage): Saved | undefined {
  try {
    return parseSaved(storage.getItem(BUILDER_KEY));
  } catch {
    return undefined;
  }
}

export function save(saved: Saved, storage: Pick<Storage, 'setItem'> = sessionStorage): void {
  try {
    storage.setItem(BUILDER_KEY, JSON.stringify(saved));
  } catch {
    // A tab that cannot keep it (private mode, a full quota) builds without being able to resume: nothing is lost that was there.
  }
}

export function clearSaved(storage: Pick<Storage, 'removeItem'> = sessionStorage): void {
  try {
    storage.removeItem(BUILDER_KEY);
  } catch {
    // Nothing was kept, so nothing is left.
  }
}
