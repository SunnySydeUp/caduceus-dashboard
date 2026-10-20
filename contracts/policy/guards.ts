// The one type guard the policy modules share.

/** A JSON object: not null, not an array. Its values stay `unknown`; check each field before using it. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
