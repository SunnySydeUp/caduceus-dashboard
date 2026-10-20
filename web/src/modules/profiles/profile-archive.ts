// What is in a profile archive (`hermes profile export`: a .tar.gz with one folder in it, named after the profile), read in the browser
// before anything is sent to Hermes, so the owner sees the name the profile would get, what it holds and whether that name is taken
// (M4 #12). Only the listing is read: entries are walked and counted, and only SOUL.md is kept (a short excerpt). Nothing is stored, and the
// file is read as a stream, so an archive of any size costs no more memory than one chunk. A hostile archive is bounded: the entries
// counted and the bytes inflated both have a limit.
import { renameProblem } from './profiles-model.ts';

export interface ArchiveSummary {
  /** The top-level folders: Hermes imports an archive with exactly one, and names the profile after it. */
  roots: string[];
  /** Files in the archive (folders and links are not counted). */
  files: number;
  hasConfig: boolean;
  hasSoul: boolean;
  /** How many skills it holds (a `SKILL.md` under the profile's `skills` folder). */
  skills: number;
  /** The first characters of SOUL.md, when it has one. */
  soul: string | undefined;
}

/** Why an archive cannot be read, in words for the owner. */
export class ArchiveError extends Error {}

const BLOCK = 512;
/** An archive of a profile has thousands of files at most; this many is not a profile. */
const MAX_ENTRIES = 100_000;
/** What an archive may inflate to before it is refused (the skills and memory of a profile are megabytes). */
const MAX_INFLATED_BYTES = 4 * 1024 ** 3;
/** The SOUL is shown, not stored: this much of its start. */
const SOUL_EXCERPT = 600;
/** Entries whose data is a name (a long path in GNU or PAX form) are never larger than a path. */
const MAX_NAME_DATA = 64 * 1024;

const decoder = new TextDecoder();

/** Pulls exact byte counts from a stream of chunks. */
class Puller {
  private chunks: Uint8Array[] = [];
  private held = 0;
  private inflated = 0;
  private done = false;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  private async fill(): Promise<boolean> {
    if (this.done) return false;
    let chunk;
    try {
      chunk = await this.reader.read();
    } catch {
      throw new ArchiveError('This is not a .tar.gz archive: it could not be unzipped.');
    }
    if (chunk.done) {
      this.done = true;
      return false;
    }
    this.inflated += chunk.value.byteLength;
    if (this.inflated > MAX_INFLATED_BYTES) throw new ArchiveError('This archive unpacks to far more than a profile holds, so it is not read.');
    this.chunks.push(chunk.value);
    this.held += chunk.value.byteLength;
    return true;
  }

  /** The next `count` bytes, or fewer at the end of the stream. */
  async take(count: number): Promise<Uint8Array> {
    while (this.held < count && (await this.fill())) continue;
    const size = Math.min(count, this.held);
    const out = new Uint8Array(size);
    let at = 0;
    while (at < size) {
      const head = this.chunks[0]!;
      const use = Math.min(head.byteLength, size - at);
      out.set(head.subarray(0, use), at);
      at += use;
      if (use === head.byteLength) this.chunks.shift();
      else this.chunks[0] = head.subarray(use);
    }
    this.held -= size;
    return out;
  }

  /** Drops the next `count` bytes without keeping them. */
  async skip(count: number): Promise<void> {
    let left = count;
    while (left > 0) {
      if (this.held === 0 && !(await this.fill())) return;
      const head = this.chunks[0]!;
      const use = Math.min(head.byteLength, left);
      if (use === head.byteLength) this.chunks.shift();
      else this.chunks[0] = head.subarray(use);
      this.held -= use;
      left -= use;
    }
  }

  cancel(): void {
    void this.reader.cancel().catch(() => undefined);
  }
}

const text = (bytes: Uint8Array) => decoder.decode(bytes).replace(/\0.*$/s, '');

/** The size field of a header: octal text, or (a file over 8 GiB) base-256 with the high bit of the first byte set. */
function sizeOf(header: Uint8Array): number {
  const field = header.subarray(124, 136);
  if ((field[0]! & 0x80) !== 0) {
    let size = field[0]! & 0x7f;
    for (const byte of field.subarray(1)) size = size * 256 + byte;
    return size;
  }
  const size = Number.parseInt(text(field).trim() || '0', 8);
  return Number.isFinite(size) && size >= 0 ? size : Number.NaN;
}

/** The path a PAX extended header gives (`<length> path=<name>\n`), if it has one. */
function paxPath(data: Uint8Array): string | undefined {
  const records = decoder.decode(data);
  return /(?:^|\n)\d+ path=([^\n]*)\n/.exec(records)?.[1];
}

