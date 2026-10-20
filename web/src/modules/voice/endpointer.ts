// Noticing when the owner has finished speaking (M7 #07, hands-free mode), free of the DOM and of React. The page measures the microphone's level
// a few times a second and feeds it in: speech is a stretch of loud samples, and it has ended when the level stays quiet for a moment after it.

export const ENDPOINT = {
  /** The level (0 to 1, root mean square of the signal) above which a sample counts as speech. */
  threshold: 0.02,
  /** Loud for less than this is a click or a cough, not a word. */
  minSpeechMs: 200,
  /** Quiet this long after speech ends the utterance. */
  endSilenceMs: 1400,
  /** Nobody speaking for this long: the page starts listening afresh. */
  giveUpMs: 20_000,
  /** The longest single utterance; a longer one is cut here and sent. */
  maxUtteranceMs: 60_000,
} as const;

/** `waiting`: no speech yet; `speaking`: speech has begun (and may be pausing); `ended`: the utterance is over; `nothing`: nobody spoke for a long while. */
export type EndpointVerdict = 'waiting' | 'speaking' | 'ended' | 'nothing';

export interface Endpointer {
  /** One microphone level at `at` (milliseconds on any steady clock). */
  push(level: number, at: number): EndpointVerdict;
}

/** The longest gap between two samples that counts as time spent speaking: a stalled page does not make a click into a word. */
const MAX_SAMPLE_GAP_MS = 250;

export function createEndpointer(): Endpointer {
  let first: number | undefined;
  let previous: number | undefined;
  let spokeAt: number | undefined;
  let voicedMs = 0;
  let quietSince: number | undefined;
  return {
    push(level, at) {
      first ??= at;
      const gap = previous === undefined ? 0 : Math.min(at - previous, MAX_SAMPLE_GAP_MS);
      previous = at;
      if (level >= ENDPOINT.threshold) {
        spokeAt ??= at;
        voicedMs += gap;
        quietSince = undefined;
        return at - spokeAt > ENDPOINT.maxUtteranceMs ? 'ended' : 'speaking';
      }
      if (spokeAt === undefined) return at - first > ENDPOINT.giveUpMs ? 'nothing' : 'waiting';
      quietSince ??= at;
      if (at - quietSince <= ENDPOINT.endSilenceMs) return 'speaking';
      if (voicedMs >= ENDPOINT.minSpeechMs) return 'ended';
      // It was only a click: forget it and wait for speech again.
      spokeAt = undefined;
      voicedMs = 0;
      quietSince = undefined;
      return at - first > ENDPOINT.giveUpMs ? 'nothing' : 'waiting';
    },
  };
}
