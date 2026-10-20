import { describe, expect, test } from 'vitest';
import { DEFAULT_VOICE_PREFS, languageChoices, normaliseVoicePrefs, recognitionLanguage } from '../src/modules/voice/voice-prefs.ts';

// Settings › Voice (M7 #07): what this device keeps about voice. Hermes's own speech engines are Hermes's; these are the page's choices.
describe('voice preferences', () => {
  test('a device that chose nothing transcribes on the server, reads nothing aloud, and listens in the browser language', () => {
    expect(normaliseVoicePrefs(undefined)).toEqual(DEFAULT_VOICE_PREFS);
    expect(DEFAULT_VOICE_PREFS).toEqual({ engine: 'server', language: '', autoRead: false, holdSends: false });
  });

  test('what is kept is read back, and anything wrong in it is replaced by the default', () => {
    expect(normaliseVoicePrefs({ engine: 'browser', language: 'de-DE', autoRead: true, holdSends: true })).toEqual({ engine: 'browser', language: 'de-DE', autoRead: true, holdSends: true });
    expect(normaliseVoicePrefs({ engine: 'cloud', language: 42, autoRead: 'yes', holdSends: 1 })).toEqual(DEFAULT_VOICE_PREFS);
    expect(normaliseVoicePrefs('nonsense')).toEqual(DEFAULT_VOICE_PREFS);
    expect(normaliseVoicePrefs({ language: 'x'.repeat(40) }).language).toBe('');
  });

  test('the recognition language is the choice, or else the browser’s', () => {
    expect(recognitionLanguage({ ...DEFAULT_VOICE_PREFS, language: 'fr-FR' }, 'en-GB')).toBe('fr-FR');
    expect(recognitionLanguage(DEFAULT_VOICE_PREFS, 'en-GB')).toBe('en-GB');
  });

  test('the choices of language start with the browser’s own and include it only once', () => {
    const choices = languageChoices('pt-BR');
    expect(choices[0]).toEqual({ value: '', label: 'Browser language (pt-BR)' });
    expect(choices.filter((choice) => choice.value === 'pt-BR')).toHaveLength(1);
    expect(choices.some((choice) => choice.value === 'en-US')).toBe(true);
  });
});
