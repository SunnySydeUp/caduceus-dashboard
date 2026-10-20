// When the app asks to be installed, and how (M0 #12; mobile-and-interaction §6). Pure: the page reads the browser (the
// `beforeinstallprompt` event, the display mode, the user agent) and the device's memory, and passes them in
// (`shell/install.ts`).

export type Platform = 'ios' | 'other';

export interface InstallEnvironment {
  /** Chromium delivered `beforeinstallprompt` and it has not been used yet: the app can be installed with one tap. */
  canPrompt: boolean;
  /** The page runs as the installed app (standalone display mode). */
  installed: boolean;
  platform: Platform;
}

/** What this device remembers (`localStorage`): kept per device, because installing is something a device does. */
export interface InstallMemory {
  /** The owner dismissed the offer (the Today card, or the iOS guide). It stays dismissed. */
  dismissed: boolean;
  /** The owner has done something meaningful here: the iOS guide waits for it. */
  acted: boolean;
}

export interface InstallOffer {
  /** Settings › Install: a button, the iOS guide on request, that it is installed, or why there is nothing to do. */
  settings: 'install' | 'guide' | 'installed' | 'unavailable';
  /** First-run Today: the Install card. */
  today: 'install' | 'hidden';
  /** The "Add to Home Screen" guide, opened by itself. */
  guide: 'show' | 'hidden';
}

export function installOffer(environment: InstallEnvironment, memory: InstallMemory): InstallOffer {
  if (environment.installed) return { settings: 'installed', today: 'hidden', guide: 'hidden' };
  if (environment.canPrompt) return { settings: 'install', today: memory.dismissed ? 'hidden' : 'install', guide: 'hidden' };
  // iOS has no install prompt: the way in is the Share sheet, so the guide explains it, once the owner has shown they use the app.
  if (environment.platform === 'ios') return { settings: 'guide', today: 'hidden', guide: memory.acted && !memory.dismissed ? 'show' : 'hidden' };
  return { settings: 'unavailable', today: 'hidden', guide: 'hidden' };
}

/** iPhone, iPad, iPod, and iPadOS, which asks for desktop sites by default and calls itself a Mac: only its touch screen tells it from one. */
export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1) ? 'ios' : 'other';
}

/** Where a device keeps its memory (`localStorage`). */
export const INSTALL_MEMORY_KEY = 'caduceus.install';

/** What a stored string says the device remembers; nothing remembered when it holds nothing usable, and a field that is not a plain `true` is `false`. */
export function parseInstallMemory(raw: string | null): InstallMemory {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? '');
  } catch {
    stored = undefined;
  }
  const field = (name: keyof InstallMemory) => typeof stored === 'object' && stored !== null && (stored as Record<string, unknown>)[name] === true;
  return { dismissed: field('dismissed'), acted: field('acted') };
}
