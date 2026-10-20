// What a device asked to be told (M2 #03): reading a change to its settings, strictly. A value that is not one of the allowed ones refuses the whole change;
// nothing is half-applied.
import { DEFAULT_PUSH_SETTINGS, PUSH_CATEGORIES, type PushCategory, type PushDigest, type PushSettings } from '@caduceus/contracts/push';
import { isRecord } from '@caduceus/contracts/policy/guards';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIGESTS: readonly PushDigest[] = ['off', 'hourly', 'daily'];
const MAX_OVERRIDES = 200;

const validZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/**
 * `current` with `patch` applied, or `undefined` when the patch holds anything that is not a setting. A category or an override that is named is
 * changed and the rest stay; an override given as `null` goes (the source follows its category again).
 */
export function applySettings(current: PushSettings, patch: unknown): PushSettings | undefined {
  if (!isRecord(patch)) return undefined;
  const next: PushSettings = { ...current, categories: { ...current.categories }, quietHours: { ...current.quietHours }, overrides: { ...current.overrides } };
  if (patch.categories !== undefined) {
    if (!isRecord(patch.categories)) return undefined;
    for (const [name, on] of Object.entries(patch.categories)) {
      if (!(name in PUSH_CATEGORIES) || typeof on !== 'boolean') return undefined;
      next.categories[name as PushCategory] = on;
    }
  }
  if (patch.quietHours !== undefined) {
    const quiet = patch.quietHours;
    if (!isRecord(quiet)) return undefined;
    if (quiet.enabled !== undefined) {
      if (typeof quiet.enabled !== 'boolean') return undefined;
      next.quietHours.enabled = quiet.enabled;
    }
    for (const edge of ['start', 'end'] as const) {
      const time = quiet[edge];
      if (time === undefined) continue;
      if (typeof time !== 'string' || !TIME.test(time)) return undefined;
      next.quietHours[edge] = time;
    }
  }
  if (patch.timeZone !== undefined) {
    if (typeof patch.timeZone !== 'string' || !validZone(patch.timeZone)) return undefined;
    next.timeZone = patch.timeZone;
  }
  if (patch.digest !== undefined) {
    if (typeof patch.digest !== 'string' || !DIGESTS.includes(patch.digest as PushDigest)) return undefined;
    next.digest = patch.digest as PushDigest;
  }
  if (patch.overrides !== undefined) {
    if (!isRecord(patch.overrides)) return undefined;
    for (const [ref, on] of Object.entries(patch.overrides)) {
      if (ref === '' || ref.length > 200 || (typeof on !== 'boolean' && on !== null)) return undefined;
      if (on === null) delete next.overrides[ref];
      else next.overrides[ref] = on;
    }
    if (Object.keys(next.overrides).length > MAX_OVERRIDES) return undefined;
  }
  return next;
}

/** A settings value read back from the store: what is there over the defaults, so that a category added later has its default. */
export function storedSettings(raw: string): PushSettings {
  try {
    return applySettings(DEFAULT_PUSH_SETTINGS, JSON.parse(raw)) ?? DEFAULT_PUSH_SETTINGS;
  } catch {
    return DEFAULT_PUSH_SETTINGS;
  }
}
