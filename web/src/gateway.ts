// The page's one live connection to Hermes's gateway, opened on first use, and the hooks that read it. The controller
// (`gateway-connection.ts`) holds the logic; this file adds only the page's own parts: its address, its `fetch`, the browser's
// resume signals, and React.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { GatewayEvent, GatewayEventName } from '@caduceus/contracts/hermes/shared/gateway';
import {
  createGatewayConnection,
  diagnoseBackend,
  type BackendView,
  type GatewayConnection,
  type GatewayReady,
  type GatewayStatus,
} from './gateway-connection.ts';
import { createReconnectCoalescer } from './reconnect-coalescer.ts';
import { gatewayUrl, tabId } from './tab-id.ts';

let connection: GatewayConnection | undefined;

/** The page's gateway connection. The first call opens it, and wires the browser's resume signals to it. */
export function gatewayConnection(): GatewayConnection {
  if (connection) return connection;
  const gateway = createGatewayConnection({
    url: gatewayUrl(location, tabId(sessionStorage)),
    diagnose: () => diagnoseBackend((route) => fetch(route)),
    // The session ended (signed out, or revoked from another device): sign in again and come back here.
    onSignedOut: () => location.assign(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`),
  });
  // A phone that wakes, or a tab that comes back, fires these in bursts; a reconnect for each would storm the server.
  const resumed = createReconnectCoalescer({ run: () => gateway.reconnect() });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resumed.request());
  window.addEventListener('pageshow', () => resumed.request());
  window.addEventListener('online', () => resumed.request());
  connection = gateway;
  return gateway;
}

const subscribe = (notify: () => void) => gatewayConnection().subscribe(notify);

/** Whether, and how, the page is connected to Hermes: what the app bar's dot shows. */
export function useGatewayStatus(): GatewayStatus {
  return useSyncExternalStore(subscribe, () => gatewayConnection().status);
}

/** What the page knows about the private Hermes backend: its lifecycle while the gateway is down, and whether Caduceus itself answers. */
export function useBackend(): BackendView {
  return useSyncExternalStore(subscribe, () => gatewayConnection().backend);
}

/** Calls `handler` with every gateway event of `type`, for as long as the component is mounted. */
export function useGatewayEvent<K extends GatewayEventName>(type: K, handler: (event: GatewayEvent<K>) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => gatewayConnection().client.on(type, (event) => latest.current(event)), [type]);
}

/**
 * Loads live data: `load` runs now if the gateway is connected, and again at every `gateway.ready`: the first connect, every
 * reconnect (global change events are not replayed, so anything may have changed while the page was away), and a Hermes
 * restart (`ready.restarted`: what the page holds about sessions is stale). Live data is never older than the connection.
 */
export function useLiveLoad(load: (ready: GatewayReady | undefined) => void): void {
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    const gateway = gatewayConnection();
    if (gateway.status.state === 'connected') latest.current(undefined);
    return gateway.onReady((ready) => latest.current(ready));
  }, []);
}
