// Unpacking an archive in the browser (M1 #10), free of React and with no library: `.zip` is read from its central directory and inflated with the
// browser's own `DecompressionStream`; `.tar`, `.tar.gz` and `.tgz` are read block by block. Each file in it comes out as a candidate for the owner's
// attachments. What cannot be unpacked is reported by name with its reason, never dropped without a word.
import { kindOf, refusalOf, MAX_ATTACHMENTS, type Candidate, type Problem } from './attachments.ts';

const MB = 1024 * 1024;
/** The largest archive that is opened, and the most all its files may hold once unpacked (a small zip can hold a great deal). */
export const ARCHIVE_LIMIT = 100 * MB;
export const UNPACKED_LIMIT = 200 * MB;

export interface Unpacked {
  entries: Candidate[];
  problems: Problem[];
}

const ARCHIVE_NAME = /\.(zip|tar|tar\.gz|tgz)$/i;

/** True for what is unpacked here. A `.rar` or `.7z` is attached as the one file it is, for the agent to open. */
export function isArchive(name: string): boolean {
  return ARCHIVE_NAME.test(name);
}

/** The macOS folders and files an archiver adds on its own: they are not the owner's files. */
const isLitter = (path: string) => /(^|\/)(__MACOSX|\.DS_Store|\._[^/]*)(\/|$)/.test(path);
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Inflates the bytes, reading no more than `limit` of them: `'over'` when there are more, undefined when they cannot be inflated. */
async function inflate(compressed: Blob, format: 'deflate-raw' | 'gzip', limit: number): Promise<Uint8Array | 'over' | undefined> {
  const reader = compressed.stream().pipeThrough(new DecompressionStream(format)).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        return 'over';
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** One file found in an archive, before it is read. */
interface Found {
  path: string;
  size: number;
  /** Why it cannot be read, if it cannot. */
  problem?: string;
  read(): Promise<Blob | undefined>;
}

/** Turns what was found into candidates: the first `room` that can be read, with the rest and the unreadable named with their reasons. */
async function collect(archive: string, found: readonly Found[], room: number): Promise<Unpacked> {
  const entries: Candidate[] = [];
  const problems: Problem[] = [];
  let unpacked = 0;
  for (const entry of found) {
    const name = `${archive} › ${entry.path}`;
    const refusal = entry.problem ?? refusalOf(kindOf(baseName(entry.path), ''), entry.size);
    if (refusal !== undefined) problems.push({ name, reason: refusal });
    else if (entries.length >= room) problems.push({ name, reason: `A message takes at most ${MAX_ATTACHMENTS} attachments.` });
    else if ((unpacked += entry.size) > UNPACKED_LIMIT) problems.push({ name, reason: `The archive holds more than ${UNPACKED_LIMIT / MB} MB once unpacked.` });
    else {
      const body = await entry.read();
      if (body === undefined) problems.push({ name, reason: 'It could not be unpacked: the archive is damaged.' });
      else entries.push({ name: baseName(entry.path), body, origin: name });
    }
  }
  return { entries, problems };
}

const u16 = (view: DataView, at: number) => view.getUint16(at, true);
const u32 = (view: DataView, at: number) => view.getUint32(at, true);

const END_OF_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const SYMLINK = 0o120000;
const NOT_ZIP = 'It is not a zip archive, or it is damaged.';
const NOT_TAR = 'It is not a tar archive, or it is damaged.';

async function zipEntries(file: Blob): Promise<Found[] | string> {
  // The end record is in the last 22 bytes, or before a comment of up to 64 KB.
  const tailStart = Math.max(0, file.size - 0xffff - 22);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let at = tail.byteLength - 22; at >= 0; at--) {
    if (u32(tail, at) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) return NOT_ZIP;
  const count = u16(tail, end + 10);
  const directorySize = u32(tail, end + 12);
  const directoryAt = u32(tail, end + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryAt === 0xffffffff) return 'Zip archives over 4 GB (zip64) are not opened here.';
  const directory = new DataView(await file.slice(directoryAt, directoryAt + directorySize).arrayBuffer());
  const names = new TextDecoder();
  const found: Found[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.byteLength || u32(directory, at) !== CENTRAL_ENTRY) return NOT_ZIP;
    const madeBy = u16(directory, at + 4);
    const flags = u16(directory, at + 8);
    const method = u16(directory, at + 10);
    const packed = u32(directory, at + 20);
    const size = u32(directory, at + 24);
    const nameLength = u16(directory, at + 28);
    const extraLength = u16(directory, at + 30);
    const commentLength = u16(directory, at + 32);
    const attributes = u32(directory, at + 38);
    const localAt = u32(directory, at + 42);
    const path = names.decode(new Uint8Array(directory.buffer, at + 46, nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/') || isLitter(path)) continue;
    const problem =
      (flags & 1) === 1 ? 'It is password protected.'
      : madeBy >> 8 === 3 && ((attributes >>> 16) & 0o170000) === SYMLINK ? 'It is a link, not a file.'
      : method !== 0 && method !== 8 ? 'It uses a compression this page cannot read.'
      : undefined;
    found.push({
      path,
      size,
      ...(problem === undefined ? {} : { problem }),
      async read() {
        const header = new DataView(await file.slice(localAt, localAt + 30).arrayBuffer());
        if (header.byteLength < 30 || u32(header, 0) !== LOCAL_ENTRY) return undefined;
        const dataAt = localAt + 30 + u16(header, 26) + u16(header, 28);
        const body = file.slice(dataAt, dataAt + packed);
        if (method === 0) return body.size === size ? body : undefined;
        // The entry says how large it is: more than that comes out of a damaged or hostile one, and is not read on.
        const bytes = await inflate(body, 'deflate-raw', size);
        return bytes instanceof Uint8Array && bytes.length === size ? new Blob([bytes as BlobPart]) : undefined;
      },
    });
  }
  return found;
}

const BLOCK = 512;

/** The text of a fixed-size field of a tar header: up to its first NUL. */
function field(header: Uint8Array, at: number, length: number): string {
  const bytes = header.subarray(at, at + length);
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
}

/** The `path` a pax extended header sets for the entry after it (`<length> path=<value>\n` records). */
function paxPath(payload: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(payload);
  return /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text)?.[1];
}

function tarEntries(data: Uint8Array): Found[] | string {
  const found: Found[] = [];
  let at = 0;
  let longName: string | undefined;
  for (;;) {
    // A tar ends with blocks of zeros, though a tool that stops short of them is read all the same.
    if (at + BLOCK > data.length) return found.length > 0 ? found : NOT_TAR;
    const header = data.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) return found.length > 0 || at > 0 ? found : NOT_TAR;
    // The checksum is the sum of the header's bytes with its own field read as spaces.
    const expected = parseInt(field(header, 148, 8).trim(), 8);
    let sum = 0;
    for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 32 : header[index]!;
    if (expected !== sum) return NOT_TAR;
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    if (!(at + BLOCK + size <= data.length)) return NOT_TAR;
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]!);
    const prefix = field(header, 345, 155);
    let path = prefix !== '' && field(header, 257, 5) === 'ustar' ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100);
    const payload = data.subarray(at + BLOCK, at + BLOCK + size);
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'L') longName = field(payload, 0, payload.length);
    else if (type === 'x') longName = paxPath(payload) ?? longName;
    else if (type !== 'g') {
      path = longName ?? path;
      longName = undefined;
      if (type === '5' || isLitter(path)) continue;
      const problem = type === '0' || type === '7' ? undefined : type === '1' || type === '2' ? 'It is a link, not a file.' : 'It is not a regular file.';
      found.push({ path, size, ...(problem === undefined ? {} : { problem }), read: async () => new Blob([payload as BlobPart]) });
    }
  }
}

/** Unpacks an archive: its files as candidates (the first `room` of them), and by name everything that was left out and why. */
export async function unpackArchive(archive: { name: string; body: Blob }, room: number): Promise<Unpacked> {
  const refused = (reason: string): Unpacked => ({ entries: [], problems: [{ name: archive.name, reason }] });
  if (archive.body.size > ARCHIVE_LIMIT) return refused(`An archive may be at most ${ARCHIVE_LIMIT / MB} MB; this one is ${(archive.body.size / MB).toFixed(1)} MB.`);
  let found: Found[] | string;
  if (/\.zip$/i.test(archive.name)) found = await zipEntries(archive.body);
  else {
    const gzipped = /\.(tar\.gz|tgz)$/i.test(archive.name);
    const data = gzipped ? await inflate(archive.body, 'gzip', UNPACKED_LIMIT) : new Uint8Array(await archive.body.arrayBuffer());
    if (data === 'over') return refused(`The archive holds more than ${UNPACKED_LIMIT / MB} MB once unpacked.`);
    found = data === undefined ? NOT_TAR : tarEntries(data);
  }
  if (typeof found === 'string') return refused(found);
  return collect(archive.name, found, room);
}
