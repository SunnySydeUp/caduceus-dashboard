// What Agents › Skills › Learn hands to Chat: the topic of a `/learn` that the new chat which opens next starts with. It is held in memory
// only (a topic can be pasted notes: it belongs in no address and in no storage) and is taken once, by the chat of the profile it was for.

let pending: { profile: string; topic: string } | undefined;

/** Leaves a topic for the next new chat of `profile` to learn. A later request replaces an earlier one that no chat took. */
export function requestLearn(profile: string, topic: string): void {
  pending = { profile, topic };
}

/** Takes the topic waiting for `profile`'s new chat, once; `undefined` when there is none or it was for another profile. */
export function takeLearn(profile: string): string | undefined {
  if (pending?.profile !== profile) return undefined;
  const { topic } = pending;
  pending = undefined;
  return topic;
}
