// Dictation and audio messages as React state (M7 #07): the mic of the composer. Pressing it asks the browser for the microphone for the first time
// (never before), records, and then either has Hermes transcribe the recording (or the browser's own engine listen) and hands the words to the
// composer to review, or hands over the recording itself as an audio message. The gesture is `hold-to-talk.ts`, the wording of a refusal `mic.ts`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordingName } from './audio-attachment.ts';
import { describeMicError } from './mic.ts';
import { openMic, pageMicSupport, type Mic, type Recording } from './recorder.ts';
import { transcribe } from './voice-api.ts';
import { recognitionLanguage, type VoicePrefs } from './voice-prefs.ts';
import { hasBrowserRecognition, startBrowserDictation, type BrowserDictation } from './web-speech.ts';

export type VoiceInputPhase = 'idle' | 'starting' | 'listening' | 'transcribing';
export type VoiceInputMode = 'dictate' | 'message';

export interface VoiceInputOptions {
  prefs: VoicePrefs;
  /** The profile whose speech settings Hermes transcribes with. */
  profile: string | undefined;
  /** Words to put in the message box for the owner to review. `send` is true when the phone's hold-to-talk was set to send on release. */
  onText(text: string, send: boolean): void;
  /** A recording to attach as an audio message. */
  onAudio(audio: Blob, name: string): void;
}

export interface VoiceInput {
  phase: VoiceInputPhase;
  mode: VoiceInputMode | undefined;
  /** Seconds recorded so far. */
  seconds: number;
  /** What the browser's engine has heard so far (it shows while the owner speaks). */
  interim: string;
  /** Why the microphone could not be used, or that nothing was heard; stays until dismissed or the next try. */
  problem: string | undefined;
  /** Whether this page may ask for the microphone at all, and if not why not. */
  unsupported: string | undefined;
  begin(mode: VoiceInputMode): void;
  /** Ends the recording and uses it. `send`: send the words as a message (hold-to-talk set to send). */
  finish(send?: boolean): void;
  cancel(): void;
  dismissProblem(): void;
}

const words = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useVoiceInput(options: VoiceInputOptions): VoiceInput {
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const [mode, setMode] = useState<VoiceInputMode>();
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState('');
  const [problem, setProblem] = useState<string>();
  const latest = useRef(options);
  latest.current = options;
  const mic = useRef<Mic>(undefined);
  const recording = useRef<Recording>(undefined);
  const browser = useRef<BrowserDictation>(undefined);
  const timer = useRef<number>(undefined);
  /** The press ended while the browser was still asking for the microphone: it listens on until Done. */
  const starting = useRef<{ cancelled: boolean }>(undefined);
  const live = useRef<VoiceInputPhase>('idle');
  const move = (next: VoiceInputPhase) => {
    live.current = next;
    setPhase(next);
  };

  const release = useCallback(() => {
    window.clearInterval(timer.current);
    timer.current = undefined;
    mic.current?.close();
    mic.current = undefined;
    recording.current = undefined;
    browser.current = undefined;
    setSeconds(0);
    setInterim('');
  }, []);

  const begin = useCallback(
    (next: VoiceInputMode) => {
      if (live.current !== 'idle') return;
      const { prefs } = latest.current;
      const useBrowser = next === 'dictate' && prefs.engine === 'browser' && hasBrowserRecognition();
      const support = pageMicSupport();
      // The browser's own engine needs no recorder of ours, but it is as much a secure-page feature as the recorder is.
      if (!support.ok && !(useBrowser && support.reason === 'unsupported')) {
        setProblem(support.message);
        return;
      }
      setProblem(undefined);
      setMode(next);
      const startedAt = Date.now();
      const tick = () => {
        timer.current = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
      };
      if (useBrowser) {
        move('listening');
        tick();
        browser.current = startBrowserDictation(recognitionLanguage(prefs, navigator.language), {
          onText: setInterim,
          onEnd(text) {
            release();
            move('idle');
            if (text === '') setProblem('Nothing was heard. Press the microphone and try again, or type.');
            else latest.current.onText(text, false);
          },
          onError(code) {
            setProblem(code === 'not-allowed' || code === 'service-not-allowed' ? describeMicError(Object.assign(new Error(code), { name: 'NotAllowedError' }), navigator.userAgent).message : `The browser’s speech recognition stopped (${code}). You can type, or use Hermes’s engine in Settings › Voice.`);
          },
        });
        return;
      }
      move('starting');
      const attempt = { cancelled: false };
      starting.current = attempt;
      openMic().then(
        (opened) => {
          starting.current = undefined;
          if (attempt.cancelled) {
            opened.close();
            move('idle');
            return;
          }
          mic.current = opened;
          recording.current = opened.record();
          move('listening');
          tick();
        },
        (error: unknown) => {
          starting.current = undefined;
          move('idle');
          setMode(undefined);
          setProblem(describeMicError(error, navigator.userAgent).message);
        },
      );
    },
    [release],
  );

  const cancel = useCallback(() => {
    if (starting.current) starting.current.cancelled = true;
    browser.current?.cancel();
    recording.current?.cancel();
    release();
    move('idle');
    setMode(undefined);
  }, [release]);

  const finish = useCallback(
    (send = false) => {
      // Let go while the browser was still asking: the owner has not said yet whether to listen, so it listens on until Done.
      if (live.current === 'starting') return;
      if (browser.current) {
        browser.current.finish();
        return;
      }
      const taken = recording.current;
      const kind = mode;
      if (!taken || live.current !== 'listening') return;
      move('transcribing');
      void taken.stop().then(
        async (audio) => {
          release();
          try {
            if (kind === 'message') {
              latest.current.onAudio(audio, recordingName(taken.type, new Date()));
            } else {
              const text = (await transcribe(audio, { profile: latest.current.profile })).trim();
              if (text === '') setProblem('Hermes heard no speech in that. Press the microphone and try again, or type.');
              else latest.current.onText(text, send);
            }
          } catch (error) {
            setProblem(`${words(error)} You can type instead.`);
          }
          move('idle');
          setMode(undefined);
        },
        (error: unknown) => {
          release();
          setProblem(words(error));
          move('idle');
        },
      );
    },
    [mode, release],
  );

  // Leaving the screen ends it: the microphone is given back.
  useEffect(
    () => () => {
      browser.current?.cancel();
      recording.current?.cancel();
      if (starting.current) starting.current.cancelled = true;
      mic.current?.close();
      window.clearInterval(timer.current);
    },
    [],
  );

  const support = pageMicSupport();
  return { phase, mode, seconds, interim, problem, unsupported: support.ok ? undefined : support.message, begin, finish, cancel, dismissProblem: () => setProblem(undefined) };
}
