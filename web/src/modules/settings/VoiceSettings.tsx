// Settings › Voice (M7 #07): where speech becomes text, the language, whether replies are read aloud by themselves, and which voice Hermes speaks with.
// What this device chooses (engine, language, auto-read, hold-to-send) it keeps itself (`voice-prefs.ts`); Hermes's own engines are Hermes's config.
import { useEffect, useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { pageMicSupport } from '../voice/recorder.ts';
import { readAloud, readReply, useReadAloud } from '../voice/read-aloud-store.ts';
import { TTS_PROVIDERS } from '../voice/tts-config.ts';
import { readVoiceConfig, type VoiceConfig } from '../voice/voice-api.ts';
import { saveSpeechVoice } from '../voice/voice-actions.ts';
import { languageChoices, setVoicePrefs, useVoicePrefs } from '../voice/voice-prefs.ts';
import { hasBrowserRecognition } from '../voice/web-speech.ts';

const TEST_SENTENCE = 'This is how Hermes sounds when it reads a reply to you.';

interface VoiceOption {
  voice_id: string;
  label: string;
}

/** The ElevenLabs voices of the profile, when Hermes has a key for it. */
async function readElevenLabsVoices(profile: string): Promise<VoiceOption[]> {
  const res = await fetch(`/api/audio/elevenlabs/voices?profile=${encodeURIComponent(profile)}`).catch(() => undefined);
  if (!res?.ok) return [];
  const body: unknown = await res.json().catch(() => undefined);
  const rows = typeof body === 'object' && body !== null && 'voices' in body && Array.isArray(body.voices) ? (body.voices as unknown[]) : [];
  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null || !('voice_id' in row) || typeof row.voice_id !== 'string') return [];
    return [{ voice_id: row.voice_id, label: 'label' in row && typeof row.label === 'string' ? row.label : row.voice_id }];
  });
}

