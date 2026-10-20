import { describe, expect, test } from 'vitest';
import { detectPlatform, installOffer, parseInstallMemory, type InstallEnvironment, type InstallMemory } from '../src/install-prompt.ts';

// When the app asks to be installed, and how (M0 #12; mobile-and-interaction §6): an Install button for Chromium browsers in
// Settings and on first-run Today, and an "Add to Home Screen" guide for iOS after a meaningful action, which stays dismissed.
const FRESH: InstallMemory = { dismissed: false, acted: false };
const chromium: InstallEnvironment = { canPrompt: true, installed: false, platform: 'other' };
const ios: InstallEnvironment = { canPrompt: false, installed: false, platform: 'ios' };

describe('a Chromium browser', () => {
  test('gets an Install button in Settings and on first-run Today', () => {
    expect(installOffer(chromium, FRESH)).toEqual({ settings: 'install', today: 'install', guide: 'hidden' });
  });

  test('keeps the Settings button once the Today card is dismissed, which only hides the card', () => {
    expect(installOffer(chromium, { dismissed: true, acted: false })).toEqual({ settings: 'install', today: 'hidden', guide: 'hidden' });
  });

  test('is not asked to install what is installed: Settings says so', () => {
    expect(installOffer({ ...chromium, installed: true }, FRESH)).toEqual({ settings: 'installed', today: 'hidden', guide: 'hidden' });
  });

  test('has no button before the browser says the app can be installed', () => {
    expect(installOffer({ ...chromium, canPrompt: false }, FRESH)).toEqual({ settings: 'unavailable', today: 'hidden', guide: 'hidden' });
  });
});

describe('an iOS browser', () => {
  test('is shown the Add to Home Screen guide only after a meaningful action, never on first load', () => {
    expect(installOffer(ios, FRESH).guide).toBe('hidden');
    expect(installOffer(ios, { dismissed: false, acted: true }).guide).toBe('show');
  });

  test('is never shown the guide again once it is dismissed, however much it does', () => {
    expect(installOffer(ios, { dismissed: true, acted: true })).toEqual({ settings: 'guide', today: 'hidden', guide: 'hidden' });
  });

  test('can always open the guide from Settings, and has no Install button or Today card (there is no install prompt on iOS)', () => {
    expect(installOffer(ios, FRESH)).toEqual({ settings: 'guide', today: 'hidden', guide: 'hidden' });
    expect(installOffer(ios, { dismissed: true, acted: false }).settings).toBe('guide');
  });

  test('is not shown the guide once the app runs from the Home Screen', () => {
    expect(installOffer({ ...ios, installed: true }, { dismissed: false, acted: true })).toEqual({ settings: 'installed', today: 'hidden', guide: 'hidden' });
  });

  test('and a browser that offers no install at all, other than iOS, gets neither the guide nor a button, whatever it has done', () => {
    expect(installOffer({ canPrompt: false, installed: false, platform: 'other' }, { dismissed: false, acted: true })).toEqual({ settings: 'unavailable', today: 'hidden', guide: 'hidden' });
  });
});

describe('which platform this is', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
  // iPadOS asks for desktop sites by default and then says it is a Mac; only its touch screen gives it away.
  const IPADOS_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';
  const CHROME_ON_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/137.0.7151.51 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  test('iPhone, iPad, iPadOS posing as a Mac, and other browsers on iOS are iOS', () => {
    expect(detectPlatform(IPHONE, 5)).toBe('ios');
    expect(detectPlatform(IPAD, 5)).toBe('ios');
    expect(detectPlatform(IPADOS_AS_MAC, 5)).toBe('ios');
    // Any browser on iOS adds to the Home Screen through the Share sheet.
    expect(detectPlatform(CHROME_ON_IOS, 5)).toBe('ios');
  });

  test('a Mac without a touch screen, Android and Windows are not', () => {
    expect(detectPlatform(IPADOS_AS_MAC, 0)).toBe('other');
    expect(detectPlatform(ANDROID, 5)).toBe('other');
    expect(detectPlatform(WINDOWS, 0)).toBe('other');
  });
});

describe('what a device remembers', () => {
  test('is read back as it was stored, per field', () => {
    expect(parseInstallMemory(JSON.stringify({ dismissed: true, acted: false }))).toEqual({ dismissed: true, acted: false });
    expect(parseInstallMemory(JSON.stringify({ dismissed: false, acted: true }))).toEqual({ dismissed: false, acted: true });
  });

  test('is nothing remembered when nothing usable was stored, and a field that is not a plain yes counts as no', () => {
    for (const raw of [null, '', 'not json', '[]', '7', '{}']) expect(parseInstallMemory(raw), String(raw)).toEqual(FRESH);
    expect(parseInstallMemory(JSON.stringify({ dismissed: 'yes', acted: 1 }))).toEqual(FRESH);
    expect(parseInstallMemory(JSON.stringify({ dismissed: true }))).toEqual({ dismissed: true, acted: false });
  });
});
