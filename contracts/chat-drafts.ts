import { isRecord } from './policy/guards.ts';

// Drafts and saved prompts (M1 #11), shared by the server (which stores them and enforces every limit and the secret rule) and the web app
// (which keeps the composer in step with them). Both are Caduceus's own (R5): Hermes has no backing for either, and nothing here is sent to
// Hermes before the owner presses Send.

/** The session part of a draft's key for a chat that has no session yet. */
export const NEW_CHAT = 'new';

/** What one draft keeps. The text goes in the JSON body of a save (the API takes 64 KB bodies at most); a long paste is an attachment already. */
export const MAX_DRAFT_TEXT_BYTES = 40_000;
const MB = 1024 * 1024;
/** The largest attachment a draft keeps. A bigger one stays attached to the message until the page is closed, and the composer says so. */
export const MAX_DRAFT_ATTACHMENT_BYTES = 8 * MB;
/** All the attachments of one draft together. */
export const MAX_DRAFT_ATTACHMENTS_BYTES = 24 * MB;
/** The attachments of one draft (the composer's own limit for one message). */
export const MAX_DRAFT_ATTACHMENTS = 20;
/** Drafts in all, and the attachment bytes of all of them together. */
export const MAX_DRAFTS = 200;
export const MAX_DRAFTS_BYTES = 256 * MB;

/** Saved prompts: how many, and how long one may be. */
export const MAX_SAVED_PROMPTS = 200;
export const MAX_PROMPT_NAME = 80;
export const MAX_PROMPT_TEXT_BYTES = 20_000;
export const MAX_PROMPT_TAGS = 8;
export const MAX_PROMPT_TAG = 24;

/** What the owner is told about what a draft keeps, in one place so that the composer and the help page say the same. */
export const DRAFT_LIMITS_WORDS = `A draft keeps your text (up to ${MAX_DRAFT_TEXT_BYTES / 1000} KB) and up to ${MAX_DRAFT_ATTACHMENTS} attachments of at most ${MAX_DRAFT_ATTACHMENT_BYTES / MB} MB each, ${MAX_DRAFT_ATTACHMENTS_BYTES / MB} MB together. Anything that looks like a password, a key or a token is never kept.`;

export type DraftAttachmentKind = 'image' | 'pdf' | 'file';

/** An attachment a draft keeps: the reference. The bytes are read by `id` (`GET /_caduceus/api/chat/draft/attachments/:id`). */
export interface DraftAttachment {
  id: string;
  name: string;
  kind: DraftAttachmentKind;
  mime: string;
  size: number;
  /** A large paste that became a Markdown file (it can still be put back inline). */
  pasted?: true;
  /** Where it came from when it is not the owner's own file (an archive's entry). */
  origin?: string;
}

/** An unsent message: text, attachment references and when it was last written. */
export interface Draft {
  profile: string;
  /** A stored session's id, or `new`. */
  session: string;
  text: string;
  attachments: DraftAttachment[];
  /** Counts every write of any draft, so that a device can tell its copy is not the latest one. */
  revision: number;
  updatedAt: number;
}

/** A draft as the session list needs it: that there is one, and how big. */
export interface DraftSummary {
  profile: string;
  session: string;
  chars: number;
  attachments: number;
  updatedAt: number;
}

/** `GET /_caduceus/api/chat/drafts?profile=` (every profile's without it): the drafts (those of sessions Hermes no longer has are dropped first). */
export interface DraftList {
  drafts: DraftSummary[];
}

/** `GET` / `PUT /_caduceus/api/chat/draft?profile=&session=`. `draft` is `null` when there is none (a save of empty text with no attachments deletes it). */
export interface DraftReply {
  draft: Draft | null;
  /**
   * Another device saved this draft after the revision the caller says it last saw (`base`), and what that device saved is not what the caller
   * saved: the version the save replaced, so that the caller can offer it back. The latest write wins.
   */
  replaced?: Draft;
}

/** A saved prompt: a name, the text, tags to find it by, and the profile it is for (every profile when `null`). */
export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
  tags: string[];
  profile: string | null;
  updatedAt: number;
}

/** `GET /_caduceus/api/chat/prompts`. */
export interface SavedPromptList {
  prompts: SavedPrompt[];
}

/** The body of a create (`POST`) or an edit (`PUT /_caduceus/api/chat/prompts/:id`). */
export interface SavedPromptInput {
  name: string;
  text: string;
  tags: string[];
  profile: string | null;
}

