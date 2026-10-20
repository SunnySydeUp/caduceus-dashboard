// What Workspace › Checkpoints knows about checkpoints, free of the DOM and of React (M7 #04): Hermes's list as the page shows it, the size of its store and a diff
// made safe to show. Everything is Hermes's (D1): the checkpoints are its agent's snapshots, listed again each time, and Caduceus keeps nothing of them.
import { isRecord } from '@caduceus/contracts/policy/guards';
import { stripAnsi } from '@caduceus/contracts/hermes/shared/ansi';
import { formatSize } from '../files/files-model.ts';

export interface CheckpointItem {
  hash: string;
  /** The first seven characters, as git shows it. */
  short: string;
  /** Milliseconds since the epoch; `undefined` when Hermes's time is not one. */
  at: number | undefined;
  /** What Hermes says the checkpoint was for, when it says (Hermes 0.21.4 leaves it empty). */
  message: string | undefined;
}

export interface CheckpointList {
  enabled: boolean;
  items: CheckpointItem[];
}

/** Reads `rollback.list`: the newest checkpoint first, as Hermes lists them. */
export function parseCheckpoints(result: unknown): CheckpointList {
  if (!isRecord(result)) return { enabled: false, items: [] };
  const rows = Array.isArray(result.checkpoints) ? result.checkpoints : [];
  const items = rows.flatMap((row): CheckpointItem[] => {
    if (!isRecord(row) || typeof row.hash !== 'string' || row.hash === '') return [];
    const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN;
    return [{ hash: row.hash, short: row.hash.slice(0, 7), at: Number.isNaN(at) ? undefined : at, message: typeof row.message === 'string' && row.message !== '' ? row.message : undefined }];
  });
  return { enabled: result.enabled === true, items };
}

/** Reads `GET /api/ops/checkpoints`: the size of the whole checkpoint store, which is shared by every workspace of the profile. */
export function parseStorage(body: unknown): { totalBytes: number } | undefined {
  return isRecord(body) && typeof body.total_bytes === 'number' ? { totalBytes: body.total_bytes } : undefined;
}

export const sizeWords = formatSize;

/** Hermes cuts a checkpoint's diff at this many characters (`rollback.diff`). */
export const DIFF_LIMIT = 4000;

export const diffCut = (diff: string): boolean => diff.length >= DIFF_LIMIT;

/** The diff as text the diff view can show: Hermes's plain `diff` with any terminal escape taken out. The view draws text, never markup. */
export function plainDiff(diff: string): string {
  return stripAnsi(diff);
}
