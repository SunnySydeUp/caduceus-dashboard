// Read-only mode: while it is on, the policy proxy lets only reads through. Kept in the Caduceus store, so it survives
// a restart (a mode the owner turned on for safety must not quietly switch itself off).
import type { ReadOnlyReason } from '@caduceus/contracts/caduceus-api';
import type { AuditLog } from './audit-log.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { AuthClient } from './owner-auth.ts';

const KEY = 'read-only';
const AUTOMATIC_KEY = 'read-only-automatic';

export interface ReadOnlyMode {
  enabled(): boolean;
  /** Why Caduceus turned it on by itself, for as long as that is why it is on; `undefined` when the owner did, or it is off. */
  automatic(): ReadOnlyReason | undefined;
  /** Turns it on or off (a T2 action, so the caller has checked the step-up) and audits that. Either way it is the owner's choice now. */
  set(enabled: boolean, client: AuthClient): void;
  /**
   * Turns it on because Caduceus found `reason` (audited as Caduceus's own act). Does nothing if it is on already, so the
   * owner's own choice is never taken over, and nothing turns it off again but the owner.
   */
  turnOnAutomatically(reason: ReadOnlyReason): void;
}

export function createReadOnlyMode(store: CaduceusStore, audit: AuditLog): ReadOnlyMode {
  const { db } = store;
  const stored = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  const write = (key: string, value: string) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  let enabled = stored(KEY) === '1';
  let automatic: ReadOnlyReason | undefined = enabled && stored(AUTOMATIC_KEY) === 'contract-mismatch' ? 'contract-mismatch' : undefined;
  return {
    enabled: () => enabled,
    automatic: () => automatic,
    set(next, { source }) {
      write(KEY, next ? '1' : '0');
      write(AUTOMATIC_KEY, '');
      enabled = next;
      automatic = undefined;
      audit.record({ actor: 'owner', action: next ? 'policy.read-only-on' : 'policy.read-only-off', target: 'caduceus', source, tier: 'T2' });
    },
    turnOnAutomatically(reason) {
      if (enabled) return;
      write(KEY, '1');
      write(AUTOMATIC_KEY, reason);
      enabled = true;
      automatic = reason;
      audit.record({ actor: 'caduceus', action: 'policy.read-only-on', target: 'caduceus', source: 'caduceus' });
    },
  };
}
