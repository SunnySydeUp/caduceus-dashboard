// The page's one reader (M7 #07): every "Read aloud", auto-read and hands-free reply goes through it, so only one reply plays at a time and one Stop
// ends it. Speech is made by Hermes's text to speech for the profile of the chat the reply is in.
import { useSyncExternalStore } from 'react';
import { unlockAudio, playBlob } from './playback.ts';
import { createReadAloud, type ReadAloudState } from './read-aloud.ts';
import { speak } from './voice-api.ts';
import { speakable, speechParts } from './speakable.ts';

let profile: string | undefined;

export const readAloud = createReadAloud({ speak: (text) => speak(text, { profile }), play: playBlob });

/** Reads a reply (Markdown) aloud, or stops it when it is the one speaking. Call it from the tap that asked: Safari lets audio start only there. */
export function readReply(key: string, markdown: string, forProfile: string | undefined): Promise<void> {
  unlockAudio();
  profile = forProfile;
  return readAloud.toggle(key, speechParts(speakable(markdown)));
}

export function useReadAloud(): ReadAloudState {
  return useSyncExternalStore(readAloud.subscribe, readAloud.state);
}
