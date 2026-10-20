// Reading Hermes for Agents › Skills › Hub, and for the curator. Only GETs live here; every change goes through `hub-actions.ts`.
// Nothing is kept beyond what the screen shows: a reload shows Hermes's hub (D1).
import { actionLogPath, curatorPath, hubOfficialPath, hubPreviewPath, hubScanPath, hubSearchPath, hubSourcesPath, parseCurator, parseHubOfficial, parseHubPreview, parseHubScan, parseHubSearch, parseHubSources, readActionLog, type ActionLog, type CuratorStatus, type HubPreview, type HubScan, type HubSearch, type HubSources, type OfficialSkill } from './hub-model.ts';

async function read(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(path);
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

/** A GET whose answer must be a 200: anything else throws with Hermes's own words when it has them. */
async function readOk(path: string): Promise<unknown> {
  const { status, body } = await read(path);
  if (status !== 200) {
    const detail = typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined;
    throw new Error(typeof detail === 'string' ? detail : `GET ${path}: HTTP ${status}`);
  }
  return body;
}

/** Hermes's hub sources for the profile, with the index's featured skills. Hermes asks the network for the index, so this can take a few seconds. */
export async function fetchHubSources(profile: string): Promise<HubSources> {
  return parseHubSources(await readOk(hubSourcesPath(profile)));
}

/** Hermes's official catalogue, which it keeps on disk. */
export async function fetchHubOfficial(profile: string): Promise<OfficialSkill[]> {
  return parseHubOfficial(await readOk(hubOfficialPath(profile)));
}

/** A search of the hub. Hermes searches its sources over the network, up to half a minute. */
export async function fetchHubSearch(profile: string, query: { q: string; source: string }): Promise<HubSearch> {
  return parseHubSearch(await readOk(hubSearchPath(profile, query)));
}

/** A hub skill's preview, or `undefined` when Hermes has no such skill (404). Throws when Hermes cannot be asked or fails. */
export async function fetchHubPreview(profile: string, identifier: string): Promise<HubPreview | undefined> {
  const { status, body } = await read(hubPreviewPath(profile, identifier));
  if (status === 404) return undefined;
  if (status !== 200) throw new Error(`Hermes answered HTTP ${status}.`);
  return parseHubPreview(body);
}

/** The security scan of a hub skill, or `undefined` when Hermes has none to give (404). Throws when it fails: a scan that did not run is not a pass. */
export async function fetchHubScan(profile: string, identifier: string): Promise<HubScan | undefined> {
  const { status, body } = await read(hubScanPath(profile, identifier));
  if (status === 404) return undefined;
  if (status !== 200) throw new Error(`Hermes answered HTTP ${status}.`);
  return parseHubScan(body);
}

/** The log of one of Hermes's background actions as it is now. Throws when Hermes does not answer or does not know the action. */
export async function fetchActionLog(name: string): Promise<ActionLog> {
  return readActionLog(await readOk(actionLogPath(name)));
}

/** The profile's curator as Hermes says. Throws when Hermes cannot be asked. */
export async function fetchCurator(profile: string): Promise<CuratorStatus> {
  const curator = parseCurator(await readOk(curatorPath(profile)));
  if (!curator) throw new Error('Hermes did not send the curator’s status.');
  return curator;
}
