// Path references in the composer (M1 #09), free of the DOM and of React. `@` names a file or folder of the session's workspace for Hermes to read
// (its own `@file:` and `@folder:` references, which Hermes expands into the prompt), and `~/` a path from the owner's home. What the menu lists is
// Hermes's file listing (`GET /api/fs/list`, through the policy proxy's file guard); this module reads the word at the caret, says which folder to
// ask for, and turns an entry into the text that goes in the box.

/** One entry of Hermes's `fs/list`. */
export interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface PathToken {
  /** Where the word starts and ends in the text (the end is the caret). */
  start: number;
  end: number;
  /** What opened it: an `@`, or a bare `~/`. */
  lead: 'at' | 'home';
  /** Where the path starts from: the session's workspace, the owner's home, or the root of the file system. */
  root: 'workspace' | 'home' | 'absolute';
  /** The folder typed so far, ending in a slash (`src/`, `~/work/`), or nothing. */
  dir: string;
  /** The name being typed in it. */
  prefix: string;
  /** Hermes's `@file:` or `@folder:` form narrows the list to one kind. */
  only?: 'file' | 'folder';
}

export interface PathItem {
  /** What the row says: the name, with a slash after a folder. */
  label: string;
  detail: string;
  directory: boolean;
  /** What replaces the word in the box. A word that ends in a space is finished; one that ends in a slash goes on into the folder. */
  insert: string;
}

const MAX_ITEMS = 30;
const OPENING_QUOTES = '`"\'';

/** The word under the caret, if it is a path reference being typed. */
export function pathTokenAt(text: string, caret: number): PathToken | undefined {
  const start = Math.max(text.lastIndexOf(' ', caret - 1), text.lastIndexOf('\n', caret - 1), text.lastIndexOf('\t', caret - 1)) + 1;
  const word = text.slice(start, caret);
  const lead = word.startsWith('@') ? 'at' : word.startsWith('~/') ? 'home' : undefined;
  if (lead === undefined) return undefined;
  let value = lead === 'at' ? word.slice(1) : word;
  let only: PathToken['only'];
  const kind = /^(file|folder):/.exec(value);
  if (lead === 'at' && kind) {
    only = kind[1] as 'file' | 'folder';
    value = value.slice(kind[0].length);
  }
  if (lead === 'at' && value !== '' && OPENING_QUOTES.includes(value[0]!)) value = value.slice(1);
  const slash = value.lastIndexOf('/');
  return {
    start,
    end: caret,
    lead,
    root: value.startsWith('~/') ? 'home' : value.startsWith('/') ? 'absolute' : 'workspace',
    dir: value.slice(0, slash + 1),
    prefix: value.slice(slash + 1),
    ...(only === undefined ? {} : { only }),
  };
}

/** The folder to ask Hermes to list for a token: the workspace (or a folder in it), the home folder or the absolute one. Undefined when the workspace is not known. */
export function listingPath(token: PathToken, workspace: string | undefined): string | undefined {
  if (token.root !== 'workspace') return token.dir;
  if (workspace === undefined) return undefined;
  return token.dir === '' ? workspace : `${workspace.replace(/\/$/, '')}/${token.dir}`;
}

/** Hermes reads a reference with a space or a bracket in it back only when it is quoted. */
const NEEDS_QUOTING = /[\s()[\]{}<>"'`]/;

/** Hermes's `format_reference_value`: the value as it is read back whole, in the first quote the value does not contain. */
export function referenceValue(value: string): string {
  if (!NEEDS_QUOTING.test(value)) return value;
  const quote = [...OPENING_QUOTES].find((candidate) => !value.includes(candidate));
  return quote === undefined ? value : `${quote}${value}${quote}`;
}

/** The rows for what is typed, from Hermes's listing of the folder: names that start with it, hidden files only when a dot was typed, the first thirty. */
export function pathItems(token: PathToken, entries: readonly FolderEntry[]): PathItem[] {
  const typed = token.prefix.toLowerCase();
  const items: PathItem[] = [];
  const fromHome = token.root === 'home';
  // Just inside a folder, the folder itself can be the reference.
  if (!fromHome && token.dir !== '' && typed === '' && token.only !== 'file') {
    items.push({ label: token.dir, detail: 'The whole folder', directory: true, insert: `@folder:${referenceValue(token.dir)} ` });
  }
  for (const entry of entries) {
    if (items.length >= MAX_ITEMS) break;
    if (!entry.name.toLowerCase().startsWith(typed)) continue;
    if (entry.name.startsWith('.') && !token.prefix.startsWith('.')) continue;
    if ((token.only === 'file' && entry.isDirectory) || (token.only === 'folder' && !entry.isDirectory)) continue;
    const path = token.dir + entry.name;
    const label = entry.isDirectory ? `${entry.name}/` : entry.name;
    const detail = entry.isDirectory ? 'Folder' : 'File';
    if (fromHome) {
      // A home path is plain text, as Hermes writes it: a folder is opened, a file ends the word.
      const opens = entry.isDirectory && !/\s/.test(path);
      items.push({ label, detail, directory: entry.isDirectory, insert: entry.isDirectory ? (opens ? `${path}/` : `${path}/ `) : `${path} ` });
      continue;
    }
    const quoted = referenceValue(path);
    if (entry.isDirectory && quoted === path) {
      items.push({ label, detail, directory: true, insert: `@${token.only === 'folder' ? 'folder:' : ''}${path}/` });
    } else {
      items.push({ label, detail, directory: entry.isDirectory, insert: `@${entry.isDirectory ? 'folder' : 'file'}:${quoted} ` });
    }
  }
  return items;
}

/** The text after choosing a row: it replaces the word, and a finished reference does not leave two spaces when the text goes on with one. */
export function applyPath(text: string, token: PathToken, item: PathItem): { text: string; caret: number } {
  const after = text.slice(token.end);
  const insert = item.insert.endsWith(' ') && /^\s/.test(after) ? item.insert.slice(0, -1) : item.insert;
  return { text: text.slice(0, token.start) + insert + after, caret: token.start + insert.length };
}
