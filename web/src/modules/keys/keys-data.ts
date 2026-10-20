// Reading Hermes for System › Keys. Only reads live here; every change goes through the `*-actions.ts` files. Every read names the profile
// and asks Hermes again; nothing is kept beyond what the screen shows (D1), and Caduceus has already taken every part of a credential out of
// the answers (`server/src/credential-guard.ts`).
import { useProfileLoad, type LoadedView } from '../models/model-data.ts';
import { parseEndpoints, parseKeys, parseOauth, parsePool, parsePortal, type Endpoint, type KeyGroup, type OauthProvider, type PoolProvider, type Portal } from './keys-model.ts';

/** A plain Hermes read through Caduceus: a path, answered as JSON. */
export async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

const scoped = (route: string, profile: string) => `${route}?profile=${encodeURIComponent(profile)}`;

export interface KeysData {
  keys: LoadedView<KeyGroup[]>;
  pool: LoadedView<PoolProvider[]>;
  oauth: LoadedView<OauthProvider[]>;
  endpoints: LoadedView<Endpoint[]>;
  portal: LoadedView<Portal | undefined>;
  /** Asks Hermes for everything again. */
  reload(): Promise<void>;
}

/**
 * Everything System › Keys shows for a profile, each part loaded on its own (the pool can be slow, and one part failing must not hide the rest),
 * now and at every `gateway.ready`.
 */
export function useKeysData(profile: string | undefined): KeysData {
  const keys = useProfileLoad(profile, async (name) => parseKeys(await read(scoped('/api/env', name))));
  const pool = useProfileLoad(profile, async (name) => parsePool(await read(scoped('/api/credentials/pool', name))));
  const oauth = useProfileLoad(profile, async (name) => parseOauth(await read(scoped('/api/providers/oauth', name))));
  const endpoints = useProfileLoad(profile, async (name) => parseEndpoints(await read(scoped('/api/providers/custom-endpoints', name))));
  const portal = useProfileLoad(profile, async (name) => parsePortal(await read(scoped('/api/portal', name))));
  return {
    keys,
    pool,
    oauth,
    endpoints,
    portal,
    reload: async () => void (await Promise.all([keys.reload(), pool.reload(), oauth.reload(), endpoints.reload(), portal.reload()])),
  };
}
