// Reading Hermes for Agents › Memory. Only reads live here; every change goes through `memory-actions.ts`. Every read names the profile and
// asks Hermes again; nothing is kept beyond what the screen shows (D1).
import { useEffect, useRef, useState } from 'react';
import { gatewayConnection } from '../../gateway.ts';
import { useProfileLoad, type LoadedView } from '../models/model-data.ts';
import { contextEnginePaths, graphPath, loadForm, memoryPath, nodePath, oauthStatusPath, parseContextEngine, parseFacts, parseGraph, parseMemory, parseOauth, parseTextFile, parseWiki, readNodeAnswer, readTextPath, wikiFolder, wikiPath, type ContextEngineChoice, type Graph, type MemoryStatus, type NodeAnswer, type OauthStatus, type ProjectFacts, type ProviderForm, type TextFile, type WikiListing } from './memory-model.ts';

/** A plain Hermes read through Caduceus: a path, answered as JSON. */
export async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

/** One node of the learning graph. Hermes refuses a stale id with a reason (HTTP 404), which is an answer; only a network failure throws. */
export async function fetchNode(id: string, profile: string): Promise<NodeAnswer> {
  const response = await fetch(nodePath(id, profile));
  return readNodeAnswer(await response.json().catch(() => undefined));
}

/** The profile's memory settings: the active provider, every provider and the built-in files' sizes. */
export const useMemoryStatus = (profile: string | undefined): LoadedView<MemoryStatus> => useProfileLoad(profile, async (name) => parseMemory(await read(memoryPath(name))));

/** The profile's context engine and the engines on offer. */
export const useContextEngine = (profile: string | undefined): LoadedView<ContextEngineChoice> =>
  useProfileLoad(profile, async (name) => {
    const paths = contextEnginePaths(name);
    const [config, hub] = await Promise.all([read(paths.config), read(paths.hub).catch(() => undefined)]);
    return parseContextEngine(config, hub);
  });

/** The learning graph of the profile. */
export const useGraph = (profile: string | undefined): LoadedView<Graph> => useProfileLoad(profile, async (name) => parseGraph(await read(graphPath(name))));

export interface ProviderDetail {
  form: ProviderForm;
  /** The provider's own sign-in; undefined when it has none. */
  oauth: OauthStatus | undefined;
}

/** A provider's form and, for one that has a sign-in, how it stands. Loaded when the sheet opens and again on `reload`. */
export function useProviderDetail(name: string, profile: string): LoadedView<ProviderDetail> & { setOauth(status: OauthStatus): void } {
  const view = useProfileLoad(profile, async (current) => ({
    form: await loadForm(name, current, read),
    oauth: parseOauth(await read(oauthStatusPath(name, current)).catch(() => undefined)),
  }));
  // What the sign-in's watcher heard replaces what the last load said, until the next load.
  const [heard, setHeard] = useState<{ status: OauthStatus; loaded: OauthStatus | undefined }>();
  const loaded = view.value?.oauth;
  const value = view.value && { form: view.value.form, oauth: loaded && (heard?.loaded === loaded ? heard.status : loaded) };
  return { ...view, value, setOauth: (status) => setHeard({ status, loaded }) };
}

/** How often the sheet asks Hermes how a sign-in is going: Hermes sends no event when it ends, and it ends on a worker thread of its own. */
const SIGN_IN_LOOK_MS = 1000;

/** Follows a provider's sign-in while it is pending; `onStatus` gets each answer, and the last one ends the watching. */
export function useSignInWatch(name: string, profile: string, pending: boolean, onStatus: (status: OauthStatus) => void): void {
  const latest = useRef(onStatus);
  latest.current = onStatus;
  useEffect(() => {
    if (!pending) return;
    let current = true;
    const timer = setInterval(() => {
      read(oauthStatusPath(name, profile)).then(
        (answer) => {
          const status = parseOauth(answer);
          if (current && status) latest.current(status);
        },
        // A look that fails is tried again at the next tick.
        () => undefined,
      );
    }, SIGN_IN_LOOK_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [name, profile, pending]);
}

/** The facts of a folder (the gateway's `project.facts`): `null` for a folder that is no workspace, `undefined` while Hermes is asked or when it cannot answer. */
export function useProjectFacts(cwd: string, profile: string): ProjectFacts | null | undefined {
  const [answer, setAnswer] = useState<{ key: string; facts: ProjectFacts | null | undefined }>();
  const key = `${profile}\n${cwd}`;
  const ask = (ready: boolean) => {
    if (!ready || cwd.trim() === '') return;
    void gatewayConnection()
      .client.request('project.facts', { cwd: cwd.trim(), profile })
      .then(
        (result) => setAnswer({ key, facts: parseFacts(result) ?? null }),
        () => setAnswer({ key, facts: undefined }),
      );
  };
  useEffect(() => {
    const gateway = gatewayConnection();
    ask(gateway.status.state === 'connected');
    return gateway.onReady(() => ask(true));
    // `ask` is rebuilt every render and closes over the same key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cwd.trim() === '' || answer?.key !== key ? undefined : answer.facts;
}

/** A text file through Hermes's fs read; `null` when Hermes has none, `undefined` while it is asked. */
export function useTextFile(path: string | undefined): TextFile | null | undefined {
  const [answer, setAnswer] = useState<{ path: string; file: TextFile | null }>();
  useEffect(() => {
    if (path === undefined) return;
    let current = true;
    read(readTextPath(path)).then(
      (body) => current && setAnswer({ path, file: parseTextFile(body) ?? null }),
      () => current && setAnswer({ path, file: null }),
    );
    return () => {
      current = false;
    };
  }, [path]);
  return path === undefined || answer?.path !== path ? undefined : answer.file;
}

/** The profile's wiki folder: its config's `skills.config.wiki.path`, else `~/wiki`. */
export function useWikiFolder(profile: string): string | undefined {
  const [answer, setAnswer] = useState<{ profile: string; folder: string }>();
  useEffect(() => {
    let current = true;
    read(`/api/config?profile=${encodeURIComponent(profile)}`).then(
      (config) => current && setAnswer({ profile, folder: wikiFolder(config) }),
      () => current && setAnswer({ profile, folder: wikiFolder(undefined) }),
    );
    return () => {
      current = false;
    };
  }, [profile]);
  return answer?.profile === profile ? answer.folder : undefined;
}

/** A wiki folder's listing; `undefined` while it is asked. */
export function useWikiListing(folder: string | undefined): WikiListing | undefined {
  const [answer, setAnswer] = useState<{ folder: string; listing: WikiListing }>();
  useEffect(() => {
    if (folder === undefined) return;
    let current = true;
    read(wikiPath(folder)).then(
      (body) => current && setAnswer({ folder, listing: parseWiki(body) }),
      () => current && setAnswer({ folder, listing: { kind: 'unreadable', error: 'Hermes did not answer.' } }),
    );
    return () => {
      current = false;
    };
  }, [folder]);
  return folder === undefined || answer?.folder !== folder ? undefined : answer.listing;
}
