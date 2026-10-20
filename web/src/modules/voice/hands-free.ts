// Hands-free mode (M7 #07), free of the DOM and of React: the conversation as a state machine. The page gives it what happened (the microphone is
// ready, an utterance ended, Hermes transcribed it, the reply is in, it has been spoken) and does what it asks (listen, transcribe, send, speak,
// close the microphone). It is chained speech: Hermes's speech to text, the chat, and Hermes's text to speech. Stop ends it from any state.

export type HandsFreePhase = 'starting' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'stopped';

export interface HandsFreeState {
  phase: HandsFreePhase;
  /** How many of the owner's turns have been sent. */
  turns: number;
  /** Why it stopped, when it stopped because something failed. */
  error?: string;
}

export type HandsFreeEvent =
  | { type: 'listening' }
  | { type: 'utterance' }
  | { type: 'nothing' }
  | { type: 'transcript'; text: string }
  | { type: 'reply'; text: string }
  | { type: 'spoken' }
  | { type: 'failed'; message: string }
  | { type: 'stop' };

export type HandsFreeEffect = { do: 'listen' } | { do: 'transcribe' } | { do: 'send'; text: string } | { do: 'speak'; text: string } | { do: 'close' };

export const handsFreeStart: HandsFreeState = { phase: 'starting', turns: 0 };

interface Step {
  state: HandsFreeState;
  effects: HandsFreeEffect[];
}

export function handsFreeStep(state: HandsFreeState, event: HandsFreeEvent): Step {
  if (state.phase === 'stopped') return { state, effects: [] };
  const to = (phase: HandsFreePhase, effects: HandsFreeEffect[] = [], turns = state.turns): Step => ({ state: { phase, turns }, effects });
  switch (event.type) {
    case 'stop':
      return to('stopped', [{ do: 'close' }]);
    case 'failed':
      return { state: { phase: 'stopped', turns: state.turns, error: event.message }, effects: [{ do: 'close' }] };
    case 'listening':
      return state.phase === 'starting' ? to('listening') : { state, effects: [] };
    case 'nothing':
      return state.phase === 'listening' ? to('listening', [{ do: 'listen' }]) : { state, effects: [] };
    case 'utterance':
      return state.phase === 'listening' ? to('transcribing', [{ do: 'transcribe' }]) : { state, effects: [] };
    case 'transcript': {
      if (state.phase !== 'transcribing') return { state, effects: [] };
      const text = event.text.trim();
      return text === '' ? to('listening', [{ do: 'listen' }]) : to('thinking', [{ do: 'send', text }], state.turns + 1);
    }
    case 'reply': {
      if (state.phase !== 'thinking') return { state, effects: [] };
      const text = event.text.trim();
      return text === '' ? to('listening', [{ do: 'listen' }]) : to('speaking', [{ do: 'speak', text }]);
    }
    case 'spoken':
      return state.phase === 'speaking' ? to('listening', [{ do: 'listen' }]) : { state, effects: [] };
  }
}
