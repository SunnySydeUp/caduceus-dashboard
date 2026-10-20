import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useBackend, useGatewayStatus } from '../gateway.ts';
import type { GatewayStatus } from '../gateway-connection.ts';
import type { Reach } from '../offline.ts';
import { clearBanner, setBanner } from './banners.ts';

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

/** Raises and clears the connection banners while the shell is mounted. */
export function useConnectionBanners(): void {
  const online = useOnline();
  const { state, attempt, reason } = useGatewayStatus();
  const { status, unreachable } = useBackend();
  const backendState = status?.state;

  useEffect(() => {
    if (!online) {
      setBanner({
        id: 'connection',
        priority: 0,
        tone: 'neutral',
        icon: 'wifi-off',
        title: 'You are offline',
        body: 'This page shows what was already loaded. Changes cannot be saved until you are back online.',
      });
    } else if (state === 'connected' || (state === 'reconnecting' && attempt === 0)) {
      // Connected, or still making the first connection: nothing has been lost yet.
      clearBanner('connection');
    } else if (state === 'offline' && unreachable) {
      setBanner({
        id: 'connection',
        priority: 0,
        tone: 'warning',
        icon: 'wifi-off',
        title: 'Caduceus is not reachable',
        body: `The server did not answer. This page keeps trying (attempt ${attempt}).`,
      });
    } else if (state === 'offline' && backendState === 'stopped') {
      setBanner({
        id: 'connection',
        priority: 0,
        tone: 'danger',
        icon: 'alert',
        title: 'The Hermes backend has stopped',
        body: `Caduceus gave up restarting it. Check Health, or restart Caduceus on the Mac that runs it. This page keeps trying (attempt ${attempt}).`,
        actions: [{ label: 'Open Health', to: '/observe/health' }],
      });
    } else if (state === 'offline') {
      setBanner({ id: 'connection', priority: 0, tone: 'neutral', icon: 'wifi-off', title: 'Offline', body: reason });
    } else {
      setBanner({
        id: 'connection',
        priority: 1,
        tone: 'warning',
        icon: 'refresh',
        title: backendState === 'starting' ? 'Hermes is starting' : 'Reconnecting to Hermes',
        body: `Attempt ${attempt}. ${reason ?? ''} Pages that need Hermes fill in as soon as it is back.`,
      });
    }
    return () => clearBanner('connection');
  }, [online, state, attempt, reason, backendState, unreachable]);
}
