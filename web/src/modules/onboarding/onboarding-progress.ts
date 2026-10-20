// The owner's onboarding progress (M5 #16): which step of the wizard they reached, and whether they finished it or set it aside. The server keeps it
// (`/_caduceus/api/preferences/onboarding`, the owner's, so every device resumes at the same step); this is the page's copy of what it last heard, so
// Today's offer, the wizard and Settings agree without asking again. Nothing here talks to Hermes.
import { useEffect, useSyncExternalStore } from 'react';
import { readOnboardingProgress, type OnboardingProgress } from '@caduceus/contracts/onboarding';
import type { OnboardingPreference } from '@caduceus/contracts/caduceus-api';

/** The page's way to call the server; `fetch` in the browser, the test server's in a test. */
export type Request = (method: string, path: string, body?: unknown) => Promise<Response>;

const ROUTE = '/_caduceus/api/preferences/onboarding';
const browserRequest: Request = (method, path, body) =>
  fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

/** `undefined` until the server has answered: a page that does not know must not offer the wizard. */
let current: OnboardingProgress | undefined;
const listeners = new Set<() => void>();
const publish = (next: OnboardingProgress) => {
  current = next;
  listeners.forEach((notify) => notify());
};

/** Asks the server for the progress (once per page unless `again`); `undefined` when the server did not answer. */
export async function loadOnboarding(request: Request = browserRequest, again = false): Promise<OnboardingProgress | undefined> {
  if (current && !again) return current;
  const res = await request('GET', ROUTE).catch(() => undefined);
  if (res?.ok) {
    const answer = (await res.json()) as OnboardingPreference;
    publish(readOnboardingProgress(answer.onboarding));
  }
  return current;
}

/** Saves the progress for every device. Throws when the server did not take it. */
export async function saveOnboarding(progress: OnboardingProgress, request: Request = browserRequest): Promise<void> {
  const res = await request('PUT', ROUTE, { onboarding: progress });
  if (!res.ok) throw new Error(`Caduceus did not save your setup progress (HTTP ${res.status}).`);
  const answer = (await res.json()) as OnboardingPreference;
  publish(readOnboardingProgress(answer.onboarding));
}

/** The progress to draw: the owner's, once the server has answered, and `undefined` until then. */
export function useOnboarding(): OnboardingProgress | undefined {
  useEffect(() => {
    void loadOnboarding();
  }, []);
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    () => current,
  );
}
