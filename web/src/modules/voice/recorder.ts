// The microphone and the recorder (M7 #07), the browser's side: `getUserMedia` (which is what makes the browser ask for permission, so it is called on
// the first press of the mic and never before), a `MediaRecorder` for each recording and a level meter for hands-free mode. What a refusal means is
// `mic.ts`; this only does it.
import { micSupport, type MicSupport } from './mic.ts';

/** What this page can do about the microphone right now. */
export function pageMicSupport(): MicSupport {
  return micSupport({ secure: typeof window !== 'undefined' && window.isSecureContext, hasMediaDevices: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia, hasRecorder: typeof MediaRecorder !== 'undefined' });
}

/** The types of recording the browser might make, best first: Chrome and Firefox make Opus in WebM or Ogg, Safari makes MP4. */
const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export interface Recording {
  /** The type of audio being recorded (a `MediaRecorder` type, without the codec when the browser does not say). */
  readonly type: string;
  /** Ends the recording and gives what was said. */
  stop(): Promise<Blob>;
  /** Ends it and drops it. */
  cancel(): void;
}

export interface Mic {
  /** How loud the microphone is now, 0 to 1 (the root mean square of the last few milliseconds). */
  level(): number;
  /** Starts recording; the microphone stays open for the next one. */
  record(): Recording;
  /** Gives the microphone back: the browser's recording indicator goes out. */
  close(): void;
}

/** Opens the microphone. Rejects with the browser's own error (`NotAllowedError` when the owner says no), which `describeMicError` words. */
export async function openMic(): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const type = PREFERRED_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return {
    level() {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      return Math.sqrt(sum / samples.length);
    },
    record() {
      const recorder = new MediaRecorder(stream, type === undefined ? undefined : { mimeType: type });
      const chunks: Blob[] = [];
      const ended = Promise.withResolvers<Blob>();
      recorder.addEventListener('dataavailable', (event) => event.data.size > 0 && chunks.push(event.data));
      recorder.addEventListener('stop', () => ended.resolve(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' })));
      recorder.start();
      return {
        type: recorder.mimeType || type || 'audio/webm',
        stop() {
          if (recorder.state !== 'inactive') recorder.stop();
          return ended.promise;
        },
        cancel() {
          if (recorder.state !== 'inactive') recorder.stop();
        },
      };
    },
    close() {
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}
