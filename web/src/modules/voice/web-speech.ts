// The browser's own speech to text, the Web Speech API (M7 #07), where it has one: Chrome, Edge and Safari do, Firefox does not. Some browsers send
// the audio to their maker's service to do it, which is why Settings › Voice says so and defaults to Hermes's engine. The page asks for the
// microphone through the recognizer itself, the first time it is started.

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    const found: unknown = Reflect.get(window, name);
    // The Web Speech API's constructor, which the DOM typings of this build do not declare.
    if (typeof found === 'function') return found as RecognitionConstructor;
  }
  return undefined;
}

/** Whether this browser has a speech to text of its own. */
export const hasBrowserRecognition = (): boolean => recognitionConstructor() !== undefined;

export interface BrowserDictation {
  /** Stops listening; what was heard so far is final and `onEnd` follows. */
  finish(): void;
  /** Stops and drops what was heard. */
  cancel(): void;
}

export interface DictationHandlers {
  /** The words heard so far, final or not, as they change. */
  onText(text: string): void;
  /** Listening is over, with all the words that were heard (empty when none were). */
  onEnd(text: string): void;
  /** The browser's reason (`not-allowed`, `no-speech`, `network`…) for ending without words. */
  onError(code: string): void;
}

export function startBrowserDictation(language: string, handlers: DictationHandlers): BrowserDictation {
  const Constructor = recognitionConstructor();
  if (!Constructor) throw new Error('This browser has no speech recognition.');
  const recognition = new Constructor();
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;
  let heard = '';
  let dropped = false;
  recognition.onresult = (event) => {
    let text = '';
    for (let index = 0; index < event.results.length; index++) text += event.results[index]![0].transcript;
    heard = text.trim();
    handlers.onText(heard);
  };
  recognition.onerror = (event) => {
    // Hearing nothing is the owner saying nothing, not a failure.
    if (event.error !== 'no-speech' && event.error !== 'aborted') handlers.onError(event.error);
  };
  recognition.onend = () => handlers.onEnd(dropped ? '' : heard);
  recognition.start();
  return {
    finish: () => recognition.stop(),
    cancel() {
      dropped = true;
      recognition.abort();
    },
  };
}
