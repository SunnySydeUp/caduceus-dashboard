// Playing audio (M7 #07), the browser's side. Safari on iPhone lets a page start audio only from inside a tap, and the speech arrives from Hermes some time
// after the tap, so the page keeps one `HTMLAudioElement` and starts it silently inside the tap (`unlockAudio`); every reply then plays through that
// element. The rule that only one reply plays at a time is `read-aloud.ts`'s.
import type { Playback } from './read-aloud.ts';

/** A WAV of no length: playing it inside a tap is what lets the element play later. */
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

let shared: HTMLAudioElement | undefined;

/** Call it from inside the tap that asks for speech (a click handler, not a promise callback). */
export function unlockAudio(): void {
  shared ??= new Audio();
  if (!shared.paused || shared.src !== '') return;
  shared.src = SILENCE;
  void shared.play().catch(() => undefined);
}

export function playBlob(audio: Blob): Playback {
  const element = (shared ??= new Audio());
  const url = URL.createObjectURL(audio);
  const ended = Promise.withResolvers<void>();
  const release = () => {
    element.onended = null;
    element.onerror = null;
    URL.revokeObjectURL(url);
  };
  element.onended = () => {
    release();
    ended.resolve();
  };
  element.onerror = () => {
    release();
    ended.reject(new Error('The browser could not play that audio.'));
  };
  element.src = url;
  void element.play().catch((error: unknown) => {
    release();
    ended.reject(error instanceof Error ? error : new Error('The browser did not let the page play audio.'));
  });
  return {
    ended: ended.promise,
    stop() {
      element.pause();
      release();
      ended.resolve();
    },
  };
}
