// Tells Caduceus whether this page is in view (M2 #03; architecture §4): no push is sent while any page of the owner is. A page says so when it becomes
// visible or hidden, and renews that while it is visible, because a page that is closed or loses its network cannot say it has gone: its lease then lapses.
import { tabId } from './tab-id.ts';

/** Renewed this often while visible; the server's lease is a minute and a half. */
const RENEW_MS = 30_000;

export function startPresence(): () => void {
  const tab = tabId(sessionStorage);
  const send = (visible: boolean) => {
    const body = JSON.stringify({ tab, visible });
    // A beacon is for exactly this: a small report that is sent as the page hides or goes away, and that the browser neither cancels nor logs as an aborted
    // request. Where it is not there (or refuses), `keepalive` lets an ordinary request finish as the page goes.
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/_caduceus/api/presence', new Blob([body], { type: 'application/json' }))) return;
    void fetch('/_caduceus/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  };
  let renew: ReturnType<typeof setInterval> | undefined;
  const update = () => {
    clearInterval(renew);
    const visible = document.visibilityState === 'visible';
    send(visible);
    if (visible) renew = setInterval(() => send(true), RENEW_MS);
  };
  const leave = () => send(false);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pagehide', leave);
  update();
  return () => {
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('pagehide', leave);
    clearInterval(renew);
    leave();
  };
}
