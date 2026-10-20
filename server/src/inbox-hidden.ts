// What a device has put aside in its Inbox (M2 #02). A snooze hides an item until a time; a dismissal hides it until the Hermes state it was
// about changes again. Both are kept against the Hermes reference and the state's stamp (`ref`, `stamp` of the item), so the item itself is
// never stored: when Hermes's state moves on, the stamp no longer matches and the item is simply shown. Pure; the store is `inbox-store.ts`.
import type { InboxItem, InboxSnoozed } from '@caduceus/contracts/inbox';

/** One row of what a device put aside: `until` is when a snooze ends, `null` for a dismissal. */
export interface HiddenRow {
  ref: string;
  stamp: string;
  until: number | null;
}

/** The items a device sees and the ones it has snoozed, given what it put aside and the time. */
export function applyHidden(items: readonly InboxItem[], rows: readonly HiddenRow[], now: number): { shown: InboxItem[]; snoozed: InboxSnoozed[] } {
  const shown: InboxItem[] = [];
  const snoozed: InboxSnoozed[] = [];
  for (const item of items) {
    const row = rows.find((candidate) => candidate.ref === item.ref && candidate.stamp === item.stamp);
    if (!row) shown.push(item);
    else if (row.until === null) continue;
    else if (row.until > now) snoozed.push({ item, until: row.until });
    else shown.push(item);
  }
  return { shown, snoozed };
}
