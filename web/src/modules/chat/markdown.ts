// Markdown for the transcript (M1 #04): a pure parser from text to a small tree, and the URL rules the tree is made under.
// No DOM, no React, no HTML: raw HTML in a message is only ever text, so there is nothing to sanitise afterwards, and the
// renderer builds elements from the tree alone. It is a CommonMark/GFM subset chosen for what agents write (headings, lists,
// tasks, quotes, fences, tables, maths, links, images), and it parses text that is still arriving: whatever has not closed yet
// is shown as it stands (an open fence is an open code block, a half-typed link or `**` is text, a cut table row is padded).

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'em' | 'strong' | 'del'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'math'; tex: string }
  | { t: 'br' };

export type MediaKind = 'image' | 'audio' | 'video' | 'pdf';
export type Align = 'left' | 'right' | 'center' | undefined;

export interface ListItem {
  /** Task list state (`[ ]` / `[x]`), when the item is one. */
  checked?: boolean;
  blocks: Block[];
}

export type Block =
  | { t: 'paragraph'; children: Inline[] }
  | { t: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; children: Inline[] }
  | { t: 'code'; lang: string; text: string; /** The fence has not closed yet: the reply is still arriving. */ open: boolean }
  | { t: 'math'; tex: string; open: boolean }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'quote'; children: Block[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][]; open: boolean }
  | { t: 'rule' }
  | { t: 'media'; kind: MediaKind; src: string; alt: string }
  /** A file on Hermes's disk a reply delivers with a `MEDIA:<path>` line, other than an image (those are `media`). */
  | { t: 'file'; path: string; name: string };

export interface Markdown {
  blocks: Block[];
  /** The source text of each top-level block, so that a screen can leave alone a block whose text did not change while a reply streams. */
  sources: string[];
}

export type FenceKind = 'mermaid' | 'json' | 'yaml' | 'html' | 'code';

/** What a fenced block is rendered as: a diagram, a tree, a sandboxed preview, or highlighted code. */
export function classifyFence(lang: string): FenceKind {
  switch (lang.toLowerCase()) {
    case 'mermaid':
      return 'mermaid';
    case 'json':
    case 'jsonc':
    case 'json5':
      return 'json';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'html':
      return 'html';
    default:
      return 'code';
  }
}

const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

