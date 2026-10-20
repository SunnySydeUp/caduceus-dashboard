// Whether read-only mode is on, as the Caduceus server says: it is enforced there, and mirrored here so the shell can say
// so (a banner) and the dialogs can refuse what the server would.
import { useEffect, useSyncExternalStore } from 'react';
import type { ReadOnlyState } from '@caduceus/contracts/caduceus-api';
import { fetchWithStepUp } from './passkeys.ts';
import { afterPaint } from './settled.ts';
import { clearBanner, setBanner } from './shell/banners.ts';

/** How often the page asks again, in case another device turned it on or off. */
const READ_ONLY_POLL_MS = 10_000;

let state: ReadOnlyState = { readOnly: false };
const listeners = new Set<() => void>();
let timer: number | undefined;

function publish(next: ReadOnlyState) {
  if (next.readOnly === state.readOnly && next.automatic === state.automatic) return;
  state = next;
  listeners.forEach((notify) => notify());
}

/** Asks the server. A failed ask leaves what was last known: the banner does not flicker because the network did. */
export async function refreshReadOnly(): Promise<void> {
  try {
    const res = await fetch('/_caduceus/api/policy/read-only');
    if (res.ok) {
      const answer: ReadOnlyState = await res.json();
      publish({ readOnly: answer.readOnly === true, ...(answer.automatic ? { automatic: answer.automatic } : {}) });
    }
  } catch {
    // Offline or restarting: the connection banners say so.
  }
}

/** Whether read-only mode was on at the last answer. */
export function isReadOnly(): boolean {
  return state.readOnly;
}

/**
 * Turns read-only mode on or off. A T2 action: the server asks for a passkey (`fetchWithStepUp`), and answers with the
 * mode now in force. Resolves `false` when it did not change (the owner cancelled, or it was refused).
 */
export async function setReadOnly(value: boolean): Promise<boolean> {
  const res = await fetchWithStepUp(() =>
    fetch('/_caduceus/api/policy/read-only', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: value }) }),
  );
  await refreshReadOnly();
  return res.ok;
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  if (listeners.size === 1) {
    // The first ask waits for the first paint; the server enforces the mode whatever the page has heard of it so far.
    void afterPaint().then(refreshReadOnly);
    timer = window.setInterval(() => void refreshReadOnly(), READ_ONLY_POLL_MS);
    window.addEventListener('focus', onFocus);
  }
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    }
  };
};
const onFocus = () => void refreshReadOnly();

/** Whether read-only mode is on, kept fresh while any component uses it. */
export function useReadOnly(): boolean {
  return useSyncExternalStore(subscribe, () => state.readOnly);
}

/**
 * Shows the read-only banner while the mode is on (information architecture §3). When Caduceus turned it on itself, because
 * Hermes no longer matches the contracts it was built for, the banner says so and leads to Health, where the Repair is.
 */
export function useReadOnlyBanner(): void {
  const { readOnly: on, automatic } = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (on) {
      setBanner({
        id: 'read-only',
        priority: 1,
        tone: 'warning',
        icon: 'lock',
        title: automatic ? 'Caduceus switched to read-only mode' : 'Read-only mode is on',
        body: automatic
          ? 'Hermes no longer matches the contracts Caduceus was built for, so Caduceus is not changing anything in Hermes until you have looked. Health says what changed; turn read-only mode off in Settings › Security when you have.'
          : 'Caduceus is not changing anything in Hermes: you can look around, but not act. Turn it off in Settings › Security.',
        actions: [...(automatic ? [{ label: 'Open Health', to: '/observe/health' }] : []), { label: 'Open Security', to: '/system/security' }],
      });
    } else {
      clearBanner('read-only');
    }
    return () => clearBanner('read-only');
  }, [on, automatic]);
}
