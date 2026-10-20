// What the browser may be told about a channel's credentials (M5 #02). Hermes's `GET /api/messaging/platforms` redacts every value
// it holds (`1234...6789`, or `***`, wrapped as `«redacted:1234...6789»` since Hermes 0.22) and never sends one whole; this is the second lock on that door. A value that does not look
// like Hermes's redaction is replaced before it leaves Caduceus, so a Hermes that echoed a secret by mistake would not reach a
// browser, a log or a cache with it.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** What stands in for a value whose redaction cannot be trusted. */
export const MASK = '***';

/** Hermes's own redactions: nothing set, the mask, or the first and last four characters at most (`1234...6789`). */
const REDACTED = /^(?:\*\*\*|.{0,4}\.\.\..{0,4})$/s;

/** Hermes 0.22 marks a value it redacted as `«redacted:<redaction>»`, so that nothing can save it back as a credential. */
const SENTINEL = /^«redacted:(.*)»$/s;

/** The redaction in Hermes's answer without the marker, or `undefined` when what is there is not one (it may be a secret). */
function redactionOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const shown = SENTINEL.exec(value)?.[1] ?? value;
  return REDACTED.test(shown) ? shown : undefined;
}

/** `body` (Hermes's list of platforms) with every `env_vars[].redacted_value` that is not a redaction replaced by the mask. Anything else is left as it is. */
export function guardPlatformSecrets(body: unknown): unknown {
  if (!isRecord(body) || !Array.isArray(body.platforms)) return body;
  const platforms = body.platforms.map((platform) => {
    if (!isRecord(platform) || !Array.isArray(platform.env_vars)) return platform;
    const env_vars = platform.env_vars.map((field) => {
      if (!isRecord(field) || field.redacted_value === null || field.redacted_value === undefined) return field;
      return { ...field, redacted_value: redactionOf(field.redacted_value) ?? MASK };
    });
    return { ...platform, env_vars };
  });
  return { ...body, platforms };
}
