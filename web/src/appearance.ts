// This device's appearance (theme, skin, density, text size) as the page applies it, and how the copy a device keeps
// locally is reconciled with the one Caduceus stores for it. Pure: no DOM, no storage, no network.
import { APPEARANCE_CHOICES, DEFAULT_APPEARANCE, normaliseAppearance, type Appearance } from '@caduceus/contracts/appearance';

/** Where a device keeps its local copy (`localStorage`). `index.html`'s pre-paint script reads the same key. */
export const APPEARANCE_KEY = 'caduceus.appearance';

/** What `auto` density needs to be compact; the media query of the `auto` block of `tokens.css` (a test keeps them equal). */
export const AUTO_COMPACT_QUERY = '(pointer: fine) and (min-width: 64rem)';

/** The attributes of `<html>` that `tokens.css` switches on; `null` means the attribute is absent. */
export type AppearanceAttributes = Record<'data-theme' | 'data-skin' | 'data-density' | 'data-text-scale', string | null>;

export function attributesOf({ theme, skin, density, textSize }: Appearance): AppearanceAttributes {
  return {
    'data-theme': theme,
    'data-skin': skin,
    'data-density': density,
    // 100% is the absence of the attribute (tokens.css scales the root only for sm, lg and xl).
    'data-text-scale': textSize === 'md' ? null : textSize,
  };
}

/** The copy a device keeps in `localStorage` under `APPEARANCE_KEY`. The pre-paint script in `index.html` reads it too. */
export interface LocalAppearance {
  appearance: Appearance;
  /** Changed on this device and not yet saved to Caduceus (the device was offline, say). */
  pending: boolean;
}

/** The local copy a stored string holds; `undefined` when there is none (never stored, or not an appearance). */
export function parseLocal(raw: string | null): LocalAppearance | undefined {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? '');
  } catch {
    return undefined;
  }
  if (typeof stored !== 'object' || stored === null || !('appearance' in stored)) return undefined;
  if (typeof stored.appearance !== 'object' || stored.appearance === null) return undefined;
  return { appearance: normaliseAppearance(stored.appearance), pending: 'pending' in stored && stored.pending === true };
}

export function sameAppearance(a: Appearance, b: Appearance): boolean {
  return (Object.keys(APPEARANCE_CHOICES) as (keyof Appearance)[]).every((choice) => a[choice] === b[choice]);
}

/** What to do after Caduceus has said what it stores for this device. */
export type Reconciliation = { action: 'none' } | { action: 'save'; appearance: Appearance } | { action: 'adopt'; appearance: Appearance };

/**
 * Compares the local copy with what Caduceus stores for the device (`null`: nothing yet).
 * - `save`: send the local copy to Caduceus.
 * - `adopt`: use the stored choices here (apply them and keep them as the local copy).
 *
 * This device is the only writer of its own record, and it writes locally first, so the local copy is the newer one
 * only while it is `pending`. Otherwise Caduceus's record is the device's, which also covers a device whose storage was
 * cleared (browsers may drop a site's script storage after a while) and, the other way round, a device whose cookie
 * was cleared (Caduceus then sees a new device and the local copy is offered to it).
 */
export function reconcile(local: LocalAppearance | undefined, stored: Appearance | null): Reconciliation {
  if (local === undefined) return stored === null ? { action: 'none' } : { action: 'adopt', appearance: stored };
  if (local.pending) return { action: 'save', appearance: local.appearance };
  if (stored === null) return sameAppearance(local.appearance, DEFAULT_APPEARANCE) ? { action: 'none' } : { action: 'save', appearance: local.appearance };
  return sameAppearance(local.appearance, stored) ? { action: 'none' } : { action: 'adopt', appearance: stored };
}
