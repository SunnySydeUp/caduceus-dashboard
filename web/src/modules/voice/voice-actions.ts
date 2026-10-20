// The one change Settings › Voice makes in Hermes: which text to speech engine and voice it speaks with (`PUT /api/config`, Tier 3: the profile's name
// is typed to confirm, because config can switch on ways to run code). The caller shows toasts; this says what happened. Keys only, never values with credentials.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { ttsChange } from './tts-config.ts';

export function saveSpeechVoice(profile: string, provider: string, voice: string): Promise<ActionOutcome> {
  const request = ttsChange(profile, provider, voice);
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Change ${profile}’s voice?`,
        text: `Hermes writes tts.provider${voice.trim() === '' ? '' : ' and the voice'} to the profile’s config. Replies are spoken with it from the next one on, in every chat of the profile and on every device.`,
        object: profile,
        profile,
        confirmLabel: 'Change voice',
        recoverability: { undoable: true, note: 'Set the old engine and voice back the same way.' },
      },
    }),
  );
}
