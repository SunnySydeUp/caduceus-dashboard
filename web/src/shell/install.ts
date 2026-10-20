// Installing the app, in the running page (M0 #12): the browser's `beforeinstallprompt`, whether the page already runs as an installed
// app, and what this device remembers about the offer. What is offered, and when, is decided by `../install-prompt.ts`.
import { useSyncExternalStore } from 'react';
import { detectPlatform, INSTALL_MEMORY_KEY, installOffer, parseInstallMemory, type InstallEnvironment, type InstallMemory, type InstallOffer } from '../install-prompt.ts';

/** Chromium's install prompt event; it is in no TypeScript library yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | undefined;
/** The app was installed while this page was open (`appinstalled`), so it is not running as the installed app yet. */
let installedNow = false;
let memory: InstallMemory = readMemory();
let snapshot: InstallOffer | undefined;
/** The "Add to Home Screen" guide is open. */
let guideOpen = false;
const listeners = new Set<() => void>();

function readMemory(): InstallMemory {
  try {
    return parseInstallMemory(localStorage.getItem(INSTALL_MEMORY_KEY));
  } catch {
    return parseInstallMemory(null);
  }
}

function environment(): InstallEnvironment {
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || ('standalone' in navigator && navigator.standalone === true);
  return { canPrompt: deferred !== undefined, installed: standalone || installedNow, platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints) };
}

function publish(): void {
  snapshot = installOffer(environment(), memory);
  listeners.forEach((notify) => notify());
}

function remember(change: Partial<InstallMemory>): void {
  memory = { ...memory, ...change };
  try {
    localStorage.setItem(INSTALL_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Storage blocked: the offer comes back with the next page load.
  }
  publish();
}

/** Starts listening for the browser's install events. Called once, as the page starts, so that an event that fires before the app has loaded is not lost. */
export function captureInstallEvents(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // The browser's own mini-bar would pre-empt the app's Install button.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    publish();
  });
  window.addEventListener('appinstalled', () => {
    installedNow = true;
    deferred = undefined;
    publish();
  });
}

/** Shows the browser's install dialog (from a tap on the Install button). */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  // The browser lets an event prompt once, whatever the answer.
  deferred = undefined;
  await event.prompt();
  const { outcome } = await event.userChoice;
  // Declining the browser's dialog is dismissing the offer: the Today card does not come back, and Settings still has the button.
  if (outcome === 'dismissed') remember({ dismissed: true });
  else publish();
}

/** Opens the iOS guide: from its banner, or from Settings. */
export function openInstallGuide(): void {
  guideOpen = true;
  publish();
}

/** Closes the guide. Having seen it is answer enough: it is not offered again by itself. */
export function closeInstallGuide(): void {
  guideOpen = false;
  remember({ dismissed: true });
}

/** The owner turned the offer down (the Today card, or the iOS guide): it stays dismissed on this device. */
export function dismissInstallOffer(): void {
  remember({ dismissed: true });
}

/** The owner did something here that shows they use the app (added a passkey, chose an appearance, ran a Repair): the iOS guide may now appear. */
export function noteMeaningfulAction(): void {
  if (!memory.acted) remember({ acted: true });
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

/** Whether the iOS guide is open. */
export function useInstallGuideOpen(): boolean {
  return useSyncExternalStore(subscribe, () => guideOpen);
}

/** What the page offers for installing the app, kept up to date. */
export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(subscribe, () => (snapshot ??= installOffer(environment(), memory)));
}