// ── What looks like a secret ──────────────────────────────────────────────────

/** Secrets by what they look like: the prefixes of the well-known providers, a JWT, a long hex digest (64 digits: a 40-digit git commit is something owners write all the time, and one that is named like a key is caught below). */
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,
  /\b[A-Fa-f0-9]{64,}\b/,
];
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/;
/** A value given to a name that says it is one: `API_KEY=…`, `"client_secret": "…"`, `password: …` (a reference like `${KEY}` is a name, not a value). */
const NAMED_SECRET = /(?:key|token|secret|password|passwd|pwd|authorization|credential)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?(?!Bearer\s)[A-Za-z0-9_\-./+=~]{8,}/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i;
const URL_PASSWORD = /:\/\/[^\s:@/]+:[^\s@/]{3,}@/;

/**
 * What `text` holds that looks like a secret, in words for the owner (`a private key`), or `undefined`. A draft or a prompt that holds one is
 * not stored: it would sit on disk in Caduceus's store, in every backup, and reach every device.
 */
export function secretIn(text: string): string | undefined {
  if (PRIVATE_KEY.test(text)) return 'a private key';
  if (SECRET_SHAPES.some((shape) => shape.test(text))) return 'an API key or token';
  if (BEARER.test(text)) return 'a bearer token';
  if (URL_PASSWORD.test(text)) return 'a password in an address';
  if (NAMED_SECRET.test(text)) return 'a password, key or token';
  return undefined;
}

/** Files that hold credentials by what they are called. */
const SECRET_FILE_NAMES = [/(?:^|\.)env(?:\..*)?$/i, /\.(?:pem|key|p12|pfx|kdbx|keystore|jks|ovpn)$/i, /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i, /^\.(?:netrc|npmrc|pypirc|pgpass|git-credentials)$/i, /^(?:credentials|secrets?)(?:\..*)?$/i, /^auth\.json$/i, /\.secret$/i];

/** How much of a file is read for a secret: a file past this is a table or a log, not a note with a key in it. */
export const SECRET_SCAN_BYTES = MB;

/**
 * What makes an attachment unfit to keep: a name that says it holds credentials, or text that looks like one. `head` is the start of the file
 * (up to `SECRET_SCAN_BYTES`), `undefined` for what is not text. Images and PDFs are not read.
 */
export function secretInAttachment(name: string, head: Uint8Array | undefined): string | undefined {
  const base = name.split(/[\\/]/).pop() ?? name;
  if (SECRET_FILE_NAMES.some((pattern) => pattern.test(base))) return `a file named ${base}, which usually holds credentials`;
  if (head === undefined || head.subarray(0, 8192).includes(0)) return undefined;
  const found = secretIn(new TextDecoder().decode(head.subarray(0, SECRET_SCAN_BYTES)));
  return found === undefined ? undefined : `${found} in ${base}`;
}

// ── Reading what a caller sends ───────────────────────────────────────────────

/** A prompt as stored: trimmed one-line name, the text, tags lower-cased and de-duplicated, a profile name or `null`. `undefined` when the input is not one. */
export function readPromptInput(value: unknown): SavedPromptInput | undefined {
  if (!isRecord(value)) return undefined;
  const { name, text, tags, profile } = value;
  if (typeof name !== 'string' || typeof text !== 'string' || !Array.isArray(tags)) return undefined;
  const oneLine = name.replace(/\s+/g, ' ').trim();
  if (oneLine === '' || oneLine.length > MAX_PROMPT_NAME || text.trim() === '' || new TextEncoder().encode(text).length > MAX_PROMPT_TEXT_BYTES) return undefined;
  if (profile !== null && (typeof profile !== 'string' || profile === '')) return undefined;
  const kept: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') return undefined;
    const clean = tag.replace(/\s+/g, ' ').trim().toLowerCase();
    if (clean === '' || clean.length > MAX_PROMPT_TAG) return undefined;
    if (!kept.includes(clean)) kept.push(clean);
  }
  if (kept.length > MAX_PROMPT_TAGS) return undefined;
  return { name: oneLine, text, tags: kept, profile };
}

/** Whether `value` is a draft attachment as the server answers it. */
export function isDraftAttachment(value: unknown): value is DraftAttachment {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.kind === 'image' || value.kind === 'pdf' || value.kind === 'file') &&
    typeof value.mime === 'string' &&
    typeof value.size === 'number'
  );
}