/** The part of a path that is the folder under which the profile sits, and the path below it. */
function split(path: string): { root: string; rest: string } | undefined {
  const parts = path.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0) return undefined;
  return { root: parts[0]!, rest: parts.slice(1).join('/') };
}

/** Reads an archive's listing. Throws `ArchiveError` for a file that is not a gzip-compressed tar or that is out of bounds. */
export async function readArchive(archive: Blob): Promise<ArchiveSummary> {
  const pulled = new Puller(archive.stream().pipeThrough(new DecompressionStream('gzip')));
  const roots = new Set<string>();
  const summary: ArchiveSummary = { roots: [], files: 0, hasConfig: false, hasSoul: false, skills: 0, soul: undefined };
  let nextName: string | undefined;
  let entries = 0;
  try {
    for (;;) {
      const header = await pulled.take(BLOCK);
      if (header.byteLength < BLOCK || header.every((byte) => byte === 0)) break;
      if (++entries > MAX_ENTRIES) throw new ArchiveError('This archive has far more files than a profile, so it is not read.');
      const size = sizeOf(header);
      if (Number.isNaN(size)) throw new ArchiveError('This is not a .tar.gz archive: its listing is damaged.');
      const type = String.fromCharCode(header[156]!);
      const padded = Math.ceil(size / BLOCK) * BLOCK;
      // A long name comes first, as an entry of its own (GNU `L`, PAX `x`), for the entry after it.
      if (type === 'L' || type === 'x' || type === 'g') {
        if (size > MAX_NAME_DATA) throw new ArchiveError('This is not a .tar.gz archive: its listing is damaged.');
        const data = await pulled.take(padded);
        if (type === 'L') nextName = text(data.subarray(0, size));
        if (type === 'x') nextName = paxPath(data.subarray(0, size)) ?? nextName;
        continue;
      }
      const prefix = text(header.subarray(345, 500));
      const own = text(header.subarray(0, 100));
      const name = nextName ?? (prefix !== '' && decoder.decode(header.subarray(257, 262)) === 'ustar' ? `${prefix}/${own}` : own);
      nextName = undefined;
      // macOS's own tar writes a `._name` entry beside each file for its extended attributes, and `__MACOSX` folders: they are not the profile's.
      const place = split(name);
      const appleMetadata = name.split('/').some((part) => part.startsWith('._') || part === '__MACOSX');
      if (place && !appleMetadata) roots.add(place.root);
      const isFile = type === '0' || type === '\0';
      if (!isFile || !place || appleMetadata) {
        await pulled.skip(padded);
        continue;
      }
      summary.files++;
      if (place.rest === 'config.yaml') summary.hasConfig = true;
      if (place.rest.startsWith('skills/') && place.rest.endsWith('/SKILL.md')) summary.skills++;
      if (place.rest === 'SOUL.md') {
        summary.hasSoul = true;
        const data = await pulled.take(Math.min(size, SOUL_EXCERPT * 4));
        summary.soul = decoder.decode(data).slice(0, SOUL_EXCERPT);
        await pulled.skip(padded - data.byteLength);
      } else await pulled.skip(padded);
    }
  } finally {
    pulled.cancel();
  }
  if (entries === 0) throw new ArchiveError('This archive is empty, so there is no profile in it.');
  summary.roots = [...roots].sort();
  return summary;
}

/** What importing this archive would do, in words for the owner: the name Hermes would give the profile, and what is in the way. */
export interface ImportPreview {
  /** The profile name Hermes would make: the one chosen, or else the archive's own folder. `undefined` when the archive has no single folder. */
  name: string | undefined;
  /** Why the import cannot go ahead under this name, or `undefined`. */
  problem: string | undefined;
  /** The archive's own folder is `default`, which is Hermes's root profile: a new name must be chosen. */
  needsName: boolean;
}

/**
 * The name an archive would be imported under and whether anything is in its way: Hermes imports an archive with one top-level folder and
 * names the profile after it unless a name is given, refuses a name a profile has (a conflict) and refuses `default`.
 */
export function importPreview(summary: ArchiveSummary, chosen: string, taken: readonly string[]): ImportPreview {
  if (summary.roots.length !== 1) return { name: undefined, problem: 'This archive must hold exactly one profile folder. It is not a profile archive from Hermes.', needsName: false };
  const root = summary.roots[0]!.toLowerCase();
  const name = chosen.trim() === '' ? root : chosen.trim().toLowerCase();
  const needsName = chosen.trim() === '' && root === 'default';
  if (needsName) return { name: undefined, problem: 'This archive is of the root profile (default). Hermes does not import over it: choose a new name.', needsName };
  const problem = name === 'default' ? 'Hermes does not import as default: that is its root profile.' : renameProblem('', name, taken);
  return { name, problem, needsName };
}
