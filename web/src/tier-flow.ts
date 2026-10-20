// The pure rules of the shared tiered confirmation dialog (mobile-and-interaction.md §5, architecture §5): what each tier
// asks of the owner, and when its confirm button may be pressed.
import type { ConfirmedTier } from '@caduceus/contracts/policy/tiers';

/** The tier line at the top of the dialog. */
export const TIER_LABELS: Record<ConfirmedTier, string> = {
  T1: 'Tier 1 · confirm',
  T2: 'Tier 2 · passkey step-up',
  T3: 'Tier 3 · step-up + type to confirm',
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

export interface ConfirmState {
  tier: ConfirmedTier;
  /** The name a T3 asks to be typed. */
  object?: string;
  typed: string;
  online: boolean;
  readOnly: boolean;
}

/** Why the confirm button cannot be pressed yet. */
export type Blocker = 'read-only' | 'offline' | 'typed';

/**
 * What stops the confirm button, if anything. A T3 is refused in read-only mode, and a T2 or T3 while offline: neither is
 * ever queued for later. A T3 also needs its name typed (blanks around it do not count).
 */
export function confirmBlocker({ tier, object, typed, online, readOnly }: ConfirmState): Blocker | undefined {
  if (tier === 'T3' && readOnly) return 'read-only';
  if (tier !== 'T1' && !online) return 'offline';
  if (tier === 'T3' && typed.trim() !== object) return 'typed';
  return undefined;
}
