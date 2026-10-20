// Claude Code and Codex sessions (M1 #16): no DOM and no React. Hermes finds the logs those tools left on the machine it runs on and hands out an
// opaque handle for each (never a path); the page lists them, previews the tail of one and imports it into a profile, through
// `session.foreign.list`, `.preview` and `.import`. Caduceus keeps nothing: every word here is Hermes's answer.
import type { ForeignSessionRow, ForeignSource, SessionForeignImportResult, SessionForeignListResult, SessionForeignPreviewResult } from '@caduceus/contracts/hermes/gateway';
import type { GatewayConnection } from '../../gateway-connection.ts';

/** What the engine needs of the page's gateway connection. */
export type ForeignClient = Pick<GatewayConnection['client'], 'request'>;

export type { ForeignSource };

/** How many sessions one page asks for (Hermes allows 50; it reads every log of the page, so the page stays small). */
export const FOREIGN_PAGE = 25;

export interface ForeignSession {
  /** Hermes's opaque handle for the log. */
  id: string;
  source: ForeignSource;
  /** The tool's name, as Hermes says it: `Claude Code`, `Codex CLI`. */
  label: string;
  title: string;
  cwd: string | undefined;
  /** When the log last changed, in seconds since the epoch. */
  mtime: number;
  turnCount: number;
  excerpt: string;
}

export interface ForeignPage {
  rows: ForeignSession[];
  /** Where the next page starts; absent on the last one. */
  nextOffset: number | undefined;
  /** How many logs of this page Hermes could not read. */
  unreadable: number;
}

const rowOf = (row: ForeignSessionRow): ForeignSession => ({
  id: row.id,
  source: row.source,
  label: row.label,
  title: row.title ?? '',
  cwd: row.cwd ?? undefined,
  mtime: row.mtime,
  turnCount: row.turn_count ?? 0,
  excerpt: row.excerpt ?? '',
});

/** One page of the sessions the other tools left, newest first, of one tool or of both. */
export async function listForeign(client: ForeignClient, { profile, source, offset = 0, limit = FOREIGN_PAGE }: { profile: string; source?: ForeignSource; offset?: number; limit?: number }): Promise<ForeignPage> {
  const result = await client.request<SessionForeignListResult>('session.foreign.list', { profile, source, offset, limit });
  return { rows: (result.sessions ?? []).map(rowOf), nextOffset: result.next_offset ?? undefined, unreadable: result.unreadable ?? 0 };
}

export interface ForeignTurn {
  role: string;
  content: string;
}

export interface ForeignPreview {
  /** The last turns of the conversation (Hermes sends at most 40, each cut at 8,000 characters). */
  messages: ForeignTurn[];
  /** How many turns the whole conversation has. */
  total: number;
  /** Whether Hermes left out earlier turns or cut a long one. */
  truncated: boolean;
  /** The Hermes session this log was already imported as, in this profile. */
  alreadyImported: string | undefined;
  cwd: string | undefined;
}

/** The tail of one session, and whether the profile already has it. */
export async function previewForeign(client: ForeignClient, { profile, id }: { profile: string; id: string }): Promise<ForeignPreview> {
  const result = await client.request<SessionForeignPreviewResult>('session.foreign.preview', { profile, id });
  const messages = result.messages ?? [];
  return { messages, total: result.total ?? messages.length, truncated: result.truncated ?? false, alreadyImported: result.already_imported ?? undefined, cwd: result.cwd ?? undefined };
}

/** The Hermes session an import made, and whether it was there already. */
export interface ForeignImport {
  storedId: string;
  alreadyImported: boolean;
}

/** Imports one session into `profile`'s history. Hermes does it once per log: the second time it answers with the first one's id. */
export async function importForeign(client: ForeignClient, { profile, id }: { profile: string; id: string }): Promise<ForeignImport> {
  const result = await client.request<SessionForeignImportResult>('session.foreign.import', { profile, id });
  return { storedId: result.session_id, alreadyImported: result.already_imported ?? false };
}

/** The last name of a session's folder, whichever way the tool's machine writes paths (`/` or `\`); `/` stays `/`. */
export function folderName(cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined;
  const parts = cwd.split(/[\\/]/).filter((part) => part !== '');
  return parts.at(-1) ?? cwd;
}

export const turnsLabel = (count: number): string => `${count} turn${count === 1 ? '' : 's'}`;
