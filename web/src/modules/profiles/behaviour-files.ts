// What the profile editors know about a profile's behaviour files, free of the DOM and of React: which file is where, the request
// that reads it and the one that saves it, and what Hermes's answers mean. Everything is Hermes's (D1): the only copy Caduceus
// keeps is the snapshot the server takes before each write (`server/src/behaviour-files.ts`).

/** Where a behaviour file lives: Hermes has a route for the soul and the raw config, and the fs routes for the rest. */
export type FileRef = { kind: 'soul'; profile: string } | { kind: 'config'; profile: string } | { kind: 'file'; path: string };

/** The request the page sends to read or write a file (before the dialog's words are added). */
export interface FileRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export type BehaviourFileId = 'soul' | 'agents' | 'hermes' | 'memory' | 'user' | 'config';

/** The file of a profile an editor shows. `profilePath` is the profile's folder as Hermes's profile list says it. */
export function fileRef(id: BehaviourFileId, profile: string, profilePath: string): FileRef {
  switch (id) {
    case 'soul':
      return { kind: 'soul', profile };
    case 'config':
      return { kind: 'config', profile };
    case 'agents':
      return { kind: 'file', path: `${profilePath}/AGENTS.md` };
    case 'hermes':
      return { kind: 'file', path: `${profilePath}/HERMES.md` };
    case 'memory':
      return { kind: 'file', path: `${profilePath}/memories/MEMORY.md` };
    case 'user':
      return { kind: 'file', path: `${profilePath}/memories/USER.md` };
  }
}

/** The request that saves `text` as the whole file; `baseSha256` names the text it was made from, so a file that changed since is refused rather than overwritten. */
export function saveRequest(ref: FileRef, text: string, baseSha256?: string): FileRequest {
  const headers = baseSha256 ? { 'x-caduceus-base-sha256': baseSha256 } : undefined;
  switch (ref.kind) {
    case 'soul':
      return { method: 'PUT', path: `/api/profiles/${encodeURIComponent(ref.profile)}/soul`, body: { content: text }, headers };
    case 'config':
      return { method: 'PUT', path: `/api/config/raw?profile=${encodeURIComponent(ref.profile)}`, body: { yaml_text: text }, headers };
    case 'file':
      return { method: 'POST', path: '/api/fs/write-text', body: { path: ref.path, content: text }, headers };
  }
}

/** The Caduceus route that lists the snapshots of a file (newest first). */
export function snapshotsPath(ref: FileRef): string {
  const query = ref.kind === 'file' ? `kind=file&path=${encodeURIComponent(ref.path)}` : `kind=${ref.kind}&profile=${encodeURIComponent(ref.profile)}`;
  return `/_caduceus/api/file-snapshots?${query}`;
}

/** The Caduceus route that gives one snapshot, with its text. */
export function snapshotPath(id: number): string {
  return `/_caduceus/api/file-snapshots/${id}`;
}

/** SHA-256 in hex of a text, the way a save names the text it was made from. */
export async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Which of the profile's built-in memory files a reset clears. */
export type ResetTarget = 'memory' | 'user' | 'all';

/** The route that reads the profile's memory settings and the sizes of its two built-in files. */
export function memoryPath(profile: string): string {
  return `/api/memory?profile=${encodeURIComponent(profile)}`;
}

/** Resets MEMORY.md, USER.md or both through Hermes's memory route. */
export function memoryReset(profile: string, target: ResetTarget): FileRequest {
  return { method: 'POST', path: `/api/memory/reset?profile=${encodeURIComponent(profile)}`, body: { target } };
}

/** How much of its limit a built-in memory file uses. */
export interface MemoryFileUse {
  /** The file's size on disk, as Hermes's memory route reports it. */
  bytes: number;
  /** The most characters Hermes lets the file hold (`memory.memory_char_limit`, `memory.user_char_limit`). */
  limit: number;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const count = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);

/** Hermes's built-in limits, for a config that does not say (`DEFAULT_CONFIG.memory`). */
const DEFAULT_LIMITS = { memory: 2200, user: 1375 } as const;