/** What a media URL is, from its file extension (query and fragment ignored): anything unrecognised is taken for an image. */
export function mediaKindOf(url: string): MediaKind {
  const path = url.split(/[?#]/, 1)[0]!;
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  if (extension === 'pdf') return 'pdf';
  if (AUDIO.has(extension)) return 'audio';
  if (VIDEO.has(extension)) return 'video';
  return 'image';
}

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]*$/i;

/**
 * The URL to put in an `href` or a media `src`, or undefined when it must not be used. Only http(s), mailto, tel and
 * relative references pass (media also takes a base64 raster data image; never SVG, which can carry script). Browsers drop
 * tabs, newlines and control characters inside a scheme (`java\nscript:`), so those are removed before the scheme is read.
 */
export function safeUrl(url: string, purpose: 'link' | 'media'): string | undefined {
  const target = url.trim();
  // eslint-disable-next-line no-control-regex
  const seen = target.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (seen === '' || seen !== target.replace(/[\t\n\r]/g, '') || /^\/\//.test(seen)) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(seen)?.[1]?.toLowerCase();
  if (scheme === undefined) return target;
  if (scheme === 'http' || scheme === 'https') return target;
  if (purpose === 'link' && (scheme === 'mailto' || scheme === 'tel')) return target;
  if (purpose === 'media' && scheme === 'data' && SAFE_DATA_IMAGE.test(target)) return target;
  return undefined;
}

const RASTER_IMAGE = /\.(?:png|jpe?g|gif|webp|bmp)$/i;

/** The file on Hermes's disk a source names (`/abs/path`, `~/path`, `file:///abs/path`), or undefined when it is a web address, relative, or a folder. */
function localPath(src: string): string | undefined {
  let path = src.trim();
  if (/^file:/i.test(path)) {
    const local = /^file:\/\/(\/[^?#]*)$/i.exec(path)?.[1];
    if (local === undefined) return undefined;
    try {
      path = decodeURIComponent(local);
    } catch {
      return undefined;
    }
  }
  return (/^\/(?!\/)/.test(path) || path.startsWith('~/')) && !path.endsWith('/') ? path : undefined;
}

/**
 * The file on Hermes's disk an image source names (`/abs/path.png`, `~/path.png`, `file:///abs/path.png`), or undefined when the
 * source is a web address or not a raster image. The page reads such a file through Hermes (`media-url.ts`); the page's own
 * server has nothing at that address.
 */
export function localImagePath(src: string): string | undefined {
  const path = localPath(src);
  return path !== undefined && RASTER_IMAGE.test(path) ? path : undefined;
}

/** The words of inline content, markup dropped. */
export function inlineText(inlines: readonly Inline[]): string {
  return inlines
    .map((node) => {
      switch (node.t) {
        case 'text':
        case 'code':
          return node.text;
        case 'math':
          return node.tex;
        case 'br':
          return ' ';
        case 'image':
          return node.alt;
        default:
          return inlineText(node.children);
      }
    })
    .join('');
}

// ---- inline ----

const PUNCTUATION = /[!-/:-@[-`{-~]/;

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);

/** Index of the `]` that closes the `[` at `open`, nesting counted; -1 when there is none. */
function closingBracket(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const char = src[i];
    if (char === '\\') i++;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) return i;
  }
  return -1;
}

/** `(url "title")` at `at`: the URL and the index after the `)`, or undefined when it is not (yet) complete. */
function destinationAt(src: string, at: number): { url: string; end: number } | undefined {
  if (src[at] !== '(') return undefined;
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const char = src[i];
    if (char === '\\') i++;
    else if (char === '\n') return undefined;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) {
      const inside = src.slice(at + 1, i).trim();
      const url = /^<([^>]*)>/.exec(inside)?.[1] ?? inside.replace(/\s+(?:"[^"]*"|'[^']*')$/, '');
      return /\s/.test(url) ? undefined : { url, end: i + 1 };
    }
  }
  return undefined;
}

/** Index of the closer of an emphasis run opened at `from` with `delimiter`; -1 when it has not arrived. */
function closerOf(src: string, from: number, delimiter: string): number {
  for (let k = from; k < src.length; k++) {
    if (src[k] === '\\') {
      k++;
      continue;
    }
    if (src[k] === '`') {
      const end = src.indexOf('`', k + 1);
      if (end < 0) return -1;
      k = end;
      continue;
    }
    if (!src.startsWith(delimiter, k) || isSpace(src[k - 1])) continue;
    if (delimiter.length === 1 && src[k + 1] === delimiter) {
      k++;
      continue;
    }
    if (delimiter === '_' && /\w/.test(src[k + 1] ?? '')) continue;
    return k;
  }
  return -1;
}

const BARE_URL = /^https?:\/\/[^\s<>]+/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ t: 'text', text: buffer });
    buffer = '';
  };
  const push = (...nodes: Inline[]) => {
    flush();
    out.push(...nodes);
  };

  for (let i = 0; i < src.length; ) {
    const char = src[i]!;
    const rest = src.slice(i);

    if (char === '\\') {
      if (src[i + 1] === '(') {
        const end = src.indexOf('\\)', i + 2);
        if (end > i + 2) {
          push({ t: 'math', tex: src.slice(i + 2, end).trim() });
          i = end + 2;
          continue;
        }
      }
      if (i + 1 < src.length && PUNCTUATION.test(src[i + 1]!)) {
        buffer += src[i + 1];
        i += 2;
      } else {
        buffer += char;
        i++;
      }
      continue;
    }
    if (char === '\n') {
      push({ t: 'br' });
      i++;
      continue;
    }
    if (char === '`') {
      const run = /^`+/.exec(rest)![0];
      let end = i + run.length;
      let found = -1;
      while (end < src.length) {
        const next = src.indexOf('`', end);
        if (next < 0) break;
        const length = /^`+/.exec(src.slice(next))![0].length;
        if (length === run.length) {
          found = next;
          break;
        }
        end = next + length;
      }
      if (found < 0) {
        buffer += run;
        i += run.length;
      } else {
        const code = src.slice(i + run.length, found).replace(/\n/g, ' ');
        push({ t: 'code', text: /^ .*[^ ].* $/.test(code) ? code.slice(1, -1) : code });
        i = found + run.length;
      }
      continue;
    }
    if (char === '$' && src[i + 1] !== '$' && !isSpace(src[i + 1])) {
      let end = i + 1;
      let found = -1;
      while ((end = src.indexOf('$', end)) >= 0) {
        if (src[end - 1] === '\\') {
          end++;
          continue;
        }
        if (!isSpace(src[end - 1]) && !/\d/.test(src[end + 1] ?? '') && !src.slice(i, end).includes('\n')) found = end;
        break;
      }
      if (found > 0) {
        push({ t: 'math', tex: src.slice(i + 1, found) });
        i = found + 1;
        continue;
      }
    }
    if (char === '!' || char === '[') {
      const open = char === '!' ? i + 1 : i;
      if (src[open] === '[') {
        const close = closingBracket(src, open);
        const destination = close > 0 ? destinationAt(src, close + 1) : undefined;
        if (destination) {
          const label = src.slice(open + 1, close);
          if (char === '!') {
            const kind = localImagePath(destination.url) ?? safeUrl(destination.url, 'media');
            const alt = inlineText(parseInline(label));
            if (kind === undefined) push({ t: 'text', text: alt });
            else if (mediaKindOf(kind) === 'image') push({ t: 'image', src: kind, alt });
            else push({ t: 'link', href: kind, children: [{ t: 'text', text: alt || kind }] });
          } else {
            const href = safeUrl(destination.url, 'link');
            if (href === undefined) push(...parseInline(label));
            else push({ t: 'link', href, children: parseInline(label) });
          }
          i = destination.end;
          continue;
        }
      }
    }
    if (char === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto) {
        const href = safeUrl(auto[1]!, 'link');
        push(href === undefined ? { t: 'text', text: auto[1]! } : { t: 'link', href, children: [{ t: 'text', text: auto[1]! }] });
        i += auto[0].length;
        continue;
      }
    }
    // A URL right after `](` is the unfinished target of a link still arriving: it stays text until the link closes.
    if ((char === 'h' || char === 'H') && /^https?:\/\//i.test(rest) && !/\w/.test(src[i - 1] ?? ' ') && !src.slice(0, i).endsWith('](')) {
      let url = BARE_URL.exec(rest)![0];
      url = url.replace(/[.,;:!?'"*_~]+$/, '');
      while (url.endsWith(')') && (url.match(/\)/g) ?? []).length > (url.match(/\(/g) ?? []).length) url = url.slice(0, -1);
      const href = safeUrl(url, 'link');
      if (href !== undefined && url.length > 8) {
        push({ t: 'link', href, children: [{ t: 'text', text: url }] });
        i += url.length;
        continue;
      }
    }
    let matched = false;
    for (const [delimiter, node] of [['**', 'strong'], ['__', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em']] as const) {
      if (!src.startsWith(delimiter, i) || isSpace(src[i + delimiter.length]) || (delimiter.length === 1 && src[i + 1] === delimiter)) continue;
      if (delimiter === '_' && /\w/.test(src[i - 1] ?? '')) continue;
      const close = closerOf(src, i + delimiter.length, delimiter);
      if (close < 0) continue;
      push({ t: node, children: parseInline(src.slice(i + delimiter.length, close)) });
      i = close + delimiter.length;
      matched = true;
      break;
    }
    if (matched) continue;
    // Nothing above took this character: it is text.
    buffer += char;
    i++;
  }
  flush();
  return out;
}

// ---- blocks ----

interface Context {
  streaming: boolean;
  /** The slugs given so far in this message: a repeated heading gets a suffix. */
  slugs: Record<string, number>;
}

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const MARKER = /^( *)([-*+]|\d{1,9}[.)])( +|$)/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const blank = (line: string) => line.trim() === '';

/** The cells of one table row: the pipes outside code and escapes split it. */
function cellsOf(line: string): string[] {
  const text = line.trim().replace(/^\|/, '');
  const cells: string[] = [];
  let cell = '';
  let code = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (char === '`') {
      code = !code;
      cell += char;
    } else if (char === '|' && !code) {
      cells.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  if (cell.trim() !== '' || !/\|\s*$/.test(line)) cells.push(cell.trim());
  return cells;
}

const startsTable = (lines: readonly string[], at: number) => {
  const head = lines[at]!;
  const delimiter = lines[at + 1];
  return head.includes('|') && delimiter !== undefined && TABLE_DELIMITER.test(delimiter) && delimiter.includes('-') && cellsOf(delimiter).length === cellsOf(head).length;
};

const MATH_OPEN = /^\s*(\$\$|\\\[)(.*)$/;
// Hermes's `MEDIA:<path>` delivery line: the path bare or in backticks or quotes, emphasis around the tag allowed.
const MEDIA_LINE = /^\s*[*_"']{0,3}MEDIA:\s*(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|(\S+?))[*_"']{0,3}\s*$/;

/** The file on Hermes a whole line delivers as `MEDIA:<path>`, or undefined when the line is not one. */
function mediaLinePath(line: string): string | undefined {
  const tag = MEDIA_LINE.exec(line);
  return tag ? localPath(tag[1] ?? tag[2] ?? tag[3] ?? tag[4]!) : undefined;
}

/** Whether `line` begins something that ends a paragraph. */
function interrupts(lines: readonly string[], at: number): boolean {
  const line = lines[at]!;
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || /^ {0,3}>/.test(line) || MARKER.test(line) || MATH_OPEN.test(line) || startsTable(lines, at) || mediaLinePath(line) !== undefined;
}

function slugOf(text: string, context: Context): string {
  const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
  const count = (context.slugs[base] = (context.slugs[base] ?? 0) + 1);
  return count === 1 ? base : `${base}-${count}`;
}

function parseBlocks(lines: readonly string[], context: Context, record?: (start: number, end: number) => void): Block[] {
  const blocks: Block[] = [];
  const add = (block: Block, start: number, end: number) => {
    blocks.push(block);
    record?.(start, end);
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const start = i;
    if (blank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2]!;
      const indent = fence[1]!.length;
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        const trimmed = lines[j]!.trim();
        if (trimmed.startsWith(marker[0]!.repeat(marker.length)) && /^(`+|~+)$/.test(trimmed)) {
          closed = true;
          break;
        }
        body.push(lines[j]!.replace(new RegExp(`^ {0,${indent}}`), ''));
      }
      add({ t: 'code', lang: fence[3]!, text: body.join('\n'), open: !closed && context.streaming }, start, closed ? j + 1 : j);
      i = closed ? j + 1 : j;
      continue;
    }

    const math = MATH_OPEN.exec(line);
    if (math) {
      const closer = math[1] === '$$' ? '$$' : '\\]';
      const first = math[2]!;
      const same = first.trimEnd().endsWith(closer) && first.trim().length >= closer.length;
      if (same) {
        add({ t: 'math', tex: first.trimEnd().slice(0, -closer.length).trim(), open: false }, start, i + 1);
        i++;
        continue;
      }
      const body = first.trim() === '' ? [] : [first];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        const trimmed = lines[j]!.trimEnd();
        if (trimmed.endsWith(closer)) {
          const before = trimmed.slice(0, -closer.length);
          if (before.trim() !== '') body.push(before);
          closed = true;
          break;
        }
        body.push(lines[j]!);
      }
      if (closed || context.streaming) {
        add({ t: 'math', tex: body.join('\n').trim(), open: !closed }, start, closed ? j + 1 : j);
        i = closed ? j + 1 : j;
        continue;
      }
      // A complete message with a `$$` that never closes: it was not a formula.
    }

    const heading = HEADING.exec(line);
    if (heading && !MATH_OPEN.test(line)) {
      const children = parseInline(heading[2] ?? '');
      add({ t: 'heading', level: heading[1]!.length as 1, id: slugOf(inlineText(children), context), children }, start, i + 1);
      i++;
      continue;
    }

    if (RULE.test(line)) {
      add({ t: 'rule' }, start, i + 1);
      i++;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const body: string[] = [];
      let j = i;
      for (; j < lines.length && !blank(lines[j]!); j++) {
        if (/^ {0,3}>/.test(lines[j]!)) body.push(lines[j]!.replace(/^ {0,3}> ?/, ''));
        else if (interrupts(lines, j)) break;
        else body.push(lines[j]!);
      }
      add({ t: 'quote', children: parseBlocks(body, context) }, start, j);
      i = j;
      continue;
    }

    if (startsTable(lines, i)) {
      const head = cellsOf(line);
      const align = cellsOf(lines[i + 1]!).map((cell): Align => (cell.startsWith(':') ? (cell.endsWith(':') ? 'center' : 'left') : cell.endsWith(':') ? 'right' : undefined));
      const rows: Inline[][][] = [];
      let j = i + 2;
      for (; j < lines.length && !blank(lines[j]!) && lines[j]!.includes('|'); j++) {
        const cells = cellsOf(lines[j]!);
        rows.push(head.map((_, column) => parseInline(cells[column] ?? '')));
      }
      add({ t: 'table', align, head: head.map(parseInline), rows, open: context.streaming && j >= lines.length }, start, j);
      i = j;
      continue;
    }

    const marker = MARKER.exec(line);
    if (marker) {
      const ordered = /\d/.test(marker[2]!);
      const items: ListItem[] = [];
      let j = i;
      while (j < lines.length) {
        const item = MARKER.exec(lines[j]!);
        if (!item || /\d/.test(item[2]!) !== ordered || RULE.test(lines[j]!)) break;
        const spaces = item[3]!.length;
        const column = item[1]!.length + item[2]!.length + (spaces >= 1 && spaces <= 4 ? spaces : 1);
        const body = [lines[j]!.slice(column)];
        j++;
        for (; j < lines.length; j++) {
          const next = lines[j]!;
          if (blank(next)) {
            let k = j;
            while (k < lines.length && blank(lines[k]!)) k++;
            if (k < lines.length && lines[k]!.search(/\S/) >= column) {
              body.push(...lines.slice(j, k));
              j = k - 1;
              continue;
            }
            break;
          }
          if (next.search(/\S/) >= column) body.push(next.slice(column));
          else if (!MARKER.test(next) && !interrupts(lines, j)) body.push(next.trimStart());
          else break;
        }
        const task = /^\[([ xX])\]\s+/.exec(body[0]!);
        if (task) body[0] = body[0]!.slice(task[0].length);
        items.push({ ...(task ? { checked: task[1] !== ' ' } : {}), blocks: parseBlocks(body, context) });
        // A blank line between items keeps one list.
        let k = j;
        while (k < lines.length && blank(lines[k]!)) k++;
        const following = k < lines.length ? MARKER.exec(lines[k]!) : null;
        if (following && /\d/.test(following[2]!) === ordered && following[1]!.length < column) j = k;
      }
      add({ t: 'list', ordered, start: ordered ? Number.parseInt(marker[2]!, 10) : 1, items }, start, j);
      i = j;
      continue;
    }

    const delivered = mediaLinePath(line);
    if (delivered !== undefined) {
      const name = delivered.slice(delivered.lastIndexOf('/') + 1);
      add(localImagePath(delivered) === undefined ? { t: 'file', path: delivered, name } : { t: 'media', kind: 'image', src: delivered, alt: name }, start, i + 1);
      i++;
      continue;
    }

    // A paragraph runs to a blank line or to the line that starts another block.
    let j = i + 1;
    while (j < lines.length && !blank(lines[j]!) && !interrupts(lines, j)) j++;
    const text = lines.slice(i, j).map((row) => row.trim()).join('\n');
    const children = parseInline(text);
    const only = children.length === 1 ? children[0] : undefined;
    if (only?.t === 'image' && j === i + 1) add({ t: 'media', kind: 'image', src: only.src, alt: only.alt }, start, j);
    else {
      const media = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(text);
      const src = media ? (localImagePath(media[2]!) ?? safeUrl(media[2]!, 'media')) : undefined;
      if (media && src !== undefined && j === i + 1) add({ t: 'media', kind: mediaKindOf(src), src, alt: media[1]! }, start, j);
      else add({ t: 'paragraph', children }, start, j);
    }
    i = j;
  }
  return blocks;
}

/** Parses a message. `streaming`: the text is still arriving, so a construct left open (a fence, a `$$` block, a table at the end) is shown open. */
export function parseMarkdown(text: string, { streaming = false }: { streaming?: boolean } = {}): Markdown {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const ranges: [number, number][] = [];
  const blocks = parseBlocks(lines, { streaming, slugs: {} }, (start, end) => ranges.push([start, end]));
  return { blocks, sources: ranges.map(([start, end]) => lines.slice(start, end).join('\n')) };
}
