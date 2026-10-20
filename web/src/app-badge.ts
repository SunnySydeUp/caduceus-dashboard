// The app badge (M2 #03; mobile-and-interaction §6): the number of items that need a decision, on the installed app's icon. Pure rule plus the one
// call that applies it; the page sets it from the Inbox's feed, and the service worker sets it from a push message, so it is right when the app is closed too.

export type BadgeCommand = { kind: 'set'; count: number } | { kind: 'clear' };

/** A count is shown; zero (or anything that is not a count) clears the badge. */
export function badgeCommand(count: number): BadgeCommand {
  return Number.isInteger(count) && count > 0 ? { kind: 'set', count } : { kind: 'clear' };
}

/** What a browser offers for badging (`navigator.setAppBadge`); a browser that has none is left alone. */
export interface BadgeApi {
  setAppBadge?(count: number): Promise<void>;
  clearAppBadge?(): Promise<void>;
}

export function applyBadge(api: BadgeApi, count: number): void {
  const command = badgeCommand(count);
  // The badge is a nicety: a browser that refuses it (not installed, no permission) is no reason for the page to complain.
  const done = command.kind === 'set' ? api.setAppBadge?.(command.count) : api.clearAppBadge?.();
  void done?.catch(() => undefined);
}
