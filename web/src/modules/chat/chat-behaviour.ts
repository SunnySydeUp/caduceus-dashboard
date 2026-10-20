// How the chat behaves for its owner (M1 #20; `contracts/chat-behaviour.ts`): the page's copy of the preferences the server keeps (the device's and the owner's),
// and what each setting makes the chat do, as pure functions. Nothing here talks to Hermes.
import { useSyncExternalStore } from 'react';
import { DEFAULT_ACCOUNT_BEHAVIOUR, DEFAULT_DEVICE_BEHAVIOUR, accountBehaviourOf, deviceBehaviourOf, resolveSendKey, type AccountBehaviour, type ChatBehaviour, type DeviceBehaviour } from '@caduceus/contracts/chat-behaviour';

/** The page's way to call the server; `fetch` in the browser, the test server's in a test. */
export type Request = (method: string, path: string, body?: unknown) => Promise<Response>;

const ROUTE = '/_caduceus/api/preferences/chat-behaviour';
const browserRequest: Request = (method, path, body) => fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

/** What a key press does in a message box: whether it sends the message. Enter that confirms an input method's word never does. */
export function sendsMessage(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; isComposing: boolean }, sendKey: 'mod-enter' | 'enter'): boolean {
  if (event.key !== 'Enter' || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey) return true;
  return sendKey === 'enter' && !event.shiftKey;
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayWithYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The time written under a message (`seconds` since the epoch): the clock for today, the date with it for another day, with the year when it is not this one. */
export function timeLabel(seconds: number, nowSeconds: number): string {
  const when = new Date(seconds * 1000);
  const now = new Date(nowSeconds * 1000);
  if (when.toDateString() === now.toDateString()) return clock.format(when);
  return `${(when.getFullYear() === now.getFullYear() ? day : dayWithYear).format(when)}, ${clock.format(when)}`;
}

/** A short two-note chime for a finished reply. A browser that will not play it (no audio, or not yet allowed) says nothing: it is a courtesy. */
export function playCompletionSound(): void {
  try {
    const audio = new AudioContext();
    const gain = audio.createGain();
    gain.gain.value = 0.08;
    gain.connect(audio.destination);
    for (const [index, frequency] of [660, 880].entries()) {
      const note = audio.createOscillator();
      note.frequency.value = frequency;
      note.connect(gain);
      note.start(audio.currentTime + index * 0.12);
      note.stop(audio.currentTime + index * 0.12 + 0.1);
    }
    setTimeout(() => void audio.close(), 500);
  } catch {
    // No sound.
  }
}

/** The words that refuse a pin which would take the pinned sessions past the limit; `undefined` when it fits. */
export function pinRefusal({ pinned, adding, limit }: { pinned: number; adding: number; limit: number }): string | undefined {
  return pinned + adding > limit ? `You can pin at most ${limit} sessions. Unpin one first, or raise the limit in Settings › Chat.` : undefined;
}

/** Whether a transcript that grew scrolls to its end: the setting is on and the reader is at the end. */
export const followsGrowth = ({ autoFollow, following }: { autoFollow: boolean; following: boolean }): boolean => autoFollow && following;

let current: ChatBehaviour = { device: DEFAULT_DEVICE_BEHAVIOUR, account: DEFAULT_ACCOUNT_BEHAVIOUR };
let asked = false;
const listeners = new Set<() => void>();
const publish = (next: ChatBehaviour) => {
  current = next;
  listeners.forEach((notify) => notify());
};
const adopt = (body: unknown): ChatBehaviour => {
  const record = typeof body === 'object' && body !== null ? (body as { device?: unknown; account?: unknown }) : {};
  return { device: deviceBehaviourOf(record.device), account: accountBehaviourOf(record.account) };
};

/** Asks the server for the behaviour (once per page unless `again`); the defaults until it answers, or when it does not. */
export async function loadChatBehaviour(request: Request = browserRequest, again = false): Promise<ChatBehaviour> {
  if (asked && !again) return current;
  asked = true;
  const res = await request('GET', ROUTE).catch(() => undefined);
  if (res?.ok) publish(adopt(await res.json()));
  else asked = false;
  return current;
}

/** Changes settings (`null` for a scope resets it to its defaults). Every chat shows the change at once; resolves false when the server refused it. */
export async function saveChatBehaviour(change: { device?: Partial<DeviceBehaviour> | null; account?: Partial<AccountBehaviour> | null }, request: Request = browserRequest): Promise<boolean> {
  const before = current;
  // Shown at once; put back if the server says no.
  publish({ device: change.device === null ? DEFAULT_DEVICE_BEHAVIOUR : { ...current.device, ...change.device }, account: change.account === null ? DEFAULT_ACCOUNT_BEHAVIOUR : { ...current.account, ...change.account } });
  const res = await request('PUT', ROUTE, change).catch(() => undefined);
  if (res?.ok) {
    publish(adopt(await res.json()));
    return true;
  }
  publish(before);
  return false;
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

/** The behaviour in force: what the server last said, the defaults before that. */
export function useChatBehaviour(): ChatBehaviour {
  return useSyncExternalStore(subscribe, () => current);
}

const FINE_POINTER = '(pointer: fine)';
const watchPointer = (notify: () => void) => {
  if (typeof matchMedia !== 'function') return () => undefined;
  const query = matchMedia(FINE_POINTER);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

/** Whether this device has a fine pointer (a mouse or trackpad) rather than touch only. */
export function useFinePointer(): boolean {
  return useSyncExternalStore(watchPointer, () => typeof matchMedia === 'function' && matchMedia(FINE_POINTER).matches);
}

/** The key that sends a message on this device: the owner's choice, or for Automatic what the pointer of this device says (Enter with a mouse or trackpad). */
export function useSendKey(): 'mod-enter' | 'enter' {
  const { sendKey } = useChatBehaviour().device;
  return resolveSendKey(sendKey, useFinePointer());
}
