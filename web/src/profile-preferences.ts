// What Caduceus keeps about a Hermes profile that Hermes does not (M4 #01): today the assistant display name that chat headers
// show. The server stores it (`/_caduceus/api/preferences/profiles/:profile`); this is the page's copy of what it last heard,
// so a header and the Identity tab agree without asking again. Nothing here talks to Hermes.
import { useEffect, useSyncExternalStore } from 'react';
import type { ProfilePreferences } from '@caduceus/contracts/caduceus-api';

/** The page's way to call the server; `fetch` in the browser, the test server's in a test. */
export type Request = (method: string, path: string, body?: unknown) => Promise<Response>;

const names = new Map<string, string | null>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((notify) => notify());

const route = (profile: string) => `/_caduceus/api/preferences/profiles/${encodeURIComponent(profile)}`;
const browserRequest: Request = (method, path, body) =>
  fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

/** Asks the server for a profile's assistant name (once per page unless `again`). `undefined` while it has not answered. */
export async function loadAssistantName(profile: string, request: Request = browserRequest, again = false): Promise<string | null | undefined> {
  if (asked.has(profile) && !again) return names.get(profile);
  asked.add(profile);
  const res = await request('GET', route(profile)).catch(() => undefined);
  if (res?.ok) {
    names.set(profile, ((await res.json()) as ProfilePreferences).assistantName);
    publish();
  } else asked.delete(profile);
  return names.get(profile);
}

/** Saves the name (blank clears it) and says what the server stored. Throws when it was not saved. */
export async function saveAssistantName(profile: string, name: string, request: Request = browserRequest): Promise<string | null> {
  const res = await request('PUT', route(profile), { assistantName: name });
  if (!res.ok) throw new Error(`Caduceus did not save the name (HTTP ${res.status}).`);
  const saved = ((await res.json()) as ProfilePreferences).assistantName;
  asked.add(profile);
  names.set(profile, saved);
  publish();
  return saved;
}

/** A profile Hermes renamed keeps its name: the preference moves to the new name. */
export async function moveProfilePreferences(from: string, to: string, request: Request = browserRequest): Promise<void> {
  const current = await loadAssistantName(from, request, true);
  if (current) await saveAssistantName(to, current, request);
  await forgetProfilePreferences(from, request);
}

/** A profile Hermes deleted leaves nothing behind in Caduceus. */
export async function forgetProfilePreferences(profile: string, request: Request = browserRequest): Promise<void> {
  const res = await request('DELETE', route(profile));
  if (!res.ok) throw new Error(`Caduceus did not clear the preferences of ${profile} (HTTP ${res.status}).`);
  names.delete(profile);
  asked.delete(profile);
  publish();
}

/** The assistant name of a profile, `null` when it has none or until the server has answered. */
export function useAssistantName(profile: string | undefined): string | null {
  useEffect(() => {
    if (profile) void loadAssistantName(profile);
  }, [profile]);
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    () => (profile ? (names.get(profile) ?? null) : null),
  );
}
