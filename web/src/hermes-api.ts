// Hermes's REST API as pinned in the contracts workspace, called through the Caduceus server's proxy.
import type { paths } from '@caduceus/contracts/hermes/rest';

/** Pinned Hermes REST paths that answer GET. */
export type HermesGetPath = { [P in keyof paths]: [paths[P]['get']] extends [never] ? never : P }[keyof paths];

/** The pinned JSON body of a GET's 200 response: `unknown` wherever Hermes declares no response schema. */
export type HermesGetResult<P extends HermesGetPath> = paths[P]['get'] extends {
  responses: { 200: { content: { 'application/json': infer Body } } };
}
  ? Body
  : unknown;

/** The GETs on their way, by path: a screen whose parts ask for the same thing at the same moment sends one request, not one each. */
const inFlight = new Map<string, Promise<unknown>>();

/** GETs a pinned Hermes REST operation; anything not in the pinned contract fails to compile. Asks made while an identical one is on its way share its answer. */
export function getHermes<P extends HermesGetPath>(path: P): Promise<HermesGetResult<P>> {
  const running = inFlight.get(path);
  if (running) return running as Promise<HermesGetResult<P>>;
  const asked = (async () => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    return res.json();
  })().finally(() => inFlight.delete(path));
  inFlight.set(path, asked);
  return asked;
}
