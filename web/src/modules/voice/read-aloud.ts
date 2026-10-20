// Reading a reply aloud (M7 #07), free of the DOM and of React: one reply is fetched as speech and played at a time, and asking for another (or for
// the same one again) stops the one in hand. The page supplies how speech is made (`speak`: Hermes's text to speech) and how it is played.

/** Audio that is playing: it ends by itself, or when it is stopped. */
export interface Playback {
  ended: Promise<void>;
  stop(): void;
}

export interface ReadAloudDeps {
  speak(text: string): Promise<Blob>;
  play(audio: Blob): Playback;
}

export interface ReadAloudState {
  phase: 'idle' | 'loading' | 'playing';
  /** Which reply is loading or playing. */
  key?: string;
  /** Why the last reply could not be spoken, until the next one starts. */
  error?: string;
}

export interface ReadAloud {
  state(): ReadAloudState;
  subscribe(listener: () => void): () => void;
  /** Reads the reply aloud (a long one in parts, each made while the one before plays); for the one that is loading or playing already, stops it. Resolves when that reading is over. */
  toggle(key: string, text: string | readonly string[]): Promise<void>;
  /** Stops whatever is loading or playing. */
  stop(): void;
}

export function createReadAloud({ speak, play }: ReadAloudDeps): ReadAloud {
  let state: ReadAloudState = { phase: 'idle' };
  let current: { key: string; stop(): void } | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: ReadAloudState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const reader: ReadAloud = {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stop() {
      const stopping = current;
      current = undefined;
      stopping?.stop();
      if (state.phase !== 'idle') publish({ phase: 'idle' });
    },
    async toggle(key, text) {
      if (current?.key === key) {
        reader.stop();
        return;
      }
      reader.stop();
      let cancelled = false;
      let playback: Playback | undefined;
      const stopped = Promise.withResolvers<undefined>();
      const mine = {
        key,
        stop() {
          cancelled = true;
          playback?.stop();
          stopped.resolve(undefined);
        },
      };
      current = mine;
      publish({ phase: 'loading', key });
      const parts = typeof text === 'string' ? [text] : text;
      try {
        let making: Promise<Blob> | undefined = speak(parts[0] ?? '');
        for (const [index] of parts.entries()) {
          // The next part is asked for as this one starts to play; if it fails, that is told when its turn comes.
          const following: Promise<Blob> | undefined = index + 1 < parts.length ? speak(parts[index + 1]!) : undefined;
          following?.catch(() => undefined);
          // A stop while the speech is still being made ends this reading at once; the speech that arrives later is dropped.
          const audio = await Promise.race([making, stopped.promise]);
          if (cancelled || audio === undefined) return;
          playback = play(audio);
          publish({ phase: 'playing', key });
          await playback.ended;
          if (cancelled) return;
          making = following;
        }
      } catch (error) {
        if (cancelled) return;
        current = undefined;
        publish({ phase: 'idle', error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (current === mine) {
        current = undefined;
        publish({ phase: 'idle' });
      }
    },
  };
  return reader;
}
