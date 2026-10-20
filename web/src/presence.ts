// Tells Caduceus whether this page is in view (M2 #03; architecture §4): no push is sent while any page of the owner is. A page says so when it becomes
// visible or hidden, and renews that while it is visible, because a page that is closed or loses its network cannot say it has gone: its lease then lapses.
import { tabId } from './tab-id.ts';

/** Renewed this often while visible; the server's lease is a minute and a half. */
const RENEW_MS = 30_000;

export function startPresence(): () => void {
  const tab = tabId(sessionStorage);
  const send = (visible: boolean) => {
    const body = JSON.stringify({ tab, visible });
    // `keepalive` lets a request made as the page goes away finish.
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
