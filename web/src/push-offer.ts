// When the page offers notifications (M2 #03; mobile-and-interaction §6). Pure: the page reads the browser and passes in what it found.
import type { Platform } from './install-prompt.ts';

export interface PushEnvironment {
  /** The browser has service workers, the Push API and notifications. */
  supported: boolean;
  /** The page runs as the installed app. */
  installed: boolean;
  platform: Platform;
  /** The browser's notification permission. */
  permission: 'default' | 'granted' | 'denied';
  /** This device holds a push subscription that Caduceus knows. */
  subscribed: boolean;
}

/**
 * - `needs-install`: iOS only gives a web page notifications once it is on the Home Screen, so until then the install guide is what is offered.
 * - `unsupported`: this browser cannot receive push.
 * - `denied`: the owner said no in the browser; only the browser's own settings change that.
 * - `subscribed`: this device is told.
 * - `ready`: a tap on Enable may ask for permission.
 */
export type PushOffer = 'needs-install' | 'unsupported' | 'denied' | 'subscribed' | 'ready';

export function pushOffer({ supported, installed, platform, permission, subscribed }: PushEnvironment): PushOffer {
  if (platform === 'ios' && !installed) return 'needs-install';
  if (!supported) return 'unsupported';
  if (permission === 'denied') return 'denied';
  return subscribed && permission === 'granted' ? 'subscribed' : 'ready';
}

/** What to tell the owner when the server's test notification was refused (`POST /push/test`: `{ status: 'gone' | 'failed' }` with 502, `not-subscribed` with 404). */
export function testPushFailure(status: number, body: unknown): string {
  const said = typeof body === 'object' && body !== null ? (body as { status?: unknown; error?: unknown }) : {};
  if (said.status === 'gone') return 'The push service says this device’s subscription has ended, so Caduceus forgot it. Turn notifications on again.';
  if (said.status === 'failed') return 'The push service did not take the test notification. Try again in a moment.';
  if (said.error === 'not-subscribed') return 'This device is not subscribed. Turn notifications on first.';
  return `Caduceus could not send the test notification (HTTP ${status}).`;
}