/** Reads `GET /api/memory` (the sizes) and `GET /api/config` (the limits). Hermes types neither, so both are read defensively. */
export function memoryUse(memoryAnswer: unknown, configAnswer: unknown): { memory: MemoryFileUse; user: MemoryFileUse } {
  const sizes = record(record(memoryAnswer).builtin_files);
  const settings = record(record(configAnswer).memory);
  return {
    memory: { bytes: count(sizes.memory, 0), limit: count(settings.memory_char_limit, DEFAULT_LIMITS.memory) },
    user: { bytes: count(sizes.user, 0), limit: count(settings.user_char_limit, DEFAULT_LIMITS.user) },
  };
}

/** The route that reads a file from Hermes. */
export function readPath(ref: FileRef): string {
  switch (ref.kind) {
    case 'soul':
      return `/api/profiles/${encodeURIComponent(ref.profile)}/soul`;
    case 'config':
      return `/api/config/raw?profile=${encodeURIComponent(ref.profile)}`;
    case 'file':
      return `/api/fs/read-text?path=${encodeURIComponent(ref.path)}`;
  }
}

/** What reading a file gave: its text (`exists: false` for a file Hermes does not have yet), text that must not be edited here, or a failure. */
export type ReadResult = { state: 'ready'; text: string; exists: boolean } | { state: 'unsafe'; reason: string } | { state: 'failed'; message: string };

const detailOf = (body: unknown, status: number): string => {
  const { detail } = record(body);
  return typeof detail === 'string' ? detail : `Hermes answered HTTP ${status}.`;
};

/** Reads Hermes's answer to `readPath`. A file the editor could not save back whole (cut short, binary, too large) is `unsafe`: it is shown, never edited. */
export function readResult(ref: FileRef, status: number, body: unknown): ReadResult {
  const answer = record(body);
  if (ref.kind === 'file') {
    if (status === 404) return { state: 'ready', text: '', exists: false };
    if (status === 413) return { state: 'unsafe', reason: 'This file is too large to edit here.' };
    if (status !== 200) return { state: 'failed', message: detailOf(body, status) };
    if (typeof answer.text !== 'string') return { state: 'failed', message: 'Hermes did not answer with the file’s text.' };
    if (answer.binary === true) return { state: 'unsafe', reason: 'This file is not text, so it cannot be edited here.' };
    if (answer.truncated === true) return { state: 'unsafe', reason: 'This file is too large to edit here: Hermes sent only its start, and saving would cut the rest off.' };
    return { state: 'ready', text: answer.text, exists: true };
  }
  if (status !== 200) return { state: 'failed', message: detailOf(body, status) };
  const text = ref.kind === 'soul' ? answer.content : answer.yaml;
  if (typeof text !== 'string') return { state: 'failed', message: 'Hermes did not answer with the file’s text.' };
  return { state: 'ready', text, exists: ref.kind === 'config' || answer.exists !== false };
}

/** Where a YAML text is wrong, for a message the owner can act on. Lines and columns count from 1. */
export interface YamlProblem {
  line: number;
  column: number;
  message: string;
}

const NOT_A_MAPPING = 'The file must be a mapping of keys to values.';

/** The first thing wrong with a config.yaml before it is saved: YAML that does not parse, a repeated key, or a document that is not a mapping. The YAML library loads when first needed. */
export async function yamlProblem(text: string): Promise<YamlProblem | undefined> {
  const { parseDocument, isMap } = await import('yaml');
  const document = parseDocument(text);
  const [error] = document.errors;
  if (error) {
    const [position] = error.linePos ?? [{ line: 1, col: 1 }];
    return { line: position.line, column: position.col, message: error.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '') };
  }
  if (!isMap(document.contents)) return { line: 1, column: 1, message: NOT_A_MAPPING };
  return undefined;
}

