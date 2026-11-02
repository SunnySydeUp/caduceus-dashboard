import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useBackend, useGatewayStatus } from '../gateway.ts';
import type { GatewayStatus } from '../gateway-connection.ts';
import type { Reach } from '../offline.ts';
import { clearBanner, setBanner } from './banners.ts';
import { connectionBanner, nextCantReachHold } from './connection-notice.ts';
import { FIRST_LINK, nextLinkMemory, type LinkMemory } from './link-memory.ts';
import { toast } from './toasts.ts';

let link: LinkMemory = FIRST_LINK;
const linkListeners = new Set<() => void>();
const subscribeLink = (notify: () => void) => {
  linkListeners.add(notify);
  return () => void linkListeners.delete(notify);
};

/** Whether the link to Hermes is healthy and, once it has dropped, when it last was: what screens that say "nothing is going on" check before they say it. */
export function useLinkHealth(): LinkMemory {
  return useSyncExternalStore(subscribeLink, () => link);
}

/** Records how the link reads now. A recovery is announced once, politely, with no action. */
function reportLink(healthy: boolean): void {
  const { memory, recovered } = nextLinkMemory(link, healthy, Date.now());
  if (memory === link) return;
  link = memory;
  linkListeners.forEach((notify) => notify());
  if (recovered) toast('Back online', { tone: 'success', timeout: 3_000 });
}

const subscribeOnline = (notify: () => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};

/** Whether the browser says it has a network connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

/** Whether this page can reach Caduceus: the browser has a network, and Caduceus answered the last time the page asked (`../offline.ts` decides what that allows). */
export function useReach(): Reach {
  const online = useOnline();
  const { unreachable } = useBackend();
  return useMemo(() => ({ online, reachable: !unreachable }), [online, unreachable]);
}

/**
 * How connected this page is, for the app bar's dot: the status of its live gateway connection (`gateway.ts`: connected,
 * reconnecting with the attempt count, or offline), unless the browser itself says it has no network. That wins, because
 * no reconnect can help until the network is back.
 */
export function useConnection(): GatewayStatus {
  const online = useOnline();
  const status = useGatewayStatus();
  return online ? status : { state: 'offline', attempt: status.attempt, reason: 'This device has no network connection.' };
}

/**
 * Whether the device has just come back online and the redial that follows has not failed yet. While the network was down the gateway and the backend diagnosis went to
 * "offline" and "Caduceus is not reachable" because nothing could get through; that is stale the moment the network is back, and it stays until a redial with the
 * network up fails (the gateway counts a new attempt) or connects. It is settled while rendering, so the stale words never reach the screen for a frame.
 */
function useRedialing(online: boolean, state: GatewayStatus['state'], attempt: number): boolean {
  const [seen, setSeen] = useState<{ online: boolean; attemptAtReturn: number | undefined }>({ online, attemptAtReturn: undefined });
  if (seen.online !== online) setSeen({ online, attemptAtReturn: online ? attempt : undefined });
  // A connection ends the wait: the next drop counts its attempts from 0 again.
  else if (state === 'connected' && seen.attemptAtReturn !== undefined) setSeen({ online, attemptAtReturn: undefined });
  return online && seen.attemptAtReturn !== undefined && attempt <= seen.attemptAtReturn;
}

/** Raises and clears the connection banners while the shell is mounted, and keeps the link's memory (`useLinkHealth`). */
export function useConnectionBanners(): void {
  const online = useOnline();
  const { state, attempt, reason } = useGatewayStatus();
  const { status, unreachable } = useBackend();
  const backendState = status?.state;
  const redialing = useRedialing(online, state, attempt);
  // "Can't reach your Mac" holds through the flips a failed redial makes between reconnecting and offline (settled while rendering, like `redialing`).
  const [held, setHeld] = useState(false);
  const cantReachHeld = nextCantReachHold(held, { online, state, unreachable, redialing });
  if (cantReachHeld !== held) setHeld(cantReachHeld);
  // Healthy is the banner's own test: connected, or still making the first connection (nothing has been lost yet).
  const healthy = online && (state === 'connected' || (state === 'reconnecting' && attempt === 0));

  useEffect(() => reportLink(healthy), [healthy]);

  useEffect(() => {
    const banner = connectionBanner({ online, state, attempt, reason, backendState, unreachable, redialing, cantReachHeld });
    if (banner) setBanner({ id: 'connection', ...banner });
    else clearBanner('connection');
  }, [online, state, attempt, reason, backendState, unreachable, redialing, cantReachHeld]);
  useEffect(() => () => clearBanner('connection'), []);
}
