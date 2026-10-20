import { describe, expect, test } from 'vitest';
import { createEndpointer, ENDPOINT, type EndpointVerdict } from '../src/modules/voice/endpointer.ts';
import { handsFreeStart, handsFreeStep, type HandsFreeEvent, type HandsFreeEffect, type HandsFreeState } from '../src/modules/voice/hands-free.ts';

// Hands-free mode (M7 #07): the page listens, notices when the owner has finished speaking, has Hermes transcribe it, sends it as a message, reads
// the reply aloud and listens again, until Stop or until the screen is left. Both halves are pure; the page feeds them microphone levels and events.
const LOUD = 0.3;
const QUIET = 0.001;

function listen(levels: [number, number][]): EndpointVerdict[] {
  const endpointer = createEndpointer();
  return levels.map(([level, at]) => endpointer.push(level, at));
}

describe('noticing the end of speech', () => {
  test('silence before anyone speaks is just waiting', () => {
    expect(listen([[QUIET, 0], [QUIET, 1000], [QUIET, 5000]])).toEqual(['waiting', 'waiting', 'waiting']);
  });

  test('speech, then a pause as long as an ordinary breath of thinking, ends the utterance', () => {
    const verdicts = listen([
      [LOUD, 0],
      [LOUD, 400],
      [QUIET, 600],
      [QUIET, 600 + ENDPOINT.endSilenceMs - 1],
      [QUIET, 600 + ENDPOINT.endSilenceMs + 1],
    ]);
    expect(verdicts).toEqual(['speaking', 'speaking', 'speaking', 'speaking', 'ended']);
  });

  test('speaking again inside the pause carries on the same utterance', () => {
    expect(listen([[LOUD, 0], [QUIET, 500], [LOUD, 1000], [QUIET, 1100], [QUIET, 1100 + ENDPOINT.endSilenceMs + 5]]).at(-1)).toBe('ended');
    expect(listen([[LOUD, 0], [QUIET, 500], [LOUD, 1500], [QUIET, 1600], [QUIET, 2000]]).at(-1)).toBe('speaking');
  });

  test('a click shorter than a word is not speech', () => {
    expect(listen([[LOUD, 0], [QUIET, 60], [QUIET, 60 + ENDPOINT.endSilenceMs + 10]]).at(-1)).not.toBe('ended');
  });

  test('nobody speaking for a long while is given up on, so the page can listen afresh', () => {
    expect(listen([[QUIET, 0], [QUIET, ENDPOINT.giveUpMs + 1]]).at(-1)).toBe('nothing');
  });

  test('a monologue is cut at the longest utterance', () => {
    expect(listen([[LOUD, 0], [LOUD, ENDPOINT.maxUtteranceMs + 1]]).at(-1)).toBe('ended');
  });
});

function drive(events: HandsFreeEvent[], from: HandsFreeState = handsFreeStart): { state: HandsFreeState; effects: HandsFreeEffect[] } {
  let state = from;
  const effects: HandsFreeEffect[] = [];
  for (const event of events) {
    const step = handsFreeStep(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

describe('the conversation', () => {
  test('it begins by getting the microphone, then listens', () => {
    expect(handsFreeStart.phase).toBe('starting');
    const { state, effects } = drive([{ type: 'listening' }]);
    expect(state.phase).toBe('listening');
    expect(effects).toEqual([]);
  });

  test('a turn: heard, transcribed, sent, answered, spoken, listening again', () => {
    const { state, effects } = drive([
      { type: 'listening' },
      { type: 'utterance' },
      { type: 'transcript', text: ' What is in the build folder? ' },
      { type: 'reply', text: 'Three files.' },
      { type: 'spoken' },
    ]);
    expect(effects).toEqual([{ do: 'transcribe' }, { do: 'send', text: 'What is in the build folder?' }, { do: 'speak', text: 'Three files.' }, { do: 'listen' }]);
    expect(state).toMatchObject({ phase: 'listening', turns: 1 });
  });

  test('the states show what is happening', () => {
    const phases = [
      { type: 'listening' },
      { type: 'utterance' },
      { type: 'transcript', text: 'hi' },
      { type: 'reply', text: 'hello' },
    ].map((event, index, all) => drive(all.slice(0, index + 1) as HandsFreeEvent[]).state.phase);
    expect(phases).toEqual(['listening', 'transcribing', 'thinking', 'speaking']);
  });

  test('an empty transcript is silence: listen again, send nothing', () => {
    const { state, effects } = drive([{ type: 'listening' }, { type: 'utterance' }, { type: 'transcript', text: '   ' }]);
    expect(effects).toEqual([{ do: 'transcribe' }, { do: 'listen' }]);
    expect(state.phase).toBe('listening');
  });

  test('a long wait with no speech listens afresh', () => {
    expect(drive([{ type: 'listening' }, { type: 'nothing' }]).effects).toEqual([{ do: 'listen' }]);
  });

  test('a reply with nothing to read goes straight back to listening', () => {
    expect(drive([{ type: 'listening' }, { type: 'utterance' }, { type: 'transcript', text: 'hi' }, { type: 'reply', text: '   ' }]).effects.at(-1)).toEqual({ do: 'listen' });
  });

  test('Stop ends it from any state, closing the microphone and the speech', () => {
    for (const events of [[], [{ type: 'listening' }], [{ type: 'listening' }, { type: 'utterance' }], [{ type: 'listening' }, { type: 'utterance' }, { type: 'transcript', text: 'hi' }, { type: 'reply', text: 'hello' }]] as HandsFreeEvent[][]) {
      const { state, effects } = drive([...events, { type: 'stop' }]);
      expect(state.phase).toBe('stopped');
      expect(effects.at(-1)).toEqual({ do: 'close' });
    }
  });

  test('once stopped nothing more happens, whatever arrives late', () => {
    const stopped = drive([{ type: 'listening' }, { type: 'stop' }]);
    const late = drive([{ type: 'transcript', text: 'hi' }, { type: 'reply', text: 'hello' }, { type: 'spoken' }, { type: 'listening' }], stopped.state);
    expect(late.state).toEqual(stopped.state);
    expect(late.effects).toEqual([]);
  });

  test('a failure ends it and says why', () => {
    const { state, effects } = drive([{ type: 'listening' }, { type: 'utterance' }, { type: 'failed', message: 'Hermes could not transcribe that' }]);
    expect(state).toMatchObject({ phase: 'stopped', error: 'Hermes could not transcribe that' });
    expect(effects.at(-1)).toEqual({ do: 'close' });
  });
});
