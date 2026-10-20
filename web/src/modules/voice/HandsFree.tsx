// The hands-free panel (M7 #07): it says plainly whether Caduceus is listening, transcribing, waiting for Hermes or speaking, shows what it heard,
// and keeps Stop on screen the whole time. It sits above the composer; leaving the screen ends the conversation.
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import type { HandsFreePhase } from './hands-free.ts';
import { handsFree, useHandsFree } from './hands-free-session.ts';

const WORDS: Record<HandsFreePhase, { title: string; hint: string }> = {
  starting: { title: 'Starting…', hint: 'Waiting for the microphone.' },
  listening: { title: 'Listening', hint: 'Speak. When you pause, Hermes gets what you said.' },
  transcribing: { title: 'Transcribing', hint: 'Hermes is turning what you said into words.' },
  thinking: { title: 'Hermes is answering', hint: 'The reply will be read to you.' },
  speaking: { title: 'Speaking', hint: 'Skip it, or just wait: it listens again afterwards.' },
  stopped: { title: 'Stopped', hint: '' },
};

export function HandsFreePanel() {
  const hands = useHandsFree();
  const { title, hint } = WORDS[hands.state.phase];
  return (
    <section className="handsfree" aria-label="Hands-free conversation" data-phase={hands.state.phase}>
      <div className="handsfree__state" role="status" aria-live="polite">
        <span className="handsfree__icon" aria-hidden="true">
          <Icon name={hands.state.phase === 'speaking' ? 'speaker' : hands.state.phase === 'listening' ? 'mic' : 'wave'} />
        </span>
        <span className="handsfree__text">
          <strong>
            <Term id="hands-free">Hands-free</Term>: {title}
          </strong>
          <small>{hint}</small>
        </span>
        {hands.state.phase === 'listening' && <meter className="handsfree__level" min={0} max={0.3} value={hands.level} aria-label="Microphone level" />}
      </div>
      {hands.heard !== '' && <p className="handsfree__heard">You said: {hands.heard}</p>}
      <div className="handsfree__actions">
        {hands.state.phase === 'speaking' && (
          <button type="button" className="btn btn--secondary" onClick={() => handsFree.skip()}>
            Skip reply
          </button>
        )}
        <button type="button" className="btn btn--danger handsfree__stop" onClick={() => handsFree.stop()}>
          <Icon name="stop" />
          Stop
        </button>
      </div>
    </section>
  );
}
