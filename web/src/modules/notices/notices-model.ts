// Notices' pure part (M2 #01, M8 #08): how the notices the Inbox kept (what failed, what is for information) are grouped and filtered, what the address holds, where j / k move,
// and when a snooze ends. No DOM and no React. The items themselves are derived by the Caduceus server (`server/src/inbox.ts`).
import { INBOX_CATEGORIES, type InboxCategory, type InboxGroup, type InboxItem, type InboxNotice } from '@caduceus/contracts/inbox';
import { inScope } from '../inbox/inbox-model.ts';

/** The notices a profile scope shows: everything that is not a decision (approvals and questions are answered on Today and in the Talk tray, a notice that needs one with them). */
export function noticesIn(items: readonly InboxItem[], scope: string | undefined): InboxNotice[] {
  return inScope(items, scope).filter((item): item is InboxNotice => item.kind === 'notice' && item.group !== 'decision');
}


/** How many notices have failed: what the Notices badge counts. Failures only; the notices that are for information are not worth a number. */
export function failedNotices(items: readonly InboxItem[]): number {
  return items.filter((item) => item.kind === 'notice' && item.group === 'failed').length;
}

/** The text equivalent of the Notices badge. */
export function failedLabel(count: number): string {
  return count === 1 ? '1 notice has failed' : `${count} notices have failed`;
}
/** Where j (`1`) and k (`-1`) move the selection in the list of `ids`: they stop at the ends, and a selection that is gone starts at the first. */
export function stepSelection(ids: readonly string[], current: string | undefined, delta: 1 | -1): string | undefined {
  if (ids.length === 0) return undefined;
  const at = current === undefined ? -1 : ids.indexOf(current);
  if (at < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
}

/** What Notices, with a detail pane on a wide screen, selects first: the item a link named, if it is still there, else the first. */
export function initialSelection(ids: readonly string[], linked: string | undefined): string | undefined {
  return linked !== undefined && ids.includes(linked) ? linked : ids[0];
}

/** The groups Notices shows, in order: what failed, what is for information. What needs a decision is on Today, in the Talk tray and on its own card, not here. */
export const GROUPS: readonly { id: Exclude<InboxGroup, 'decision'>; title: string }[] = [
  { id: 'failed', title: 'Failed' },
  { id: 'fyi', title: 'FYI' },
];

/** The items of each group (every group, empty or not), in the list's own order. */
export function groupItems<T extends InboxItem>(items: readonly T[]): { id: Exclude<InboxGroup, 'decision'>; title: string; items: T[] }[] {
  return GROUPS.map((group) => ({ ...group, items: items.filter((item) => item.group === group.id) }));
}

/** The items of a category, or all of them when none is chosen. */
export function inCategory<T extends InboxItem>(items: readonly T[], category: InboxCategory | undefined): T[] {
  return category === undefined ? [...items] : items.filter((item) => item.category === category);
}

/** What Notices shows, as its address holds it: the list or the activity feed, and a category. */
export interface NoticesView {
  view: 'notices' | 'activity';
  category?: InboxCategory;
}

export function noticesSearch({ view, category }: NoticesView): Record<string, string> {
  return { ...(view === 'activity' ? { view: 'activity' } : {}), ...(category ? { category } : {}) };
}

/** The view in an address; a value that is not one is left out. */
export function readNoticesView(search: Record<string, unknown>): NoticesView {
  const { view, category } = search;
  return { view: view === 'activity' ? 'activity' : 'notices', ...(typeof category === 'string' && Object.hasOwn(INBOX_CATEGORIES, category) ? { category: category as InboxCategory } : {}) };
}

export type SnoozeKind = '1h' | 'tonight' | 'tomorrow';

export const SNOOZES: readonly { kind: SnoozeKind; label: string }[] = [
  { kind: '1h', label: 'In 1 hour' },
  { kind: 'tonight', label: 'Tonight (8 pm)' },
  { kind: 'tomorrow', label: 'Tomorrow (9 am)' },
];

/** When a snooze ends: an hour from now, 20:00 today (tomorrow's if it is past), or 09:00 tomorrow, in the device's own time. */
export function snoozeUntil(kind: SnoozeKind, now: Date): number {
  if (kind === '1h') return now.getTime() + 3_600_000;
  const at = new Date(now);
  at.setHours(kind === 'tonight' ? 20 : 9, 0, 0, 0);
  if (kind === 'tomorrow' || at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}
