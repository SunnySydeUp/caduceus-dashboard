// What Agents › Models asks Hermes to change and how it reads Hermes's answers, free of the DOM and of React. Every request here goes
// out through `fetchTiered` (`model-actions.ts`), which asks the tier the policy map gives the route; Caduceus keeps nothing of
// what it sends or reads (D1). `?profile=` names the profile a screen works on, so a change lands in that profile's config.yaml.
import type { ModelChoice } from './model-catalogue.ts';

/** A Hermes request as `fetchTiered` takes it, before its confirmation text is added. */
export interface HermesRequest {
  method: 'POST' | 'PUT';
  /** The Hermes path with its query, exactly as it is sent. */
  path: string;
  body: Record<string, unknown>;
}

const scoped = (route: string, profile: string) => `${route}?profile=${encodeURIComponent(profile)}`;

/**
 * Hermes's model set for the main slot (Tier 1). Hermes warns before it assigns a model it prices above its own threshold: it
 * answers `confirm_required` and writes nothing, and the same request with `confirmExpensive` assigns it.
 */
export function mainModelRequest(profile: string, choice: ModelChoice, { confirmExpensive = false }: { confirmExpensive?: boolean } = {}): HermesRequest {
  return {
    method: 'POST',
    path: scoped('/api/model/set', profile),
    body: { scope: 'main', provider: choice.provider, model: choice.model, ...(confirmExpensive ? { confirm_expensive_model: true } : {}) },
  };
}

/** What Hermes's model set said: it assigned the model, or it wants the owner to confirm its warning first. */
export type SetAnswer = { kind: 'saved' } | { kind: 'confirm'; message: string };

export function readSetAnswer(body: unknown): SetAnswer {
  const answer = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (answer.confirm_required === true) return { kind: 'confirm', message: typeof answer.confirm_message === 'string' ? answer.confirm_message : 'Hermes asks you to confirm this model.' };
  return { kind: 'saved' };
}

export interface AuxiliarySlot {
  /** Hermes's name for the slot: `title_generation`. */
  task: string;
  provider: string;
  model: string;
  /** Nothing is pinned: Hermes chooses (it follows the main model, or its own cheap default). */
  isAuto: boolean;
  /** The slot's own reasoning effort, when the owner has set one. */
  reasoningEffort: string | undefined;
}

export interface Auxiliary {
  slots: AuxiliarySlot[];
  main: ModelChoice;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Reads `GET /api/model/auxiliary`: every slot Hermes reports, in its order, and the main model. */
export function parseAuxiliary(payload: unknown): Auxiliary {
  const body = record(payload);
  const slots = (Array.isArray(body.tasks) ? body.tasks : []).flatMap((item): AuxiliarySlot[] => {
    const slot = record(item);
    const task = text(slot.task);
    if (task === '') return [];
    const provider = text(slot.provider) || 'auto';
    const model = text(slot.model);
    return [{ task, provider, model, isAuto: provider === 'auto' && model === '', reasoningEffort: text(slot.reasoning_effort) || undefined }];
  });
  const main = record(body.main);
  return { slots, main: { provider: text(main.provider), model: text(main.model) } };
}

/** The reasoning efforts Hermes accepts (its schema's list for a reasoning effort), with the words the screen uses. An empty one is "not set". */
export const REASONING_LEVELS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Provider default' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
  { value: 'ultra', label: 'Ultra' },
];

/**
 * The profile's default reasoning effort: a config write (`PUT /api/config`, Tier 3, so the profile's name is typed to confirm).
 * Hermes merges what it is sent over the profile's config, so only this one key changes.
 */
export function reasoningRequest(profile: string, effort: string): HermesRequest {
  return { method: 'PUT', path: scoped('/api/config', profile), body: { config: { agent: { reasoning_effort: effort } } } };
}

/** The default reasoning effort in `GET /api/config`; empty when the profile sets none. YAML's `false` is Hermes's "thinking off". */
export function readReasoning(config: unknown): string {
  const effort = record(record(config).agent).reasoning_effort;
  if (effort === false) return 'none';
  return typeof effort === 'string' ? effort : '';
}

/** The choice that puts an auxiliary slot back on auto: Hermes chooses the model. */
export const AUTO: ModelChoice = { provider: 'auto', model: '' };

/**
 * Hermes's model set for one auxiliary slot (Tier 1); only that slot changes. Choosing `AUTO` puts it back on auto. Like the main
 * slot, a model Hermes warns about is assigned only when sent again with `confirmExpensive`.
 */
