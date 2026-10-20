// The page's side of Web Push (M2 #03): reading the browser, subscribing from a tap, and telling the Caduceus server. What is offered, and when, is
// `push-offer.ts`; what a message shows is the service worker's (`sw/push-rules.ts`). Permission is only ever asked for from `enablePush`, which the
// Enable button calls: never at start-up, never from an effect.
import type { PushDeviceState, PushSettings } from '@caduceus/contracts/push';
import { detectPlatform } from './install-prompt.ts';
import { fetchWithStepUp } from './passkeys.ts';
import { pushOffer, testPushFailure, type PushEnvironment, type PushOffer } from './push-offer.ts';

const standalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || ('standalone' in navigator && navigator.standalone === true);

/** What the browser can do now, and what this device holds. */
export async function readPushEnvironment(): Promise<PushEnvironment> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let subscribed = false;
  if (supported) {
    const registration = await navigator.serviceWorker.getRegistration();
    subscribed = (await registration?.pushManager.getSubscription()) != null && (await readDeviceState()).subscribed;
  }
  return { supported, installed: standalone(), platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints), permission: 'Notification' in window ? Notification.permission : 'denied', subscribed };
}

export async function readOffer(): Promise<PushOffer> {
  return pushOffer(await readPushEnvironment());
}

async function call(route: string, init?: RequestInit, { stepUp = false } = {}): Promise<Response> {
  const send = () => fetch(`/_caduceus/api/push/${route}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const res = await (stepUp ? fetchWithStepUp(send) : send());
  if (!res.ok) throw new Error(`Caduceus answered HTTP ${res.status}.`);
  return res;
}

/** What Caduceus holds for this device: whether it is subscribed, and its settings. */
export async function readDeviceState(): Promise<PushDeviceState> {
  return (await call('subscription')).json();
}

/**
 * Asks for permission (a tap made this call), subscribes this browser with Caduceus's key and tells Caduceus, with this device's time zone and the address
 * its pages are served from. Rejects with a sentence when it did not work.
 */
export async function enablePush(): Promise<PushDeviceState> {
  if (Notification.permission === 'default' && (await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed. You can allow them in this browser’s site settings.');
  if (Notification.permission !== 'granted') throw new Error('Notifications are blocked for this site in the browser’s settings.');
  const { publicKey } = (await (await call('key')).json()) as { publicKey: string };
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  // A subscription made with another key (the server's was replaced) is useless: it is made again.
  const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }));
  const settings: Partial<PushSettings> = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  return (await call('subscription', { method: 'PUT', body: JSON.stringify({ subscription: subscription.toJSON(), origin: location.origin, settings }) }, { stepUp: true })).json();
}

/** Turns notifications off for this device: Caduceus forgets it, and so does the browser. */
export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
  await call('subscription', { method: 'DELETE' });
}

export async function savePushSettings(patch: Record<string, unknown>): Promise<PushDeviceState> {
  return (await call('settings', { method: 'PATCH', body: JSON.stringify(patch) })).json();
}

/** Sends this device a test notification. */
export async function sendTestPush(): Promise<void> {
  const res = await fetch('/_caduceus/api/push/test', { method: 'POST', headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(testPushFailure(res.status, await res.json().catch(() => undefined)));
}
