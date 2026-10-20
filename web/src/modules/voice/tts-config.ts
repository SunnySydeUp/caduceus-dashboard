// Which text to speech engine and voice Hermes speaks with (Settings › Voice, M7 #07), free of the DOM and of React. They are Hermes's config
// (`tts.provider` and the voice key of the engine's own section), so choosing one is a config save, which is a Tier 3 (`voice-actions.ts`).
import { configUpdateRequest, type ConfigUpdate } from '../config/config-model.ts';

/** The engines Hermes ships with a text to speech of its own (`tts.provider`). Hermes also takes command and plugin providers, which show up as the current one when set. */
export const TTS_PROVIDERS: readonly { id: string; label: string }[] = [
  { id: 'edge', label: 'Edge (free, on this Mac)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'deepinfra', label: 'DeepInfra' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'xai', label: 'xAI' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'piper', label: 'Piper (on this Mac)' },
  { id: 'kittentts', label: 'KittenTTS (on this Mac)' },
  { id: 'neutts', label: 'NeuTTS (on this Mac)' },
];

/** The config key that holds the voice of an engine: ElevenLabs calls it `voice_id`, the others `voice`. */
export function ttsVoiceKey(provider: string): string {
  return `tts.${provider}.${provider === 'elevenlabs' ? 'voice_id' : 'voice'}`;
}

/** The save that makes `provider` Hermes's text to speech engine and, when one is named, `voice` its voice. */
export function ttsChange(profile: string, provider: string, voice: string): ConfigUpdate {
  const pending = new Map<string, string>([['tts.provider', provider]]);
  if (voice.trim() !== '') pending.set(ttsVoiceKey(provider), voice.trim());
  return configUpdateRequest(profile, pending);
}
