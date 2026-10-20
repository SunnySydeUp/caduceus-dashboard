// The chips under the chat composer (M1 #08) and the order and visibility the owner gives them, shared by the server (which validates
// and stores the preference for the owner, so every device shows the same) and the web app (which draws the chips). Hermes does not own it.

/** Every chip the composer has, in Caduceus's own order. */
export const CHIP_IDS = ['profile', 'model', 'reasoning', 'workspace', 'toolsets'] as const;

export type ChipId = (typeof CHIP_IDS)[number];

/** `order` names every chip once; `hidden` is the chips the owner has switched off (they stay in the order, so switching one on puts it back where it was). */
export interface ChipPreference {
  order: ChipId[];
  hidden: ChipId[];
}

export const DEFAULT_CHIPS: ChipPreference = { order: [...CHIP_IDS], hidden: [] };

const isChip = (value: unknown): value is ChipId => (CHIP_IDS as readonly unknown[]).includes(value);

const isList = (value: unknown): value is ChipId[] => Array.isArray(value) && value.every(isChip) && new Set(value).size === value.length;

/** `value` as a chip preference, only if its order names every chip exactly once and its hidden list names chips once each; otherwise `undefined`. */
export function parseChipPreference(value: unknown): ChipPreference | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { order, hidden } = value as Record<string, unknown>;
  if (!isList(order) || order.length !== CHIP_IDS.length || !isList(hidden)) return undefined;
  return { order: [...order], hidden: [...hidden] };
}

/** `value` as a chip preference for a page that must come up whatever it was given: unknown chips are dropped, chips it does not mention are added at the end (a later version may have more). */
export function normaliseChipPreference(value: unknown): ChipPreference {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const named = Array.isArray(record.order) ? record.order.filter(isChip) : [];
  const order = [...new Set(named), ...CHIP_IDS.filter((id) => !named.includes(id))];
  const hidden = Array.isArray(record.hidden) ? [...new Set(record.hidden.filter(isChip))] : [];
  return { order, hidden };
}
