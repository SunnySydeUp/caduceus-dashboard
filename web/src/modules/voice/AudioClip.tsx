// A recording in a message (M7 #07): the composer previews what was just recorded before it is sent, and the transcript plays a sent one back. The
// transcript's copy is read from Hermes only when it is played (a message can hold minutes of audio), through Caduceus's file guard.
import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { audioBlobAt, audioTypeOf } from './audio-attachment.ts';

/** The audio player of a recording that is in the composer. */
export function AudioPreview({ body, name }: { body: Blob; name: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    // Hermes's file types are by extension; the browser needs the blob to say it is audio, whatever the recorder called it.
    const made = URL.createObjectURL(new Blob([body], { type: audioTypeOf(name) ?? body.type }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [body, name]);
  return <audio className="voice-clip__player" controls preload="metadata" src={url} aria-label={`Preview of ${name}`} />;
}

const readDataUrl = async (route: string): Promise<string | undefined> => {
  try {
    const res = await fetch(route);
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null && 'dataUrl' in body && typeof body.dataUrl === 'string' ? body.dataUrl : undefined;
  } catch {
    return undefined;
  }
};

/** A sent recording in the transcript: a Play button that reads it back from Hermes and then plays it with the browser's own controls. */
export function AudioClip({ path, name }: { path: string; name: string }) {
  const [state, setState] = useState<{ phase: 'idle' | 'loading' | 'failed' } | { phase: 'ready'; url: string }>({ phase: 'idle' });
  useEffect(() => () => void (state.phase === 'ready' && URL.revokeObjectURL(state.url)), [state]);
  if (state.phase === 'ready') return <audio className="voice-clip__player" controls autoPlay src={state.url} aria-label={`Recording ${name}`} />;
  return (
    <button
      type="button"
      className="btn btn--secondary btn--sm voice-clip__play"
      disabled={state.phase === 'loading'}
      onClick={() => {
        setState({ phase: 'loading' });
        void audioBlobAt(path, readDataUrl).then((audio) => setState(audio ? { phase: 'ready', url: URL.createObjectURL(audio) } : { phase: 'failed' }));
      }}
    >
      <Icon name="play" small />
      {state.phase === 'loading' ? 'Loading…' : state.phase === 'failed' ? 'Not on Hermes any more' : 'Play voice message'}
    </button>
  );
}
