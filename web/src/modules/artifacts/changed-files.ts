// The files a chat session changed (M6 #05), as the chat's Artifacts tab lists them. Everything is Hermes's and read again each time: the working tree through
// `GET /api/git/review/list` in a git repository, and, where the session's folder is no repository, the session's latest checkpoint against the files now
// (`rollback.list` and `rollback.diff`). Caduceus stores no file list.
import { isRecord } from '@caduceus/contracts/policy/guards';
import { stripAnsi } from '@caduceus/contracts/hermes/shared/ansi';

export interface ChangedFile {
  path: string;
  /** Git's letter: `M` changed, `A` added, `D` deleted, `R` renamed, `?` not tracked yet, `U` in conflict. */
  status: string;
  added: number;
  removed: number;
}

export const STATUS_WORDS: Readonly<Record<string, string>> = { M: 'Changed', A: 'Added', D: 'Deleted', R: 'Renamed', '?': 'New', U: 'Conflict', C: 'Copied', T: 'Type changed' };

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);

/** Reads `GET /api/git/review/list`; `undefined` for an answer that is not a list of files. */
export function parseReviewList(body: unknown): ChangedFile[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.files)) return undefined;
  return body.files.flatMap((entry): ChangedFile[] => (isRecord(entry) && typeof entry.path === 'string' && entry.path !== '' ? [{ path: entry.path, status: typeof entry.status === 'string' && entry.status !== '' ? entry.status : 'M', added: count(entry.added), removed: count(entry.removed) }] : []));
}

/** One file of a unified diff: what it says about the file and its own part of the text. */
export type DiffedFile = ChangedFile & { diff: string };

/**
 * The files a unified diff touches, each with its counts and its own part of the text (the `diff --git` header on). Hermes cuts `rollback.diff` after 4000
 * characters, so the last file may be partial; the caller says so.
 */
export function filesFromDiff(text: string): DiffedFile[] {
  const diff = stripAnsi(text);
  const parts = diff.split(/^(?=diff --git )/m).filter((part) => part.startsWith('diff --git '));
  return parts.map((part): DiffedFile => {
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(part);
    const lines = part.split('\n');
    const status = /^new file mode/m.test(part) ? 'A' : /^deleted file mode/m.test(part) ? 'D' : /^rename from /m.test(part) ? 'R' : 'M';
    return {
      path: header?.[2] ?? header?.[1] ?? 'unknown',
      status,
      added: lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
      removed: lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
      diff: part,
    };
  });
}
