// Share links (R4, M7 #06): what the Caduceus server stores and serves, and the rules both it and the page apply to a shared transcript.
// A share is a frozen snapshot of a session's rows, taken from Hermes's session messages endpoint and kept as a derived artifact. The link holds a
// random token, of which only a hash is stored. The snapshot is the only thing the link opens.

import { isRecord } from './policy/guards.ts';

/** The lifetimes a share can be given. */
export const SHARE_EXPIRIES = ['1d', '7d', '30d', 'never'] as const;
export type ShareExpiry = (typeof SHARE_EXPIRIES)[number];

/** How long each lasts in milliseconds; `null` is for ever. */
export const SHARE_EXPIRY_MS: Readonly<Record<ShareExpiry, number | null>> = { '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, never: null };

/** How long a revoked share's snapshot is kept before it is deleted, so that Undo can bring the link back. */
export const SHARE_UNDO_MS = 60_000;

/** The most rows and the most bytes one snapshot holds: a longer session is refused, not cut short. */
export const SHARE_MAX_ROWS = 5000;
export const SHARE_MAX_BYTES = 20 * 1024 * 1024;

/** A share as the owner's list shows it. The token is not here: it is shown once, when the share is made. */
export interface ShareSummary {
  id: string;
  sessionId: string;
  profile: string;
  title: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, or `null` for a link that does not expire. */
  expiresAt: string | null;
  /** ISO 8601: set while the share is revoked and its snapshot is still kept for Undo. */
  revokedAt?: string;
}

/** What making a share answers with: the summary and the one chance to see the link. */
export interface ShareCreated extends ShareSummary {
  token: string;
  /** The address of the page, `/share/<token>`. */
  path: string;
  /** Where Caduceus is reached from the owner's other devices (its Tailscale Serve address), when it knows: the link is `origin` and `path`. */
  origin?: string;
}

/** A row of the session as Hermes stores it, as far as a shared transcript keeps it. */
export interface SharedRow {
  id: number;
  role: string;
  content?: unknown;
  display_kind?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
  tool_name?: unknown;
}

/** What `/share/<token>` serves, and all it serves: no session id, no profile, nothing of the owner's. */
export interface SharedTranscript {
  title: string;
  createdAt: string;
  expiresAt: string | null;
  rows: SharedRow[];
}

/** The fields of a row a snapshot keeps; the rest of what Hermes stores (token counts, session ids, timestamps of its own) stays behind. */
const KEPT_FIELDS = ['id', 'role', 'content', 'display_kind', 'reasoning', 'reasoning_content', 'tool_calls', 'tool_call_id', 'tool_name'] as const;

/** The fields of a row that hold text a secret can be in. */
const TEXT_FIELDS: ReadonlySet<string> = new Set(['content', 'reasoning', 'reasoning_content']);

/** Shown in place of a tool argument that is flagged as secret. */
export const HIDDEN_ARGUMENT = '[hidden]';

/** Whether a tool argument's name says it holds a secret: a key, a token, a password, a credential, an authorisation or cookie header… Over-hiding is the safe side. */
export function isSecretArgument(name: string): boolean {
  const plain = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /(secret|password|passwd|passphrase|token|credential|authorization|cookie|bearer|signature)/.test(plain) || plain === 'auth' || plain.endsWith('key') || plain.startsWith('auth');
}

function hideIn(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hideIn);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, isSecretArgument(name) ? HIDDEN_ARGUMENT : hideIn(inner)]));
}

/**
 * The arguments of a tool call with every secret-flagged one replaced (`api_key`, `Authorization`, `password`…), at any depth. Arguments are JSON in a
 * string; text that is not JSON cannot be checked, so none of it is shown.
 */
export function hideSecretArguments(args: unknown): unknown {
  if (typeof args !== 'string') return hideIn(args);
  try {
    const parsed: unknown = JSON.parse(args);
    return JSON.stringify(hideIn(parsed));
  } catch {
    return HIDDEN_ARGUMENT;
  }
}

/** Shown in place of a secret found in text. */
export const REDACTED = '[redacted]';

/**
 * Secrets that show in text by their own shape, however they got there (a file a tool read, a command that printed an environment, a key the agent was
 * pasted): private key blocks, the well-known token prefixes, bearer tokens, a password in an address, and an environment-style assignment to a name that
 * says it is a secret (`OPENAI_API_KEY=…`). Conservative: ordinary prose, paths and addresses read as they were.
 */
export function redactSecretValues(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{20,}/g, `$1${REDACTED}`)
    .replace(/\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g, REDACTED)
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?))(\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"'&;]+)/g, `$1$2${REDACTED}`);
}

/** A row as a snapshot keeps it: only the fields of `KEPT_FIELDS`, with the secret arguments of its tool calls hidden and the secrets in its text redacted. */
export function sharedRow(row: Record<string, unknown>): SharedRow {
  const kept: Record<string, unknown> = {};
  for (const field of KEPT_FIELDS) if (row[field] !== undefined) kept[field] = typeof row[field] === 'string' && TEXT_FIELDS.has(field) ? redactSecretValues(row[field]) : row[field];
  if (Array.isArray(kept.tool_calls)) {
    kept.tool_calls = kept.tool_calls.map((call: unknown) => {
      if (!isRecord(call) || !isRecord(call.function)) return call;
      const hidden = hideSecretArguments(call.function.arguments);
      return { ...call, function: { ...call.function, arguments: typeof hidden === 'string' ? redactSecretValues(hidden) : hidden } };
    });
  }
  return kept as unknown as SharedRow;
}

/** The address of a share's page. */
export const sharePath = (token: string) => `/share/${token}`;

/** A token as it appears in a link: URL-safe base64 of 32 random bytes. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether a request path is a share a visitor with no session may load: the page (`/share/<token>`) or its data (`/_caduceus/share/<token>`). A path that
 * is not shaped like a token is not one, so nothing else is ever public by this rule.
 */
export function isPublicSharePath(pathname: string): boolean {
  const token = pathname.startsWith('/share/') ? pathname.slice('/share/'.length) : pathname.startsWith('/_caduceus/share/') ? pathname.slice('/_caduceus/share/'.length) : undefined;
  return token !== undefined && SHARE_TOKEN.test(token);
}