export interface DiffRow {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

/** Past this many cells of comparison a change is shown whole instead (a conflict diff is for reading, not for huge files). */
const MAX_DIFF_CELLS = 4_000_000;

const linesOf = (text: string): string[] => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

/** The lines two texts share, and the ones removed from the first and added in the second, in reading order. */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = linesOf(before);
  const b = linesOf(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const middleA = a.slice(head, a.length - tail);
  const middleB = b.slice(head, b.length - tail);
  const rows: DiffRow[] = a.slice(0, head).map((text) => ({ kind: 'same', text }));
  if (middleA.length * middleB.length > MAX_DIFF_CELLS) {
    rows.push(...middleA.map((text): DiffRow => ({ kind: 'removed', text })), ...middleB.map((text): DiffRow => ({ kind: 'added', text })));
  } else {
    // Longest common subsequence of the middle, from the end so the walk below reads forwards.
    const width = middleB.length + 1;
    const table = new Uint32Array((middleA.length + 1) * width);
    for (let i = middleA.length - 1; i >= 0; i--) {
      for (let j = middleB.length - 1; j >= 0; j--) {
        table[i * width + j] = middleA[i] === middleB[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < middleA.length || j < middleB.length) {
      if (i < middleA.length && j < middleB.length && middleA[i] === middleB[j]) rows.push({ kind: 'same', text: middleA[i++] }), j++;
      else if (j >= middleB.length || (i < middleA.length && table[(i + 1) * width + j] >= table[i * width + j + 1])) rows.push({ kind: 'removed', text: middleA[i++] });
      else rows.push({ kind: 'added', text: middleB[j++] });
    }
  }
  rows.push(...a.slice(a.length - tail).map((text): DiffRow => ({ kind: 'same', text })));
  return rows;
}

/** What the editor of one behaviour file says about it. */
export interface BehaviourFile {
  id: BehaviourFileId;
  /** The file's name as the owner knows it. */
  label: string;
  /** A sentence about what Hermes uses the file for. */
  blurb: string;
  /** The text is Markdown, so it has a Preview; config.yaml is YAML and has none. */
  markdown: boolean;
  /** The built-in memory file this is, which has a size and a limit. */
  memory?: 'memory' | 'user';
}

export const BEHAVIOUR_FILES: Readonly<Record<BehaviourFileId, BehaviourFile>> = {
  soul: { id: 'soul', label: 'SOUL.md', markdown: true, blurb: 'Who this agent is: its voice, values and way of working. Hermes puts it at the start of every conversation.' },
  agents: { id: 'agents', label: 'AGENTS.md', markdown: true, blurb: 'Standing instructions for this profile: conventions, rules and anything it should always know about your work.' },
  hermes: { id: 'hermes', label: 'HERMES.md', markdown: true, blurb: 'Instructions written for Hermes in particular, read in the same way as AGENTS.md.' },
  memory: { id: 'memory', label: 'MEMORY.md', markdown: true, memory: 'memory', blurb: 'What the agent has learned and chooses to remember. It writes here itself, within a size limit.' },
  user: { id: 'user', label: 'USER.md', markdown: true, memory: 'user', blurb: 'What the agent knows about you. It writes here itself, within a size limit.' },
  config: { id: 'config', label: 'config.yaml', markdown: false, blurb: 'Every Hermes setting of this profile, as one YAML file. Credentials are hidden; a save keeps them as they are.' },
};

/** How full a built-in memory file is, for the meter: the characters the text has against the limit. */
export function memoryMeter(text: string, limit: number): { used: number; limit: number; percent: number; over: boolean } {
  const used = [...text].length;
  return { used, limit, percent: limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100)), over: used > limit };
}

/** The route that lists the folder a file is in (a file of Hermes's fs routes only). */
export function listPath(ref: Extract<FileRef, { kind: 'file' }>): string {
  return `/api/fs/list?path=${encodeURIComponent(ref.path.slice(0, ref.path.lastIndexOf('/')))}`;
}

/** Whether the listing `listPath` gave has the file. An answer that is not a listing is no evidence, so the file is read after all. */
export function isListed(ref: Extract<FileRef, { kind: 'file' }>, answer: unknown): boolean {
  const { entries, error } = record(answer);
  if (!Array.isArray(entries)) return true;
  if (typeof error === 'string') return false;
  const name = ref.path.slice(ref.path.lastIndexOf('/') + 1);
  return entries.some((entry) => record(entry).name === name && record(entry).isDirectory !== true);
}
