// The composer's voice controls (M7 #07): the mic, the strip that says what it is doing, and the audio player a recorded message previews with.
// On a phone the mic is hold to talk (`hold-to-talk.ts`): hold, speak, let go to finish, slide away to cancel. A quick tap is the visible alternative:
// it listens until Done. With a mouse or the keyboard the mic is a plain toggle.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { initialPress, pressStep, type PressEvent, type PressState } from './hold-to-talk.ts';
import type { VoiceInput } from './use-voice-input.ts';
import type { VoicePrefs } from './voice-prefs.ts';
import './voice.css';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The mic button. */
export function MicButton({ input, prefs, disabled, onPress }: { input: VoiceInput; prefs: VoicePrefs; disabled: boolean; onPress(state: PressState): void }) {
  const [press, setPress] = useState<PressState>(initialPress);
  const pressing = useRef<PressState>(initialPress);
  const touched = useRef(false);
  const active = input.phase === 'starting' || input.phase === 'listening';
  // However the recording ended (Done, Cancel, an error), the gesture starts over.
  useEffect(() => {
    if (input.phase === 'idle') {
      pressing.current = initialPress;
      setPress(initialPress);
      onPress(initialPress);
    }
    // `onPress` is a state setter of the composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.phase]);
  const feed = (event: PressEvent) => {
    const wasHold = pressing.current.phase === 'pressing';
    const step = pressStep(pressing.current, event);
    pressing.current = step.state;
    setPress(step.state);
    onPress(step.state);
    if (step.effect === 'start') input.begin('dictate');
    else if (step.effect === 'finish') input.finish(wasHold && prefs.holdSends);
    else if (step.effect === 'cancel') input.cancel();
  };
  const touch = (event: PointerEvent) => event.pointerType === 'touch';
  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon voice-mic"
      data-active={active ? '' : undefined}
      data-away={press.away ? '' : undefined}
      aria-label={active ? 'Stop dictation' : 'Dictate'}
      aria-pressed={active}
      title={active ? 'Stop dictation' : 'Dictate: hold to talk on a phone, or tap'}
      disabled={disabled || input.phase === 'transcribing' || !!input.unsupported}
      onPointerDown={(event) => {
        if (!touch(event)) return;
        touched.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        feed({ type: 'down', x: event.clientX, y: event.clientY, at: event.timeStamp });
      }}
      onPointerMove={(event) => touch(event) && feed({ type: 'move', x: event.clientX, y: event.clientY })}
      onPointerUp={(event) => touch(event) && feed({ type: 'up', x: event.clientX, y: event.clientY, at: event.timeStamp })}
      onPointerCancel={(event) => touch(event) && feed({ type: 'abort' })}
      // A press and hold would open the system's context menu over the button.
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        // A touch has been handled as a press; the click that follows it is the same tap.
        if (touched.current) {
          touched.current = false;
          return;
        }
        if (active) input.finish(false);
        else input.begin('dictate');
      }}
    >
      <Icon name="mic" />
    </button>
  );
}

/** Says what the microphone is doing, and always offers Done and Cancel (the alternatives to the gesture). */
export function VoiceStrip({ input, press }: { input: VoiceInput; press: PressState }) {
  const { phase, mode, seconds, interim, problem } = input;
  if (phase === 'idle' && problem === undefined) return null;
  if (phase === 'idle') {
    return (
      <p className="voice-note voice-note--problem" role="alert">
        <Icon name="info" small />
        <span>{problem}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={input.dismissProblem}>
          Dismiss
        </button>
      </p>
    );
  }
  const message = mode === 'message';
  return (
    <div className="voice-strip" role="status" data-phase={phase}>
      <span className="voice-strip__dot" aria-hidden="true" />
      <span className="voice-strip__text">
        {phase === 'starting' && 'Waiting for the microphone…'}
        {phase === 'listening' && (
          <>
            <span>
              {message ? 'Recording a voice message' : <Term id="dictation">Dictating</Term>} · {clock(seconds)}
            </span>
            <small>{press.phase === 'pressing' ? (press.away ? 'Let go to cancel.' : 'Let go to finish. Slide away to cancel.') : message ? 'Tap Stop to keep it.' : 'Tap Done when you have finished.'}</small>
            {interim !== '' && <small className="voice-strip__heard">{interim}</small>}
          </>
        )}
        {phase === 'transcribing' && 'Hermes is transcribing…'}
      </span>
      {phase !== 'transcribing' && (
        <>
          <button type="button" className="btn btn--primary btn--sm" disabled={phase === 'starting'} onClick={() => input.finish(false)}>
            {message ? 'Stop' : 'Done'}
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={input.cancel}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
