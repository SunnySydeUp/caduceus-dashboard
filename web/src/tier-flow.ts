// The pure rules of the shared tiered confirmation dialog (mobile-and-interaction.md §5, architecture §5): what each tier
// asks of the owner, and when its confirm button may be pressed.
import type { ConfirmedTier } from '@caduceus/contracts/policy/tiers';

/** What each tier asks of the owner, in plain words: the line at the top of the confirmation, and the tag on a palette command. */
export const TIER_LABELS: Record<ConfirmedTier, string> = {
  T1: 'Confirm',
  T2: 'Needs your passkey',
  T3: 'Needs your passkey and the name',
};

/** Whether a T3 action can be undone, which its dialog must say. */
export interface Recoverability {
  undoable: boolean;
  /** What to know about it, e.g. "Pruned checkpoints are not in backups." */
  note?: string;
}

/** The statement a T3 dialog shows: "This cannot be undone." or "This can be undone.", with the note after it. */
export function recoverabilityText(recoverability: Recoverability | undefined): string {
  const statement = recoverability?.undoable ? 'This can be undone.' : 'This cannot be undone.';
  return recoverability?.note ? `${statement} ${recoverability.note}` : statement;
}

/** Confirm buttons named for taking something away: drawn as danger buttons even for a T1, so Delete never looks like Save. */
const DESTRUCTIVE_LABEL = /^(?:delete|remove|revoke|discard|uninstall|forget|erase|wipe)\b/i;

/**
 * Whether the confirm button is a danger button. An action says so itself (`destructive`, true or false); otherwise a button named Delete, Remove, Revoke and
 * the like is one, and so is a T3 that cannot be undone. A T3 that can be undone (a SOUL.md save, whose old text stays in History) is a normal button.
 */
export function isDestructive({ tier, destructive, confirmLabel, recoverability }: { tier: ConfirmedTier; destructive?: boolean; confirmLabel?: string; recoverability?: Recoverability }): boolean {
  if (destructive !== undefined) return destructive;
  return DESTRUCTIVE_LABEL.test(confirmLabel ?? '') || (tier === 'T3' && recoverability?.undoable !== true);
}

export interface ConfirmState {
  tier: ConfirmedTier;
  /** The name a T3 asks to be typed. */
  object?: string;
  typed: string;
  online: boolean;
  readOnly: boolean;
  /** Whether the owner has a passkey; `undefined` while that is not known (Caduceus has not answered), which blocks nothing. */
  hasPasskey?: boolean;
  /** A passkey confirmed a moment ago still covers this device, so a missing passkey does not matter. */
  covered?: boolean;
}

/** Why the confirm button cannot be pressed yet. */
export type Blocker = 'read-only' | 'offline' | 'no-passkey' | 'typed';

/**
 * What stops the confirm button, if anything. A T3 is refused in read-only mode, and a T2 or T3 while offline: neither is
 * ever queued for later. A T2 or T3 needs a passkey, so with none the owner is told so at once, not after pressing it. A T3 also
 * needs its name typed (blanks around it do not count).
 */
export function confirmBlocker({ tier, object, typed, online, readOnly, hasPasskey, covered }: ConfirmState): Blocker | undefined {
  if (tier === 'T3' && readOnly) return 'read-only';
  if (tier !== 'T1' && !online) return 'offline';
  if (tier !== 'T1' && hasPasskey === false && !covered) return 'no-passkey';
  if (tier === 'T3' && typed.trim() !== object) return 'typed';
  return undefined;
}
