// Reading Hermes and Caduceus for the profile file editors. Only GETs live here; every change goes through `behaviour-actions.ts`.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileSnapshot } from '@caduceus/contracts/caduceus-api';
import { isListed, listPath, memoryPath, memoryUse, readPath, readResult, snapshotPath, snapshotsPath, type FileRef, type ReadResult } from './behaviour-files.ts';

/** Reads one file from Hermes. Throws only when Hermes cannot be asked at all. */
export async function fetchFile(ref: FileRef): Promise<ReadResult> {
  // Reading a file that is not there is a 404, which the browser logs as an error: look in its folder first.
  if (ref.kind === 'file') {
    const listing = await fetch(listPath(ref));
    if (listing.ok && !isListed(ref, await listing.json().catch(() => undefined))) return { state: 'ready', text: '', exists: false };
  }
  const res = await fetch(readPath(ref));
  const body: unknown = await res.json().catch(() => undefined);
  return readResult(ref, res.status, body);
}

export async function fetchSnapshots(ref: FileRef): Promise<FileSnapshot[]> {
  const res = await fetch(snapshotsPath(ref));
  if (!res.ok) throw new Error(`GET snapshots: HTTP ${res.status}`);
  return ((await res.json()) as { snapshots: FileSnapshot[] }).snapshots;
}

export async function fetchSnapshotText(id: number): Promise<string> {
  const res = await fetch(snapshotPath(id));
  if (!res.ok) throw new Error(`GET snapshot: HTTP ${res.status}`);
  return ((await res.json()) as { text: string }).text;
}

/** A file's current text as Hermes holds it; `reload` asks again. `undefined` while the first answer is awaited. */
export function useFileRead(ref: FileRef): { result: ReadResult | undefined; reload(): Promise<ReadResult> } {
  const [result, setResult] = useState<ReadResult>();
  const key = JSON.stringify(ref);
  const latest = useRef(0);
  const refRef = useRef(ref);
  refRef.current = ref;
  const reload = useCallback(async (): Promise<ReadResult> => {
    const request = ++latest.current;
    const read = await fetchFile(refRef.current).catch((): ReadResult => ({ state: 'failed', message: 'Hermes did not answer, so the file could not be read.' }));
    if (request === latest.current) setResult(read);
    return read;
  }, []);
  useEffect(() => {
    setResult(undefined);
    void reload();
  }, [key, reload]);
  return { result, reload };
}

export interface MemoryFacts {
  memory: { bytes: number; limit: number };
  user: { bytes: number; limit: number };
}

/** The sizes of MEMORY.md and USER.md against their limits, as Hermes reports them for this profile. */
export async function fetchMemoryUse(profile: string): Promise<MemoryFacts> {
  const [memory, config] = await Promise.all([fetch(memoryPath(profile)).then((res) => (res.ok ? res.json() : undefined)), fetch(`/api/config?profile=${encodeURIComponent(profile)}`).then((res) => (res.ok ? res.json() : undefined))]);
  return memoryUse(memory, config);
}

/** `fetchMemoryUse`, loaded when the profile changes and again on `reload`. `undefined` until Hermes has answered or when it cannot. */
export function useMemoryUse(profile: string): { use: MemoryFacts | undefined; reload(): Promise<void> } {
  const [use, setUse] = useState<MemoryFacts>();
  const reload = useCallback(async () => setUse(await fetchMemoryUse(profile).catch(() => undefined)), [profile]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { use, reload };
}
