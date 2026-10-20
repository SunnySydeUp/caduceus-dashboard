// The restart-to-apply mechanism (M5 #01): when a change somewhere in Caduceus needs a gateway restart to take effect (channels,
// platform settings, config), that module calls `raiseRestartNeeded`. The Caduceus server remembers it, and the shell shows a banner
// that names the profile and offers the restart in place (`shell/restart-banners.ts`). The server drops it once the profile's gateway
// has started after the change, so nothing here decides when it is done.
import type { GatewayFacts, PendingGatewayRestart } from '@caduceus/contracts/caduceus-api';

/** What a pending restart says on the banner. */
export interface RestartBanner {
  id: string;
  title: string;
  body: string;
  /** What its button does: restart a running gateway, or start a stopped one (a stopped gateway has nothing to restart). */
  action: 'restart' | 'start';
}

export function restartBanner({ profile, reasons }: Pick<PendingGatewayRestart, 'profile' | 'reasons'>, { running }: { running: boolean }): RestartBanner {
  return {
    id: `gateway-restart:${profile}`,
    title: `${running ? 'Restart' : 'Start'} the gateway of ${profile} to apply your changes`,
    body: reasons.join(' · '),
    action: running ? 'restart' : 'start',
  };
}

/** `GET /_caduceus/api/gateway`; `undefined` when Caduceus did not answer. */
export async function fetchGatewayFacts(): Promise<GatewayFacts | undefined> {
  try {
    const res = await fetch('/_caduceus/api/gateway');
    return res.ok ? ((await res.json()) as GatewayFacts) : undefined;
  } catch {
    return undefined;
  }
}

const raised = new EventTarget();
const RAISED = 'raised';

/** Calls `listener` whenever a module raises a restart on this page; returns what stops it. */
export function onRestartRaised(listener: () => void): () => void {
  raised.addEventListener(RAISED, listener);
  return () => raised.removeEventListener(RAISED, listener);
}

/**
 * Tells Caduceus that `profile`'s gateway has to restart to apply a change, and says why in words for the owner ("Channel settings
 * saved"). Call it after the change is saved. Saying the same reason again is the same reason, and the change is then the later
 * one. Returns whether Caduceus took note; a failure is not worth a message of its own, since the change itself is saved.
 */
export async function raiseRestartNeeded(profile: string, reason: string): Promise<boolean> {
  try {
    const res = await fetch('/_caduceus/api/gateway/pending', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile, reason }) });
    if (res.ok) raised.dispatchEvent(new Event(RAISED));
    return res.ok;
  } catch {
    return false;
  }
}