export function auxiliaryModelRequest(profile: string, task: string, choice: ModelChoice, { confirmExpensive = false }: { confirmExpensive?: boolean } = {}): HermesRequest {
  return {
    method: 'POST',
    path: scoped('/api/model/set', profile),
    body: { scope: 'auxiliary', task, provider: choice.provider, model: choice.model, ...(confirmExpensive ? { confirm_expensive_model: true } : {}) },
  };
}

/** "Reset all to auto" (Tier 1): every slot back to auto, with no model, endpoint or effort of its own. Hermes keeps their other settings. */
export function resetAuxiliaryRequest(profile: string): HermesRequest {
  return { method: 'POST', path: scoped('/api/model/set', profile), body: { scope: 'auxiliary', task: '__reset__', provider: '', model: '' } };
}

/** Hermes's recommended default model for a provider (`GET /api/model/recommended-default`), for a profile that has none set. */
export const recommendedDefaultPath = (profile: string, provider: string) => `${scoped('/api/model/recommended-default', profile)}&provider=${encodeURIComponent(provider)}`;

/** The recommendation in Hermes's answer; `undefined` when Hermes has none for the provider (its model is empty). */
export function readRecommended(body: unknown): ModelChoice | undefined {
  const answer = record(body);
  const model = text(answer.model);
  return model === '' ? undefined : { provider: text(answer.provider), model };
}

export interface ModelInfoBadge {
  id: 'tools' | 'vision' | 'reasoning';
  label: string;
}

/** What Hermes knows about the model a profile uses (`GET /api/model/info`). */
export interface ModelInfo {
  model: string;
  provider: string;
  /** The context window Hermes uses, in tokens; 0 when it does not know. */
  contextWindow: number;
  /** The most the model can write in one reply, in tokens, as the model catalogue says; 0 when it does not say. Hermes has no setting for it. */
  maxOutput: number;
  badges: ModelInfoBadge[];
}

/** Reads Hermes's model info; `undefined` when the profile has no model set. */
export function readModelInfo(body: unknown): ModelInfo | undefined {
  const info = record(body);
  const model = text(info.model);
  if (model === '') return undefined;
  const capabilities = record(info.capabilities);
  const badges: ModelInfoBadge[] = [];
  if (capabilities.supports_tools === true) badges.push({ id: 'tools', label: 'Tools' });
  if (capabilities.supports_vision === true) badges.push({ id: 'vision', label: 'Vision' });
  if (capabilities.supports_reasoning === true) badges.push({ id: 'reasoning', label: 'Reasoning' });
  const count = (value: unknown) => (typeof value === 'number' && value > 0 ? value : 0);
  return { model, provider: text(info.provider), contextWindow: count(info.effective_context_length), maxOutput: count(capabilities.max_output_tokens), badges };
}

const SLOT_WORDS: Record<string, { label: string; summary: string }> = {
  vision: { label: 'Vision', summary: 'Describes images and screenshots for models that cannot see them.' },
  compression: { label: 'Compression', summary: 'Summarises a long conversation to make room in the context window.' },
  skills_hub: { label: 'Skills hub', summary: 'Reads and vets skills from the hub.' },
  approval: { label: 'Approval', summary: 'Judges risky commands when approvals are on smart mode. A fast, cheap model suits it.' },
  mcp: { label: 'MCP', summary: 'Answers MCP servers that ask the agent’s model to do something.' },
  title_generation: { label: 'Title generation', summary: 'Names new sessions.' },
  review: { label: 'Review', summary: 'Runs the /review reviewer.' },
  triage_specifier: { label: 'Triage specifier', summary: 'Expands a one-line Kanban triage note into a spec.' },
  kanban_decomposer: { label: 'Kanban decomposer', summary: 'Splits a Kanban task into child tasks.' },
  profile_describer: { label: 'Profile describer', summary: 'Writes a profile’s short description (Auto-describe).' },
  curator: { label: 'Curator', summary: 'Reviews skill usage and tidies the skill library.' },
};

/** The words for a slot Hermes reports. A slot Hermes adds that the screen has no words for is named from its id, so it still shows. */
export function slotWords(task: string): { label: string; summary: string | undefined } {
  const known = SLOT_WORDS[task];
  if (known) return known;
  const spaced = task.replaceAll('_', ' ');
  return { label: spaced.charAt(0).toUpperCase() + spaced.slice(1), summary: undefined };
}
