import type { ConfirmRequest } from '../palette.ts';

/** What the owner did in the dialog when they confirmed: for a T3, the name they typed. */
export interface ConfirmAnswer {
  typed?: string;
}

/**
 * Asks the owner to confirm a tiered action (T1 confirm, T2 passkey, T3 typed name); resolves `undefined` if they
 * decline, and otherwise what they did. For a T2 or T3 the passkey has been asked for by then.
 */
export type TierConfirmer = (request: ConfirmRequest) => Promise<ConfirmAnswer | undefined>;

let confirmer: TierConfirmer | undefined;

/**
 * The one confirmation path for tiered actions. The tiered dialog (M0 #08) installs itself here while it is mounted;
 * until then nothing can ask, and a tiered command or request is refused rather than run unconfirmed.
 */
export function setTierConfirmer(next: TierConfirmer | undefined): void {
  confirmer = next;
}

export function getTierConfirmer(): TierConfirmer | undefined {
  return confirmer;
}

/** Asks for one confirmation outside a Hermes request (Caduceus's own T1 and T2 actions); `false` if declined or there is no dialog. */
export async function confirmTier(request: ConfirmRequest): Promise<boolean> {
  const answer = await confirmer?.(request);
  return answer !== undefined;
}
