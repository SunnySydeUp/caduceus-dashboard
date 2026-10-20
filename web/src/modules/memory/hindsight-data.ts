// Reading the Caduceus server for Agents › Memory › Hindsight and Notes. Every read asks again; nothing is kept beyond what the screen shows (D1), and nothing
// here sees a credential: the server never sends one.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HindsightStatus, NotesSourceRow } from '@caduceus/contracts/hindsight-api';
import { useProfileLoad, type LoadedView } from '../models/model-data.ts';
import { failureMessage, parseSources, parseStatus, sourcesPath, statusPath } from './hindsight-model.ts';

/** The answer of a read, or the words for why there is none: a Caduceus refusal has a message, a network failure has not. */
async function readJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(failureMessage(body, res.status));
  return body;
}

/** How Hindsight stands for the profile. */
export const useHindsightStatus = (profile: string | undefined): LoadedView<HindsightStatus> => useProfileLoad(profile, async (name) => parseStatus(await readJson(statusPath(name))));

/** The profile's MCP servers and which of them are notes sources. */
export const useNotesSources = (profile: string | undefined): LoadedView<NotesSourceRow[]> => useProfileLoad(profile, async (name) => parseSources(await readJson(sourcesPath(name))));

export interface ListView<Value> {
  value: Value | undefined;
  /** The words for why the last look failed. */
  error: string | undefined;
  loading: boolean;
  reload(): void;
}

/** One read of a path (`undefined` reads nothing), asked again whenever the path changes; the answer to an older path is dropped. */
export function useRead<Value>(path: string | undefined, parse: (body: unknown) => Value): ListView<Value> {
  const [state, setState] = useState<{ path: string; value?: Value; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  useEffect(() => {
    if (path === undefined) return;
    let current = true;
    readJson(path).then(
      (body) => current && setState({ path, value: parseRef.current(body) }),
      (error: unknown) => current && setState({ path, error: error instanceof Error ? error.message : 'Caduceus did not answer.' }),
    );
    return () => {
      current = false;
    };
  }, [path, attempt]);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const answered = state?.path === path ? state : undefined;
  return { value: answered?.value, error: answered?.error, loading: path !== undefined && answered === undefined, reload };
}
