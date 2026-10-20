// Which Repairs keep coming back (M5 #07). A failure that clears and returns is a different problem from one that simply stays: the first points at a cause
// Caduceus cannot see (a flaky platform, a crash loop that restarts itself), the second at one thing that needs fixing. Health asks Hermes afresh on every
// report and keeps nothing of Hermes, so the only thing remembered here is Caduceus's own observation: when each Repair was last seen to appear.
import type { Repair, SubsystemId } from '@caduceus/contracts/caduceus-api';

/** How far back an appearance counts. */
export const RECURRENCE_WINDOW_MS = 24 * 3_600_000;
/** A Repair is recurring from its second separate appearance in the window. */
const RECURRING_AT = 2;

/** What one report says: the Repairs that are open, and the subsystems whose check could be made (a Repair of one that could not be checked has not cleared). */
export interface RepairSighting {
  open: readonly { id: string; subsystem: SubsystemId }[];
  known: readonly SubsystemId[];
}

export type Recurrence = NonNullable<Repair['recurring']>;

export interface RepairHistory {
  /** Notes one report, made at `now` (milliseconds since the epoch), and says which of its open Repairs are recurring. */
  observe(sighting: RepairSighting, now: number): Map<string, Recurrence>;
}

interface Sighted {
  subsystem: SubsystemId;
  /** Open in the last report that could check it. */
  open: boolean;
  /** When it appeared (went from not open to open), oldest first. */
  appearances: number[];
}

export function createRepairHistory(): RepairHistory {
  const records = new Map<string, Sighted>();
  return {
    observe({ open, known }, now) {
      const openIds = new Set(open.map((repair) => repair.id));
      for (const repair of open) {
        const record = records.get(repair.id) ?? { subsystem: repair.subsystem, open: false, appearances: [] };
        if (!record.open) record.appearances.push(now);
        record.open = true;
        records.set(repair.id, record);
      }
      const recurring = new Map<string, Recurrence>();
      for (const [id, record] of records) {
        if (!openIds.has(id) && known.includes(record.subsystem)) record.open = false;
        record.appearances = record.appearances.filter((at) => now - at < RECURRENCE_WINDOW_MS);
        if (!record.open && record.appearances.length === 0) records.delete(id);
        else if (openIds.has(id) && record.appearances.length >= RECURRING_AT) recurring.set(id, { times: record.appearances.length, windowHours: RECURRENCE_WINDOW_MS / 3_600_000 });
      }
      return recurring;
    },
  };
}
