// What a device chooses in Settings › Appearance (design-system §4.1), shared by the server (which validates and stores
// it per device) and the web app (which applies it to `<html>`). Hermes does not own it.

/** Every value each choice may take; the first is not necessarily the default (see `DEFAULT_APPEARANCE`). */
export const APPEARANCE_CHOICES = {
  /** `system` follows the operating system's light or dark setting. */
  theme: ['light', 'dark', 'system'],
  /** Desk is the default (The Desk redesign); Nous was the default before it and Hermes Teal is the old dashboard's look. */
  skin: ['desk', 'nous', 'hermes', 'gold', 'cherenkov', 'verdant', 'mono'],
  /** `auto` is compact only for a fine pointer on a window at least 64 rem wide. */
  density: ['auto', 'compact', 'comfortable'],
  /** A percentage of the browser's own text size: small 93.75%, medium 100%, large 112.5%, extra large 125%. */
  textSize: ['sm', 'md', 'lg', 'xl'],
} as const;

export type Appearance = { [Choice in keyof typeof APPEARANCE_CHOICES]: (typeof APPEARANCE_CHOICES)[Choice][number] };

export const DEFAULT_APPEARANCE: Appearance = { theme: 'system', skin: 'desk', density: 'auto', textSize: 'md' };

const CHOICES = Object.keys(APPEARANCE_CHOICES) as (keyof Appearance)[];

const isChoice = <Name extends keyof Appearance>(name: Name, value: unknown): value is Appearance[Name] =>
  (APPEARANCE_CHOICES[name] as readonly unknown[]).includes(value);

/** `value` as an appearance, only if it names every choice with a value that exists; otherwise `undefined`. */
export function parseAppearance(value: unknown): Appearance | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const appearance: Record<string, unknown> = {};
  for (const name of CHOICES) {
    if (!isChoice(name, record[name])) return undefined;
    appearance[name] = record[name];
  }
  return appearance as unknown as Appearance;
}

/**
 * `value` as an appearance, keeping each valid choice and defaulting the rest. For copies kept on a device, where a
 * value may be missing or from another version, and the page must still come up.
 */
export function normaliseAppearance(value: unknown): Appearance {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const appearance: Record<string, unknown> = {};
  for (const name of CHOICES) appearance[name] = isChoice(name, record[name]) ? record[name] : DEFAULT_APPEARANCE[name];
  return appearance as unknown as Appearance;
}
