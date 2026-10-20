// What this device chose for voice (Settings › Voice, M7 #07). It is the device's: a phone may dictate in the browser while the laptop uses Hermes, and the
// browser's own speech engine exists on some devices only. So it is kept in the browser's storage, not in Caduceus's or Hermes's. Hermes's own
// text to speech engine and voice are Hermes's config, changed in the same panel through the policy proxy (`voice-actions.ts`).
import { useSyncExternalStore } from 'react';

export interface VoicePrefs {
  /** Where speech becomes text: `server` is Hermes's speech to text (`/api/audio/transcribe`); `browser` is the browser's Web Speech API, where it has one. */
  engine: 'server' | 'browser';
  /** A BCP 47 tag the browser's engine listens for; empty for the browser's own language. */
  language: string;
  /** Read each reply aloud when it is done. */
  autoRead: boolean;
  /** On a phone, letting go of a held mic sends the message at once instead of leaving the words in the message box. */
  holdSends: boolean;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = { engine: 'server', language: '', autoRead: false, holdSends: false };

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

/** What storage held, made into preferences: anything that is not a valid choice is the default. */
export function normaliseVoicePrefs(stored: unknown): VoicePrefs {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_VOICE_PREFS;
  const row: Record<string, unknown> = { ...stored };
  return {
    engine: row.engine === 'browser' || row.engine === 'server' ? row.engine : DEFAULT_VOICE_PREFS.engine,
    language: typeof row.language === 'string' && LANGUAGE_TAG.test(row.language) ? row.language : DEFAULT_VOICE_PREFS.language,
    autoRead: row.autoRead === true,
    holdSends: row.holdSends === true,
  };
}

/** The language the browser's engine listens for. */
export function recognitionLanguage(prefs: VoicePrefs, browserLanguage: string): string {
  return prefs.language === '' ? browserLanguage : prefs.language;
}

const COMMON_LANGUAGES: readonly [string, string][] = [
  ['en-US', 'English (United States)'],
  ['en-GB', 'English (United Kingdom)'],
  ['de-DE', 'Deutsch'],
  ['fr-FR', 'Français'],
  ['es-ES', 'Español'],
  ['it-IT', 'Italiano'],
  ['pt-BR', 'Português (Brasil)'],
  ['nl-NL', 'Nederlands'],
  ['ja-JP', '日本語'],
  ['ko-KR', '한국어'],
  ['zh-CN', '中文 (普通话)'],
];

/** The languages the picker offers: the browser's own first, then common ones (the browser's, once, if it is among them). */
export function languageChoices(browserLanguage: string): { value: string; label: string }[] {
  return [{ value: '', label: `Browser language (${browserLanguage})` }, ...COMMON_LANGUAGES.map(([value, label]) => ({ value, label }))];
}

const KEY = 'caduceus.voice';

const read = (): VoicePrefs => {
  try {
    return normaliseVoicePrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return DEFAULT_VOICE_PREFS;
  }
};

let current = read();
const listeners = new Set<() => void>();

/** Remembers the device's choices; every `useVoicePrefs` re-renders. */
export function setVoicePrefs(change: Partial<VoicePrefs>): void {
  current = normaliseVoicePrefs({ ...current, ...change });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage is full or refused: the choices last until the page closes.
  }
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export const voicePrefsNow = () => current;

export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(subscribe, voicePrefsNow);
}
