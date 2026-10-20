// Reading Hermes for the profile builder (GETs only; every change goes through `builder-apply.ts` and `profile-transfer.ts`), and the wiring of
// the runner to this page: the real tiered fetch, Hermes through the policy proxy, Caduceus's own API. Nothing is kept beyond what the screen shows.
import { useEffect, useState } from 'react';
import { fetchTiered } from '../../tiered.ts';
import { parseSkills, listPath } from '../skills/skills-model.ts';
import { parseServers, serverDefinitions } from '../tools/mcp-model.ts';
import { createBuilderRunner, type BuilderRunner } from './builder-apply.ts';
import type { Baseline, Start } from './builder-model.ts';
import { fetchProfileCards } from './profiles-data.ts';
import type { TransferDeps } from './profile-transfer.ts';

async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

/** What a new profile starts with, as Hermes has it: the clone's source, or for a blank or persona start the default profile's bundled skills and servers. */
export async function fetchBaseline(start: Start): Promise<Baseline> {
  const source = start.kind === 'clone' ? start.source : 'default';
  const name = encodeURIComponent(source);
  const [soul, cards, skills, servers, config] = await Promise.all([
    read(`/api/profiles/${name}/soul`).catch(() => undefined),
    fetchProfileCards(),
    read(listPath(source)),
    read(`/api/mcp/servers?profile=${name}`),
    read(`/api/config?profile=${name}`),
  ]);
  const card = cards.find((candidate) => candidate.name === source);
  const definitions = serverDefinitions(config);
  const clone = start.kind === 'clone';
  return {
    source,
    // A blank or persona profile gets Hermes's own SOUL and no model: only a clone has the source's.
    soul: clone && typeof (soul as { content?: unknown } | undefined)?.content === 'string' ? (soul as { content: string }).content : '',
    model: clone && card?.provider && card.model ? { provider: card.provider, model: card.model } : undefined,
    // Hermes makes a new profile with its bundled skills; a clone has all of the source's.
    skills: parseSkills(skills).filter((skill) => clone || skill.provenance === 'bundled').map(({ name: skillName, description, enabled }) => ({ name: skillName, description, enabled })),
    servers: parseServers(servers, config).map((server) => ({ server, definition: definitions[server.name] })),
  };
}

/** The baseline for a start; `undefined` until Hermes has answered, and `failed` when it did not. */
export function useBaseline(start: Start): { baseline: Baseline | undefined; failed: boolean } {
  const [state, setState] = useState<{ key: string; baseline: Baseline | undefined; failed: boolean }>({ key: '', baseline: undefined, failed: false });
  const key = start.kind === 'clone' ? `clone:${start.source}` : 'default';
  useEffect(() => {
    let current = true;
    fetchBaseline(start).then(
      (baseline) => current && setState({ key, baseline, failed: false }),
      () => current && setState({ key, baseline: undefined, failed: true }),
    );
    return () => {
      current = false;
    };
    // The start's kind and source are what the baseline is for; a persona changes nothing about it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { baseline: undefined, failed: false };
}

const LOOK_MS = 400;

/** The runner of Finish, on this page's real boundaries. */
export const pageRunner: BuilderRunner = createBuilderRunner({
  send: fetchTiered,
  async read(path) {
    const res = await fetch(path);
    return { status: res.status, body: await res.json().catch(() => undefined) };
  },
  request: (method, path, body) => fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }),
  async pause() {
    const waited = Promise.withResolvers<void>();
    window.setTimeout(waited.resolve, LOOK_MS);
    await waited.promise;
  },
});

/** Export and import on this page's real boundaries. */
export const pageTransfer: TransferDeps = {
  send: fetchTiered,
  async download(path) {
    const res = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
};
