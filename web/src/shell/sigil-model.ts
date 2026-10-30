// A sigil is a profile's mark: four cells in a 2 x 2 square and one hue, both chosen from the profile's name alone, so a profile looks the same on every
// screen and device. Hermes keeps no look for a profile and Caduceus keeps none either. Pure: no DOM and no React.
import type { IconName } from '../icons.tsx';
import type { CrewStateName } from '../modules/crew/crew-state.ts';

/** The shapes a cell can take: a full square, a circle, a square with one round corner (top left, top right, bottom left, bottom right), or empty. */
export const SIGIL_CELLS = ['sq', 'c', 'tl', 'tr', 'bl', 'br', 'e'] as const;
export type SigilCell = (typeof SIGIL_CELLS)[number];

/** How many hues the stylesheet defines (`--cd-sigil-1` … `--cd-sigil-7`). */
export const SIGIL_HUES = 7;

export interface SigilMark {
  /** Top left, top right, bottom left, bottom right. */
  pattern: readonly [SigilCell, SigilCell, SigilCell, SigilCell];
  /** 1 to `SIGIL_HUES`. */
  hue: number;
}

/** A 32-bit hash of the name and a salt (FNV-1a, then mixed so that near names, `coder` and `coder2`, land far apart). */
function hashOf(name: string, salt: number): number {
  let hash = (2166136261 ^ salt) >>> 0;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  hash = Math.imul(hash, 0x5bd1e995) >>> 0;
  return (hash ^ (hash >>> 15)) >>> 0;
}

/** The salt of the hue's hash. Another value would repaint every profile; this one keeps the owner's five profiles on five different hues (`sigil-model.test.ts`). */
const HUE_SALT = 13;

/** A pattern needs at least this many filled cells, or the mark reads as a blank tile. */
const MIN_FILLED = 2;

export function sigilFor(name: string): SigilMark {
  let pattern: SigilMark['pattern'];
  // A name that hashes to a near-blank pattern is hashed again with the next salt; the same name always takes the same steps.
  for (let attempt = 0; ; attempt++) {
    const bits = hashOf(name, 17 + attempt);
    pattern = [0, 1, 2, 3].map((cell) => SIGIL_CELLS[Math.floor(bits / SIGIL_CELLS.length ** cell) % SIGIL_CELLS.length]) as unknown as SigilMark['pattern'];
    if (pattern.filter((cell) => cell !== 'e').length >= MIN_FILLED) break;
  }
  return { pattern, hue: (hashOf(name, HUE_SALT) % SIGIL_HUES) + 1 };
}

/**
 * The ring around a sigil and the badge on its corner for each state: a ring of its own kind and a badge icon of its own, so colour is never the only signal.
 * Waiting for you never blinks: its ring is steady. Running is the only state that moves: its ring is a faint full track with a soft sheen that travels round it
 * (no run has a progress to show, so the ring is never partly full).
 */
export const SIGIL_STATE_MARKS: Record<CrewStateName, { ring: 'steady' | 'sheen' | 'solid' | 'dashed' | 'none'; icon: IconName | undefined }> = {
  waiting: { ring: 'steady', icon: 'waiting' },
  working: { ring: 'sheen', icon: 'running' },
  done: { ring: 'solid', icon: 'succeeded' },
  blocked: { ring: 'dashed', icon: 'failed' },
  idle: { ring: 'none', icon: undefined },
};
