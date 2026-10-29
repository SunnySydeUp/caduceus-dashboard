// The decide-anywhere tray's model (M8 #05): in a Talk thread, the decisions that wait on the owner anywhere but in the open session, so they can be answered without leaving the thread. It is
// a view of the Inbox's live list and keeps nothing (D1). Pure: no DOM and no React.
import type { InboxItem } from '@caduceus/contracts/inbox';
import { decisionsFor } from '../today/today-model.ts';

/** How many faces the pill shows before the rest are only counted. */
export const TRAY_FACES = 3;

export interface TrayInput {
  /** What the Inbox's live stream holds. */
  items: readonly InboxItem[];
  /** The stored session that is open, `undefined` for a new chat. Its own decisions are inline in the transcript. */
  storedId: string | undefined;
}

export interface TrayView {
  /** The decisions to list, the longest wait first. */
  items: InboxItem[];
  /** Whose they are, each agent once and the one waiting longest first (`undefined` is a decision that names no agent); at most `TRAY_FACES`. */
  faces: (string | undefined)[];
  /** What the pill says: "2 more need you elsewhere". */
  label: string;
  /** Nothing else waits, so the tray is not on the screen. */
  hidden: boolean;
}

/**
 * The decisions that wait elsewhere, the faces for the pill and its words. Only a decision of the session that is open is not listed: it is answered inline. Another session of the
 * same agent has no transcript on the screen, so its decision is listed (its card names the session). A Talk screen is scoped to its own agent, so the owner's profile scope is not
 * applied: what waits elsewhere is every other decision, as Today counts them.
 */
export function trayView({ items, storedId }: TrayInput): TrayView {
  const others = decisionsFor(items).filter((item) => !(item.kind !== 'notice' && storedId !== undefined && item.storedSessionId === storedId));
  const faces = [...new Set(others.map((item) => item.profile))].slice(0, TRAY_FACES);
  const label = others.length === 1 ? '1 more needs you elsewhere' : `${others.length} more need you elsewhere`;
  return { items: others, faces, label, hidden: others.length === 0 };
}

/** The decision the tray's sheet shows, where it stands among those waiting, and what "Next" does. */
export interface TrayStep {
  /** `undefined` when nothing waits. */
  shown: InboxItem | undefined;
  /** Which one it is, counting from 1, and how many wait. */
  position: number;
  total: number;
  /** The decision "Next" leads to (the one after, and the first after the last); `undefined` when only one waits. */
  nextId: string | undefined;
  /** "Next (2)": the others still waiting. */
  nextLabel: string | undefined;
}

/**
 * One decision at a time, so that its buttons are all in view without a scroll inside a scroll. `currentId` is the one the owner is on: it stays while the list changes around it, and
 * when it has been answered (it is no longer in the list) the first of those left is shown.
 */
export function trayStep(items: readonly InboxItem[], currentId: string | undefined): TrayStep {
  const found = items.findIndex((item) => item.id === currentId);
  const at = found === -1 ? 0 : found;
  const shown = items[at];
  const others = items.length - 1;
  return { shown, position: shown ? at + 1 : 0, total: items.length, nextId: others > 0 ? items[(at + 1) % items.length]?.id : undefined, nextLabel: others > 0 ? `Next (${others})` : undefined };
}
