// What a new worktree session hands to the chat that opens next: the folder it works in (M1 #17). Hermes makes a session only when the first message is sent, so the
// worktree's folder waits here for the new chat of the profile it was for, which starts there. Held in memory only, and taken once. A new chat that is already open
// (the owner made the worktree from it) is told when an offer arrives, because it will not open again.

let pending: { profile: string; cwd: string } | undefined;
const listeners = new Set<() => void>();

/** Leaves a workspace for the next new chat of `profile`, and tells the new chats that are open. A later offer replaces one that no chat took. */
export function offerWorkspace(profile: string, cwd: string): void {
  pending = { profile, cwd };
  for (const listener of [...listeners]) listener();
}

/** Takes the workspace waiting for `profile`'s new chat, once; `undefined` when there is none or it was for another profile. */
export function takeWorkspace(profile: string): string | undefined {
  if (pending?.profile !== profile) return undefined;
  const { cwd } = pending;
  pending = undefined;
  return cwd;
}

/** Calls `listener` whenever a workspace is offered; returns the way to stop. */
export function onWorkspaceOffered(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
