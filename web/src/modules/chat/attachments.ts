// What the composer attaches to a message (M1 #10), free of the DOM and of React: what counts as an image, a PDF or a file, how many may go and
// how large each may be (Hermes's own caps: 25 MB an image, 50 MB a PDF), and the large paste that becomes a Markdown file. Unpacking an
// archive is `archive.ts`; sending is `attachment-upload.ts`.
import type { Upload, UploadKind } from './attachment-upload.ts';

/** How many attachments go with one message. */
export const MAX_ATTACHMENTS = 20;

const MB = 1024 * 1024;
/** The most one attachment may hold, by kind: Hermes refuses an image over 25 MB and a PDF over 50 MB; a file has no cap of Hermes's, and 50 MB keeps one message's frame sane. */
export const SIZE_LIMIT: Readonly<Record<UploadKind, number>> = { image: 25 * MB, pdf: 50 * MB, file: 50 * MB };

/** Something the owner picked, pasted or dropped, before it is an attachment. `origin` says where it came from when it is not the owner's own file (an archive's entry). */
export interface Candidate {
  name: string;
  body: Blob;
  origin?: string;
  pasted?: boolean;
}

export interface Attachment extends Upload {
  id: string;
  size: number;
  origin?: string;
  /** A large paste that became this file: the text is in it, and the owner can still put it back inline. */
  pasted?: boolean;
}

/** Something that was not attached, and why. */
export interface Problem {
  name: string;
  reason: string;
}

let counter = 0;

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const extensionOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** Hermes reads these as images; a PDF is rendered to pages; anything else is a file for the agent to open. (An SVG or a HEIC photo is a file: Hermes's vision cannot read it.) */
export function kindOf(name: string, mime: string): UploadKind {
  const extension = extensionOf(name);
  if (extension === 'pdf' || (extension === '' && mime === 'application/pdf')) return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension) || (extension === '' && IMAGE_EXTENSIONS.has(mime.replace('image/', '')))) return 'image';
  return 'file';
}

const KIND_WORDS: Readonly<Record<UploadKind, string>> = { image: 'An image', pdf: 'A PDF', file: 'A file' };

/** Why something of this kind and size cannot be attached, if it cannot. */
export function refusalOf(kind: UploadKind, size: number): string | undefined {
  if (size === 0) return 'It is empty.';
  if (size > SIZE_LIMIT[kind]) return `${KIND_WORDS[kind]} may be at most ${SIZE_LIMIT[kind] / MB} MB; this one is ${(size / MB).toFixed(1)} MB.`;
  return undefined;
}

/** Adds what was picked to what is attached already: the first ones that fit stay, the rest are named with the reason they are not there. */
export function admit(current: readonly Attachment[], incoming: readonly Candidate[]): { attachments: Attachment[]; problems: Problem[] } {
  const attachments = [...current];
  const problems: Problem[] = [];
  for (const { name, body, origin, pasted } of incoming) {
    const kind = kindOf(name, body.type);
    const refusal = refusalOf(kind, body.size);
    if (refusal !== undefined) problems.push({ name, reason: refusal });
    else if (attachments.length >= MAX_ATTACHMENTS) problems.push({ name, reason: `A message takes at most ${MAX_ATTACHMENTS} attachments.` });
    else attachments.push({ id: String(++counter), name, kind, body, size: body.size, ...(origin === undefined ? {} : { origin }), ...(pasted ? { pasted } : {}) });
  }
  return { attachments, problems };
}

/** A paste longer than this many characters becomes a file instead of filling the message box. */
export const LARGE_PASTE_CHARS = 4000;

/** A large paste as the Markdown file it becomes (numbered after the pastes already attached); undefined when the paste is small enough to stay in the box. */
export function collapsePaste(text: string, current: readonly Attachment[]): Candidate | undefined {
  if (text.length <= LARGE_PASTE_CHARS) return undefined;
  const last = Math.max(0, ...current.filter((attachment) => attachment.pasted).map((attachment) => Number(/^pasted-text-(\d+)\.md$/.exec(attachment.name)?.[1] ?? 0)));
  return { name: `pasted-text-${last + 1}.md`, body: new Blob([text], { type: 'text/markdown' }), pasted: true };
}

/** Undo of a collapsed paste: the file leaves the attachments and its text goes into the message at the caret. */
export async function keepInline(text: string, caret: number, current: readonly Attachment[], id: string): Promise<{ text: string; caret: number; attachments: Attachment[] }> {
  const pasted = current.find((attachment) => attachment.id === id);
  if (!pasted) return { text, caret, attachments: [...current] };
  const inline = await pasted.body.text();
  return { text: text.slice(0, caret) + inline + text.slice(caret), caret: caret + inline.length, attachments: current.filter((attachment) => attachment.id !== id) };
}

const NAMED_PER_REASON = 3;

/** What to tell the owner about what was left out: one line for each reason, naming the first few and counting the rest. */
export function describeProblems(problems: readonly Problem[]): string[] {
  const byReason = new Map<string, string[]>();
  for (const { name, reason } of problems) byReason.set(reason, [...(byReason.get(reason) ?? []), name]);
  return [...byReason].map(([reason, names]) => {
    const shown = names.slice(0, NAMED_PER_REASON).join(', ');
    return `${names.length > NAMED_PER_REASON ? `${shown} and ${names.length - NAMED_PER_REASON} more` : shown}: ${reason}`;
  });
}

/** A size for a chip. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}
