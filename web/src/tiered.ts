// `fetchTiered` wired to this page: the real network, the mounted dialog, the passkey prompt and read-only mode.
import { fetchWithStepUp } from './passkeys.ts';
import { isReadOnly } from './policy-state.ts';
import { getTierConfirmer } from './shell/tier-confirmation.ts';
import { createTieredFetch } from './tiered-fetch.ts';

/** SHA-256 in hex, from the browser's own crypto (available in the secure contexts Caduceus runs in). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Calls a Hermes route through the policy: it asks the shared confirmation dialog for the route's tier, and sends the
 * request the way the server expects. Every module uses this for anything that is not a plain read.
 */
export const fetchTiered = createTieredFetch({
  fetch: (path, init) => fetch(path, init),
  confirmer: getTierConfirmer,
  withStepUp: fetchWithStepUp,
  online: () => navigator.onLine,
  readOnly: isReadOnly,
  sha256: sha256Hex,
});
