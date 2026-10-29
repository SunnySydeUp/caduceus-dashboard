// What Workspace › Files knows about files, free of the DOM and of React (M7 #01): the address of a folder or a file, what a file previews as,
// Hermes's listing as the page shows it, a CSV as a sortable table and the frame an HTML file is shown in. Everything on disk is Hermes's (D1):
// Caduceus keeps only the snapshot the server takes before a text save.
import { isRecord } from '@caduceus/contracts/policy/guards';
import { HTML_SANDBOX, htmlPreviewDocument } from '../chat/embeds.ts';

/** The base of the screen's addresses. */
export const FILES_ROUTE = '/workspace/files';

/** The largest text file the page opens, and the largest file it previews as media (a bigger one shows its size and a Download action). */
export const TEXT_PREVIEW_LIMIT = 1024 * 1024;
export const MEDIA_PREVIEW_LIMIT = 25 * 1024 * 1024;
/** The largest Office document the editor opens (the server's limit for a save is the same). */
export const OFFICE_LIMIT = 25 * 1024 * 1024;

/** The address of a folder or a file: `/workspace/files/` and the absolute path, one encoded segment each. No path is the managed root itself. */
export function filesUrl(path: string | undefined): string {
  if (!path) return FILES_ROUTE;
  return `${FILES_ROUTE}${path.split('/').filter(Boolean).map((segment) => `/${encodeURIComponent(segment)}`).join('')}`;
}

/** The absolute path an address names (what follows `/workspace/files/`); `undefined` for the managed root. A bad escape is taken as written. */
export function pathFromSplat(splat: string | undefined): string | undefined {
  if (!splat) return undefined;
  const segments = splat.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  return segments.length === 0 ? undefined : `/${segments.join('/')}`;
}

export interface Crumb {
  name: string;
  path: string;
}

/** The folders from the top down to `path`, each with its own path. */
export function crumbs(path: string): Crumb[] {
  const names = path.split('/').filter(Boolean);
  return names.map((name, index) => ({ name, path: `/${names.slice(0, index + 1).join('/')}` }));
}

export function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

export type PreviewKind = 'code' | 'markdown' | 'csv' | 'image' | 'audio' | 'video' | 'pdf' | 'html' | 'text' | 'office' | 'binary';

const KIND_BY_EXTENSION: Record<string, PreviewKind> = {
  md: 'markdown', markdown: 'markdown', csv: 'csv', html: 'html', htm: 'html', pdf: 'pdf', docx: 'office', xlsx: 'office', pptx: 'office',
  ...Object.fromEntries('png jpg jpeg gif webp bmp svg avif ico'.split(' ').map((extension) => [extension, 'image'])),
  ...Object.fromEntries('mp3 wav m4a ogg opus flac aac'.split(' ').map((extension) => [extension, 'audio'])),
  ...Object.fromEntries('mp4 webm mov m4v'.split(' ').map((extension) => [extension, 'video'])),
  ...Object.fromEntries('c cc conf cpp css go graphql h hpp ini java js json jsx kt lua mjs cjs py rb rs sh sql toml ts tsx xml yaml yml zsh bash swift php diff patch lock'.split(' ').map((extension) => [extension, 'code'])),
  ...Object.fromEntries('txt log text rst'.split(' ').map((extension) => [extension, 'text'])),
};
/** Names that are text whatever they end in. */
const TEXT_NAMES: Record<string, true> = { license: true, readme: true, makefile: true, dockerfile: true, notice: true, changelog: true, authors: true, procfile: true };

/** How a file is shown, from its name. */
export function previewKind(name: string): PreviewKind {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot > 0) return KIND_BY_EXTENSION[lower.slice(dot + 1)] ?? 'binary';
  // A dotfile (`.gitignore`) or a plain name (`LICENSE`).
  return dot === 0 || TEXT_NAMES[lower] ? 'text' : 'binary';
}

/** Whether the page can open the file as text to edit it. */
export function isEditable(kind: PreviewKind): boolean {
  return kind === 'code' || kind === 'markdown' || kind === 'csv' || kind === 'text' || kind === 'html';
}

/** What is wrong with a name given to a file or folder (a rename, a new folder), in words; `undefined` when it is a file name and not a path. The server says the same. */
export function nameProblem(name: string): string | undefined {
  if (name.trim() === '' || name === '.' || name === '..') return 'Give a name: a file name, not a path.';
  if (/[\\/\0]/.test(name)) return 'A name cannot hold a slash or a backslash. Use Move to… to change the folder.';
  if (new TextEncoder().encode(name).length > 255) return 'That name is too long for the file system.';
  return undefined;
}

/** Bytes as base64, the way the Office save sends them: in slices, since one call over a large file overflows the stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** An entry of a folder as the page shows it. `modified` is milliseconds since the epoch. */
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number | undefined;
  modified: number | undefined;
}

