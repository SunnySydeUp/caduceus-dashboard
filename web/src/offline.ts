// Whether this page can reach Caduceus, and what that means for changing things (M0 #12). Pure: the page reads the browser's network
// state and the gateway connection's diagnosis (`shell/connection.ts`) and passes them in.

export interface Reach {
  /** The browser says the device has a network connection (`navigator.onLine`). */
  online: boolean;
  /** Caduceus answered the last time the page asked (false once a diagnosis failed). */
  reachable: boolean;
}

/** Why the page cannot talk to Caduceus. */
export type Cause = 'offline' | 'unreachable';

/** The device's network comes first: with none, Caduceus cannot answer, and nothing else is worth saying. */
export function causeOf({ online, reachable }: Reach): Cause | undefined {
  return !online ? 'offline' : !reachable ? 'unreachable' : undefined;
}

export type WriteGate = { allowed: true } | { allowed: false; cause: Cause; reason: string };

const WRITE_REASONS: Record<Cause, string> = {
  offline: 'You are offline, so this change cannot be saved. Make it again when you are back online.',
  unreachable: 'Caduceus is not reachable, so this change cannot be saved. It will work again when Caduceus answers.',
};

/**
 * Whether a change may be offered. A change that cannot be queued is switched off, and the reason is shown with it: a disabled button
 * with no explanation is a dead end. (A change this device can keep and send later, such as the appearance choices, never asks.)
 */
export function writeGate(reach: Reach): WriteGate {
  const cause = causeOf(reach);
  return cause === undefined ? { allowed: true } : { allowed: false, cause, reason: WRITE_REASONS[cause] };
}
