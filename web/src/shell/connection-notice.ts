import { CAUSE, MAC_CHECK } from '../failure-words.ts';
import type { Banner } from './banners.ts';

/** What the page knows when it decides what the connection banner says (`useConnectionBanners` reads it from the browser, the gateway and the backend's diagnosis). */
export interface ConnectionFacts {
  /** The browser says the device has a network (`navigator.onLine`). */
  online: boolean;
  /** The gateway's state, and which reconnect it is on (0 while connected and for the first connect). */
  state: 'connected' | 'reconnecting' | 'offline';
  attempt: number;
  reason: string | undefined;
  /** Caduceus's own diagnosis of the Hermes backend, when it has answered one. */
  backendState: string | undefined;
  /** Caduceus did not answer the last diagnosis. */
  unreachable: boolean;
  /**
   * The device has just come back online and the first redial since has not failed yet. What the gateway and the backend diagnosis say until then was learned while there
   * was no network, so it is not news about the Mac or about Hermes (`useConnectionBanners`).
   */
  redialing: boolean;
  /**
   * "Can’t reach your Mac" has been shown and no connection, and no loss of the network, has come since (`nextCantReachHold`). Each failed redial flips the gateway between
   * "reconnecting" and "offline" within a moment; the words hold through that, so they do not flicker.
   */
  cantReachHeld: boolean;
}

/**
 * Whether "Can’t reach your Mac" is held. It starts when the gateway is offline with the device online and the server does not answer (not a redial that has not failed yet).
 * While the gateway redials ("reconnecting") it stays. It ends when the gateway connects, the device goes offline, or the server answers again while the gateway is still offline
 * (then the words are about Hermes, not the Mac).
 */
export function nextCantReachHold(held: boolean, { online, state, unreachable, redialing }: Pick<ConnectionFacts, 'online' | 'state' | 'unreachable' | 'redialing'>): boolean {
  if (!online || state === 'connected') return false;
  if (state === 'offline') return unreachable && (held || !redialing);
  return held;
}

/**
 * The connection banner the facts call for, or nothing while the link is healthy (connected, or still making the first connection, when nothing has been lost).
 * One voice for being cut off: while the device has no network the banner says "You are offline" and nothing else, for as long as that lasts; the server's own words
 * ("Can’t reach your Mac") come only once the device is online and the server still does not answer. While the first redial after the network came back is out, the banner says
 * "Reconnecting to Hermes": the old "can’t reach" was learned without a network. `stripTitle` is what the phone's one-line strip says in front of "since" and
 * the time ("Offline since 11:58"), short enough to leave the time whole at 320 px.
 */
export function connectionBanner({ online, state, attempt, reason, backendState, unreachable, redialing, cantReachHeld }: ConnectionFacts): Omit<Banner, 'id'> | undefined {
  if (!online) {
    return { priority: 0, tone: 'neutral', icon: 'wifi-off', title: CAUSE.offline, stripTitle: 'Offline', body: 'This page shows what was already loaded. Changes cannot be saved until you are back online.' };
  }
  if (state === 'connected' || (state === 'reconnecting' && attempt === 0)) return undefined;
  if (redialing) {
    return { priority: 1, tone: 'warning', icon: 'refresh', title: 'Reconnecting to Hermes', body: 'This device is back online. Pages that need Hermes fill in as soon as it is back.' };
  }
  if (cantReachHeld || (state === 'offline' && unreachable)) {
    return { priority: 0, tone: 'warning', icon: 'wifi-off', title: CAUSE.mac, stripTitle: 'Can’t reach Mac', body: `Caduceus on the Mac did not answer. ${MAC_CHECK} This page keeps trying (attempt ${attempt}).` };
  }
  if (state === 'offline' && backendState === 'stopped') {
    return {
      priority: 0,
      tone: 'danger',
      icon: 'alert',
      title: CAUSE.hermesSilent,
      stripTitle: 'Hermes has stopped',
      body: `Caduceus gave up restarting it. Check Health, or restart Caduceus on the Mac that runs it. This page keeps trying (attempt ${attempt}).`,
      actions: [{ label: 'Open Health', to: '/observe/health' }],
    };
  }
  if (state === 'offline') return { priority: 0, tone: 'neutral', icon: 'wifi-off', title: CAUSE.hermesSilent, stripTitle: 'Hermes not answering', body: reason };
  const starting = backendState === 'starting';
  return {
    priority: 1,
    tone: 'warning',
    icon: 'refresh',
    title: starting ? 'Hermes is starting' : 'Reconnecting to Hermes',
    body: `Attempt ${attempt}. ${reason ?? ''} Pages that need Hermes fill in as soon as it is back.`,
  };
}