export interface Listing {
  path: string;
  parent: string | undefined;
  entries: FileEntry[];
}

/** Hermes's `GET /api/files` answer as a listing; `undefined` when it is not one (Hermes answers `{ detail }` for a refusal). */
export function parseListing(body: unknown): Listing | undefined {
  if (!isRecord(body) || typeof body.path !== 'string' || !Array.isArray(body.entries)) return undefined;
  const entries = body.entries.flatMap((entry): FileEntry[] => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.path !== 'string') return [];
    return [
      {
        name: entry.name,
        path: entry.path,
        directory: entry.is_directory === true,
        size: typeof entry.size === 'number' ? entry.size : undefined,
        modified: typeof entry.mtime === 'number' ? Math.round(entry.mtime * 1000) : undefined,
      },
    ];
  });
  return { path: body.path, parent: typeof body.parent === 'string' ? body.parent : undefined, entries };
}

/** Whether `path` is a workspace Caduceus knows or inside one: a text save there is a Tier 1. */
export function underWorkspace(path: string, workspaces: readonly string[]): boolean {
  return workspaces.some((workspace) => {
    const root = workspace.replace(/\/+$/, '');
    return path === root || path.startsWith(`${root}/`);
  });
}

/** A CSV as rows of cells: quoted fields, doubled quotes, and commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = '';
    rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      endRow();
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** The rows ordered by one column: as numbers when every cell of it is one, otherwise as words. The rows given are not changed. */
export function sortRows(rows: readonly string[][], column: number, direction: 'asc' | 'desc'): string[][] {
  const numeric = rows.every((row) => row[column] !== undefined && row[column].trim() !== '' && Number.isFinite(Number(row[column])));
  const order = numeric ? (a: string[], b: string[]) => Number(a[column]) - Number(b[column]) : (a: string[], b: string[]) => (a[column] ?? '').localeCompare(b[column] ?? '', undefined, { numeric: true, sensitivity: 'base' });
  const sorted = [...rows].sort(order);
  return direction === 'asc' ? sorted : sorted.reverse();
}

/**
 * What an HTML file is shown in: a frame with the empty sandbox (no scripts, not Caduceus's origin, no forms) and a document whose policy allows
 * no connection, so the file can reach no cookie, storage or Caduceus API (the chat's HTML preview rules, `chat/embeds.ts`).
 */
export function htmlFrame(html: string): { sandbox: string; srcDoc: string } {
  return { sandbox: HTML_SANDBOX, srcDoc: htmlPreviewDocument(html) };
}

/** Hermes's routes for one file: the data URL it reads, the download, and the stream a player can seek in. All of them pass the proxy's file guard. */
export const readUrl = (path: string) => `/api/files/read?path=${encodeURIComponent(path)}`;
export const downloadUrl = (path: string) => `/api/files/download?path=${encodeURIComponent(path)}`;
export const streamUrl = (path: string) => `/api/files/stream?path=${encodeURIComponent(path)}`;
export const listUrl = (path: string | undefined) => (path ? `/api/files?path=${encodeURIComponent(path)}` : '/api/files');

/** The entries to draw: a name that starts with a dot is left out unless `showHidden`, and `hidden` counts how many a folder keeps out of sight. */
export function splitHidden(entries: readonly FileEntry[], showHidden: boolean): { shown: FileEntry[]; hidden: number } {
  const hidden = entries.filter((entry) => entry.name.startsWith('.')).length;
  return { shown: showHidden ? [...entries] : entries.filter((entry) => !entry.name.startsWith('.')), hidden };
}

/** What a read of a folder came to: its listing, or the words it failed with (`reason` is the proxy's code when the file guard refused it). */
export type ListFailure = { ok: false; message: string; status: number; reason?: string };
export type ListAnswer = { ok: true; listing: Listing } | ListFailure;

/**
 * Why an address did not open, in words, and the folder to go back to (`undefined`: the top). The proxy's own message is used where it
 * has one, since it says what is true: a file kept protected on purpose is not "missing". The one refusal that is reworded is a path
 * outside the roots, whose message is about writing, and browsing is a read.
 */
export function openFailure(path: string, parent: ListAnswer, own: ListFailure): { message: string; back: string | undefined } {
  const back = parent.ok ? parentOf(path) : undefined;
  if (own.reason === 'outside-roots') return { message: 'This path is outside the folders Caduceus can open.', back };
  if (own.reason !== undefined) return { message: own.message, back };
  if (own.status > 0 && own.status < 500 && parent.ok && !parent.listing.entries.some((entry) => entry.path === path)) return { message: 'There is nothing at this address. It may have been moved or deleted.', back };
  return { message: own.message, back };
}