export function VoiceSettings() {
  const ids = useId();
  const prefs = useVoicePrefs();
  const { effective } = useProfileScope();
  const profile = effective?.name;
  const support = pageMicSupport();
  const browserEngine = hasBrowserRecognition();
  const [config, setConfig] = useState<VoiceConfig>();
  const [loadFailed, setLoadFailed] = useState<string>();
  const [provider, setProvider] = useState('');
  const [voice, setVoice] = useState('');
  const [elevenLabs, setElevenLabs] = useState<VoiceOption[]>([]);
  const [saving, setSaving] = useState(false);
  const reading = useReadAloud();

  useEffect(() => {
    if (profile === undefined) return;
    let current = true;
    readVoiceConfig({ profile }).then(
      (found) => {
        if (!current) return;
        setConfig(found);
        setProvider(found.tts.provider ?? '');
        setVoice(found.tts.voice ?? '');
      },
      (error: unknown) => current && setLoadFailed(error instanceof Error ? error.message : String(error)),
    );
    void readElevenLabsVoices(profile).then((voices) => current && setElevenLabs(voices));
    return () => {
      current = false;
    };
  }, [profile]);
  // Leaving the panel ends a test that is still playing.
  useEffect(() => readAloud.stop, []);

  const known = TTS_PROVIDERS.some((entry) => entry.id === provider);
  const changed = config !== undefined && (provider !== (config.tts.provider ?? '') || voice !== (config.tts.voice ?? ''));
  const save = async () => {
    if (profile === undefined || provider === '') return;
    setSaving(true);
    const outcome = await saveSpeechVoice(profile, provider, voice);
    setSaving(false);
    if (outcome.kind === 'failed') toast('Hermes did not change the voice', { tone: 'danger', detail: outcome.message });
    else if (outcome.kind === 'done') {
      toast('Voice changed', { tone: 'success' });
      setConfig(await readVoiceConfig({ profile }).catch(() => config));
    }
  };

  return (
    <div className="page-stack">
      <PageHeader title="Voice" subtitle="Dictation, hands-free conversation and reading replies aloud." />

      {!support.ok && (
        <p className="banner banner--warning" role="note">
          <Icon name="info" small />
          <span>{support.message}</span>
        </p>
      )}

      <section className="settings-section" aria-labelledby={`${ids}-engine`}>
        <h2 id={`${ids}-engine`}>Dictation: where speech becomes text</h2>
        <p className="help-text">
          <Term id="dictation">Dictation</Term> puts your spoken words in the message box for you to read before you send them.
        </p>
        <ul className="settings-list">
          <li className="settings-row" data-setting-field="voice/engine" tabIndex={-1}>
            <label className="settings-row-text" htmlFor={`${ids}-engine-pick`}>
              <strong>Engine</strong>
              <span className="help-text">Hermes transcribes on the server with the speech to text it is set up with. The browser’s own engine is quicker but, in some browsers, sends your voice to the browser’s maker.</span>
            </label>
            <select id={`${ids}-engine-pick`} className="input" value={prefs.engine} onChange={(event) => setVoicePrefs({ engine: event.target.value === 'browser' ? 'browser' : 'server' })}>
              <option value="server">Hermes{config?.stt.provider ? ` (${config.stt.provider})` : ''}</option>
              <option value="browser" disabled={!browserEngine}>
                This browser{browserEngine ? '' : ' (not available here)'}
              </option>
            </select>
          </li>
          <li className="settings-row" data-setting-field="voice/language" tabIndex={-1}>
            <label className="settings-row-text" htmlFor={`${ids}-language`}>
              <strong>Language</strong>
              <span className="help-text">For the browser’s engine. Hermes’s own engine uses the language set in its config (stt.language).</span>
            </label>
            <select id={`${ids}-language`} className="input" value={prefs.language} disabled={prefs.engine !== 'browser'} onChange={(event) => setVoicePrefs({ language: event.target.value })}>
              {languageChoices(navigator.language).map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </li>
          <li className="switch-row settings-row" data-setting-field="voice/hold-sends" tabIndex={-1}>
            <label htmlFor={`${ids}-hold`} className="settings-row-text">
              <strong id={`${ids}-hold-name`}>Letting go of the mic sends the message</strong>
              <span className="help-text">On a phone, hold the mic to talk. By default the words wait in the message box for you to read; with this on, letting go sends them. Sliding away always cancels.</span>
            </label>
            <button type="button" id={`${ids}-hold`} className="switch" role="switch" aria-checked={prefs.holdSends} aria-labelledby={`${ids}-hold-name`} onClick={() => setVoicePrefs({ holdSends: !prefs.holdSends })} />
          </li>
        </ul>
      </section>

      <section className="settings-section" aria-labelledby={`${ids}-read`}>
        <h2 id={`${ids}-read`}>Read aloud</h2>
        <p className="help-text">
          <Term id="read-aloud">Read aloud</Term> has Hermes’s voice speak a reply to you.
        </p>
        <ul className="settings-list">
          <li className="switch-row settings-row" data-setting-field="voice/auto-read" tabIndex={-1}>
            <label htmlFor={`${ids}-auto`} className="settings-row-text">
              <strong id={`${ids}-auto-name`}>Read each reply aloud</strong>
              <span className="help-text">When Hermes finishes a reply in front of you. Your browser may need one tap on Read aloud first before it lets a page play sound by itself.</span>
            </label>
            <button type="button" id={`${ids}-auto`} className="switch" role="switch" aria-checked={prefs.autoRead} aria-labelledby={`${ids}-auto-name`} onClick={() => setVoicePrefs({ autoRead: !prefs.autoRead })} />
          </li>
        </ul>
        {loadFailed !== undefined && <p className="help-text" role="alert">Hermes did not say how it speaks: {loadFailed}</p>}
        {config !== undefined && (
          <>
            <h3 id={`${ids}-voice`} data-setting-field="voice/hermes-voice" tabIndex={-1}>
              Hermes’s voice
            </h3>
            <p className="help-text">Hermes speaks with the text to speech engine of {profile}’s config{config.tts.mode === 'relay' ? ', and the sound reaches this page through Hermes' : ''}. Changing it changes the config, so it asks you to confirm with the profile’s name.</p>
            <div className="settings-actions">
              <label htmlFor={`${ids}-tts`}>Engine</label>
              <select id={`${ids}-tts`} className="input" value={provider} onChange={(event) => { setProvider(event.target.value); setVoice(''); }}>
                {!known && provider !== '' && <option value={provider}>{provider}</option>}
                {TTS_PROVIDERS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <label htmlFor={`${ids}-tts-voice`}>Voice</label>
              {provider === 'elevenlabs' && elevenLabs.length > 0 ? (
                <select id={`${ids}-tts-voice`} className="input" value={voice} onChange={(event) => setVoice(event.target.value)}>
                  {!elevenLabs.some((entry) => entry.voice_id === voice) && <option value={voice}>{voice === '' ? 'Hermes’s default' : voice}</option>}
                  {elevenLabs.map((entry) => (
                    <option key={entry.voice_id} value={entry.voice_id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input id={`${ids}-tts-voice`} className="input" value={voice} placeholder="Hermes’s default" onChange={(event) => setVoice(event.target.value)} />
              )}
            </div>
            <div className="settings-actions">
              <button type="button" className="btn btn--primary" disabled={!changed || saving || provider === ''} onClick={() => void save()}>
                Save voice
              </button>
              <button type="button" className="btn btn--secondary" disabled={profile === undefined} onClick={() => void readReply('voice-test', TEST_SENTENCE, profile)}>
                <Icon name={reading.phase === 'idle' ? 'speaker' : 'stop'} small />
                {reading.phase === 'idle' ? 'Hear it' : 'Stop'}
              </button>
            </div>
            {reading.error !== undefined && <p className="help-text" role="alert">{reading.error}</p>}
            <p className="help-text">
              Transcription is Hermes’s too: it uses {config.stt.provider ? `${config.stt.provider}` : 'the engine set in the config'} (stt.provider), which System › Config changes.
            </p>
          </>
        )}
      </section>

      <section className="settings-section" aria-labelledby={`${ids}-hf`}>
        <h2 id={`${ids}-hf`}>Hands-free</h2>
        <p className="help-text">
          <Term id="hands-free">Hands-free</Term> mode: press the wave button in the message box. Caduceus listens, notices when you stop speaking, has Hermes transcribe it, sends it, reads the reply aloud and listens again, until you press Stop or leave the chat. It uses Hermes’s own speech to text and text to speech, not the microphone of the Mac that runs Hermes.
        </p>
      </section>
    </div>
  );
}
