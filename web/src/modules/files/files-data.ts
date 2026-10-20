// Reading Hermes's file routes for Workspace › Files. Only GETs live here; every change goes through `files-actions.ts`. The proxy refuses a path outside the
// managed roots with a 403 whose message says so, and Hermes answers `{ detail }` for the rest.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MEDIA_PREVIEW_LIMIT, OFFICE_LIMIT, listUrl, parentOf, parseListing, previewKind, readUrl, streamUrl, TEXT_PREVIEW_LIMIT, type FileEntry, type Listing, type PreviewKind } from './files-model.ts';

function reasonOf(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const { message, detail } = body as { message?: unknown; detail?: unknown };
    if (typeof message === 'string') return message;
    if (typeof detail === 'string') return detail;
  }
  return `Hermes answered HTTP ${status}.`;
}

export type Folder = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; listing: Listing; selected: FileEntry | undefined };

async function list(path: string | undefined): Promise<{ ok: true; listing: Listing } | { ok: false; message: string; status: number }> {
  const res = await fetch(listUrl(path)).catch(() => undefined);
  if (!res) return { ok: false, message: 'Caduceus did not answer, so the folder could not be read.', status: 0 };
  const body: unknown = await res.json().catch(() => undefined);
  const listing = res.ok ? parseListing(body) : undefined;
  return listing ? { ok: true, listing } : { ok: false, message: reasonOf(body, res.status), status: res.status };
}

/**
 * What an address shows: no path is the managed root; a path is a folder, or a file (then its folder is listed and the file is selected). The folder
 * the path sits in is listed first, since its entries say which of the two the path is.
 */
export async function openPath(path: string | undefined): Promise<Folder> {
  if (path === undefined) {
    const root = await list(undefined);
    return root.ok ? { state: 'ready', listing: root.listing, selected: undefined } : { state: 'failed', message: root.message };
  }
  const parent = await list(parentOf(path));
  const found = parent.ok ? parent.listing.entries.find((entry) => entry.path === path) : undefined;
  if (parent.ok && found && !found.directory) return { state: 'ready', listing: parent.listing, selected: found };
  const own = await list(path);
  if (own.ok) return { state: 'ready', listing: own.listing, selected: undefined };
  return { state: 'failed', message: parent.ok && !found ? 'There is nothing at this address. It may have been moved or deleted.' : own.message };
}

/** The folder or file an address shows; `reload` asks again (after an upload, a delete or a save). */
export function useFolder(path: string | undefined): { folder: Folder; reload(): Promise<void> } {
  const [folder, setFolder] = useState<Folder>({ state: 'loading' });
  const latest = useRef(0);
  const pathRef = useRef(path);
  pathRef.current = path;
  const reload = useCallback(async () => {
    const request = ++latest.current;
    const opened = await openPath(pathRef.current);
    if (request === latest.current) setFolder(opened);
  }, []);
  useEffect(() => {
    setFolder({ state: 'loading' });
    void reload();
  }, [path, reload]);
  return { folder, reload };
}

export type Preview =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  /** Too big for the page to open (the size and a Download action are shown instead), or not text. */
  | { state: 'download'; why: 'too-large' | 'binary' }
  | { state: 'text'; text: string }
  /** An image, or audio or video, with the address to show it from. */
  | { state: 'media'; src: string }
  /** A PDF, from an object URL the page revokes when it moves on. */
  | { state: 'pdf'; src: string }
  /** An Office document's bytes, as they are on disk now. */
  | { state: 'office'; bytes: Uint8Array<ArrayBuffer> };

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Reads a file the way its kind needs: its text, a `data:` URL to show, or the stream a player can seek in. */
export async function loadPreview(entry: FileEntry, kind: PreviewKind): Promise<Preview> {
  const size = entry.size ?? 0;
  if (kind === 'audio' || kind === 'video') return { state: 'media', src: streamUrl(entry.path) };
  const asText = kind === 'code' || kind === 'markdown' || kind === 'csv' || kind === 'html' || kind === 'text';
  if (kind === 'binary') return { state: 'download', why: 'binary' };
  if (size > (asText ? TEXT_PREVIEW_LIMIT : kind === 'office' ? OFFICE_LIMIT : MEDIA_PREVIEW_LIMIT)) return { state: 'download', why: 'too-large' };
  const res = await fetch(readUrl(entry.path)).catch(() => undefined);
  if (!res) return { state: 'failed', message: 'Caduceus did not answer, so the file could not be read.' };
  const body: unknown = await res.json().catch(() => undefined);
  const dataUrl = typeof body === 'object' && body !== null && 'data_url' in body && typeof body.data_url === 'string' ? body.data_url : undefined;
  if (!res.ok || dataUrl === undefined) return { state: 'failed', message: reasonOf(body, res.status) };
  if (kind === 'image') return { state: 'media', src: dataUrl };
  const bytes = decodeBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
  if (kind === 'office') return { state: 'office', bytes };
  if (kind === 'pdf') return { state: 'pdf', src: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })) };
  if (bytes.subarray(0, 4096).includes(0)) return { state: 'download', why: 'binary' };
  return { state: 'text', text: new TextDecoder().decode(bytes) };
}

/** A file's preview, loaded when the entry changes and again on `reload`. */
export function usePreview(entry: FileEntry | undefined, kind: PreviewKind | undefined): { preview: Preview; reload(): void } {
  const [preview, setPreview] = useState<Preview>({ state: 'loading' });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!entry || !kind) return;
    let current = true;
    setPreview({ state: 'loading' });
    let objectUrl: string | undefined;
    loadPreview(entry, kind).then(
      (loaded) => {
        if (loaded.state === 'pdf') objectUrl = loaded.src;
        if (current) setPreview(loaded);
        else if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
      () => current && setPreview({ state: 'failed', message: 'The file could not be read.' }),
    );
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry, kind, version]);
  return { preview, reload: () => setVersion((now) => now + 1) };
}
