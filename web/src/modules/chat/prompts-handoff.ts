// The palette's "Saved prompts" command (M1 #11) asks the composer to open the library. A composer that is open takes the request at once; with none open
// (the owner is on another screen), a new chat is opened and its composer takes it when it appears. Held in memory only, and taken once.

let pending = false;
const listeners = new Set<() => void>();

/** Asks for the library. `openChat` brings a composer up when none is listening. */
export function requestPromptLibrary(openChat: () => void): void {
  if (listeners.size > 0) listeners.forEach((open) => open());
  else {
    pending = true;
    openChat();
  }
}

/** A composer says it wants to hear of requests, and hears of one made before it was there. Returns how to stop. */
export function onPromptLibraryRequest(open: () => void): () => void {
  listeners.add(open);
  if (pending) {
    pending = false;
    queueMicrotask(open);
  }
  return () => void listeners.delete(open);
}
