// Hermes's Mixture-of-Agents presets as Agents › Models › Mixture of Agents reads and writes them, free of the DOM and of React.
// Hermes keeps them in the profile's config (`GET`/`PUT /api/model/moa`); Caduceus keeps nothing of them (D1).

export interface MoaSlot {
  provider: string;
  model: string;
  /** A reference model switched off stays in the preset but is not asked. The aggregator has no such switch. */
  enabled: boolean;
  /** The slot's own reasoning effort, when one is set. */
  reasoningEffort?: string;
}

export interface MoaPreset {
  name: string;
  /** A preset switched off cannot be chosen by a bare `/model <name>`. */
  enabled: boolean;
  references: MoaSlot[];
  aggregator: MoaSlot;
  referenceTemperature: number | undefined;
  aggregatorTemperature: number | undefined;
  /** Seconds a reference model may take; undefined inherits `auxiliary.moa_reference.timeout`. */
  referenceTimeout: number | undefined;
  degradedPolicy: 'loud' | 'silent';
  /** When the reference models run: `user_turn`, `per_iteration` or `every_n:<N>`. */
  fanout: string;
}

export interface Moa {
  defaultPreset: string;
  activePreset: string;
  presets: MoaPreset[];
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function slotOf(value: unknown): MoaSlot {
  const slot = record(value);
  const effort = text(slot.reasoning_effort);
  return { provider: text(slot.provider), model: text(slot.model), enabled: slot.enabled !== false, ...(effort ? { reasoningEffort: effort } : {}) };
}

/** Reads Hermes's answer to `GET /api/model/moa`: the named presets, in Hermes's order, with the default and active ones. */
export function parseMoa(payload: unknown): Moa {
  const body = record(payload);
  const presets = Object.entries(record(body.presets)).map(([name, raw]): MoaPreset => {
    const preset = record(raw);
    return {
      name,
      enabled: preset.enabled !== false,
      references: (Array.isArray(preset.reference_models) ? preset.reference_models : []).map(slotOf),
      aggregator: slotOf(preset.aggregator),
      referenceTemperature: number(preset.reference_temperature),
      aggregatorTemperature: number(preset.aggregator_temperature),
      referenceTimeout: number(preset.reference_timeout),
      degradedPolicy: preset.degraded_reference_policy === 'silent' ? 'silent' : 'loud',
      fanout: text(preset.fanout) || 'user_turn',
    };
  });
  return { defaultPreset: text(body.default_preset), activePreset: text(body.active_preset), presets };
}

/** The preset with the changes the owner made, as the list of presets Hermes is sent (`makeDefault` also makes it the default preset). */
export function savePreset(moa: Moa, preset: MoaPreset, { makeDefault = false }: { makeDefault?: boolean } = {}): Moa {
  const exists = moa.presets.some((candidate) => candidate.name === preset.name);
  return {
    ...moa,
    defaultPreset: makeDefault ? preset.name : moa.defaultPreset,
    presets: exists ? moa.presets.map((candidate) => (candidate.name === preset.name ? preset : candidate)) : [...moa.presets, preset],
  };
}

const slotBody = (slot: MoaSlot, { withEnabled }: { withEnabled: boolean }) => ({
  provider: slot.provider,
  model: slot.model,
  ...(slot.reasoningEffort ? { reasoning_effort: slot.reasoningEffort } : {}),
  ...(withEnabled ? { enabled: slot.enabled } : {}),
});

/** Hermes's `PUT /api/model/moa` (Tier 1) for a whole set of presets: Hermes validates it and refuses an incomplete slot instead of repairing it. */
export function moaSaveRequest(profile: string, moa: Moa): { method: 'PUT'; path: string; body: Record<string, unknown> } {
  return {
    method: 'PUT',
    path: `/api/model/moa?profile=${encodeURIComponent(profile)}`,
    body: {
      default_preset: moa.defaultPreset,
      active_preset: moa.activePreset,
      presets: Object.fromEntries(
        moa.presets.map((preset) => [
          preset.name,
          {
            reference_models: preset.references.map((slot) => slotBody(slot, { withEnabled: true })),
            aggregator: slotBody(preset.aggregator, { withEnabled: false }),
            reference_temperature: preset.referenceTemperature ?? null,
            aggregator_temperature: preset.aggregatorTemperature ?? null,
            reference_timeout: preset.referenceTimeout ?? null,
            degraded_reference_policy: preset.degradedPolicy,
            fanout: preset.fanout,
            enabled: preset.enabled,
          },
        ]),
      ),
    },
  };
}

/**
 * What Hermes would refuse about a preset, in plain words, before it is sent. Hermes rejects an incomplete slot at write time
 * rather than repair it (its read-time tolerance would silently swap the preset for its defaults), so the screen asks first.
 */
export function presetProblems(moa: Moa, preset: MoaPreset, { isNew = false }: { isNew?: boolean } = {}): string[] {
  const problems: string[] = [];
  const name = preset.name.trim();
  if (name === '') problems.push('Give the preset a name.');
  else if (isNew && moa.presets.some((candidate) => candidate.name === name)) problems.push(`There is already a preset called “${name}”.`);
  const slotProblem = (slot: MoaSlot, label: string): string | undefined => {
    if (slot.provider.trim().toLowerCase() === 'moa') return `${label} cannot be a Mixture-of-Agents preset.`;
    if (slot.provider.trim() === '' && slot.model.trim() === '') return `${label} needs a model.`;
    if (slot.provider.trim() === '') return `${label} has no provider.`;
    if (slot.model.trim() === '') return `${label} has no model.`;
    return undefined;
  };
  preset.references.forEach((slot, index) => {
    const problem = slotProblem(slot, `Reference model ${index + 1}`);
    if (problem) problems.push(problem);
  });
  if (preset.references.length === 0) problems.push('Add at least one reference model.');
  else if (!preset.references.some((slot) => slot.enabled)) problems.push('Turn on at least one reference model.');
  const aggregator = slotProblem(preset.aggregator, 'The aggregator');
  if (aggregator) problems.push(aggregator);
  const temperature = (value: number | undefined, label: string) => {
    if (value !== undefined && !(value >= 0 && value <= 2)) problems.push(`The ${label} temperature must be a number from 0 to 2.`);
  };
  temperature(preset.referenceTemperature, 'reference');
  temperature(preset.aggregatorTemperature, 'aggregator');
  if (preset.referenceTimeout !== undefined && !(preset.referenceTimeout > 0)) problems.push('The timeout must be a number of seconds above 0.');
  return problems;
}

export type Removed = { ok: true; moa: Moa } | { ok: false; reason: string };

/**
 * "Delete": the preset is left out of the save, which Hermes 0.22 treats as authoritative (0.21 merged it back over the saved ones, so Delete
 * could only turn a preset off). If it was the default, the first other preset that is on becomes the default; if it was the one picked for
 * the session, nothing is. The last preset, and the last one that is on, cannot be removed.
 */
export function removePreset(moa: Moa, name: string): Removed {
  const preset = moa.presets.find((candidate) => candidate.name === name);
  if (!preset) return { ok: false, reason: `There is no preset called “${name}”.` };
  const remaining = moa.presets.filter((candidate) => candidate.name !== name);
  if (remaining.length === 0) return { ok: false, reason: 'This is the only preset. Add another preset before you remove it.' };
  const successor = remaining.find((candidate) => candidate.enabled);
  if (!successor && preset.enabled) return { ok: false, reason: 'This is the only preset that is on. Add another preset before you remove it.' };
  return {
    ok: true,
    moa: {
      defaultPreset: moa.defaultPreset === name ? (successor ?? remaining[0]).name : moa.defaultPreset,
      activePreset: moa.activePreset === name ? '' : moa.activePreset,
      presets: remaining,
    },
  };
}

export type FanoutMode = 'user_turn' | 'per_iteration' | 'every_n';

/** When the reference models run: once per user turn (the cheapest), at every tool step, or every Nth step. */
export function parseFanout(value: string): { mode: FanoutMode; every: number } {
  if (value === 'per_iteration') return { mode: 'per_iteration', every: 2 };
  const every = /^every_n:(\d+)$/.exec(value);
  if (every && Number(every[1]) >= 2) return { mode: 'every_n', every: Number(every[1]) };
  return { mode: 'user_turn', every: 2 };
}

/** The cadence as Hermes writes it; `every_n:1` is `per_iteration`, as Hermes itself folds it. */
export function fanoutValue({ mode, every }: { mode: FanoutMode; every: number }): string {
  if (mode !== 'every_n') return mode;
  return every >= 2 ? `every_n:${every}` : 'per_iteration';
}
