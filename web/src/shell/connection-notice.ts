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
}

/**
 * The connection banner the facts call for, or nothing while the link is healthy (connected, or still making the first connection, when nothing has been lost).
 * One voice for being cut off: while the device has no network the banner says "You are offline" and nothing else, for as long as that lasts; the server's own words
 * ("Can’t reach Hermes") come only once the device is online and the server still does not answer. `stripTitle` is what the phone's one-line strip says in front of the
 * time, short enough to leave the time whole at 320 px.
 */
export function connectionBanner({ online, state, attempt, reason, backendState, unreachable }: ConnectionFacts): Omit<Banner, 'id'> | undefined {
  if (!online) {
    return { priority: 0, tone: 'neutral', icon: 'wifi-off', title: 'You are offline', stripTitle: 'Offline', body: 'This page shows what was already loaded. Changes cannot be saved until you are back online.' };
  }
  if (state === 'connected' || (state === 'reconnecting' && attempt === 0)) return undefined;
  if (state === 'offline' && unreachable) {
    return { priority: 0, tone: 'warning', icon: 'wifi-off', title: 'Can’t reach Hermes', body: `The server did not answer. This page keeps trying (attempt ${attempt}).` };
  }
  if (state === 'offline' && backendState === 'stopped') {
    return {
      priority: 0,
      tone: 'danger',
      icon: 'alert',
      title: 'The Hermes backend has stopped',
      stripTitle: 'Hermes has stopped',
      body: `Caduceus gave up restarting it. Check Health, or restart Caduceus on the Mac that runs it. This page keeps trying (attempt ${attempt}).`,
      actions: [{ label: 'Open Health', to: '/observe/health' }],
    };
  }
  if (state === 'offline') return { priority: 0, tone: 'neutral', icon: 'wifi-off', title: 'Disconnected from Hermes', stripTitle: 'Disconnected', body: reason };
  const starting = backendState === 'starting';
  return {
    priority: 1,
    tone: 'warning',
    icon: 'refresh',
    title: starting ? 'Hermes is starting' : 'Reconnecting to Hermes',
    body: `Attempt ${attempt}. ${reason ?? ''} Pages that need Hermes fill in as soon as it is back.`,
  };
}
