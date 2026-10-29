// What Repeat left in the message box (talk audit #2). Repeat opens the schedule builder with the words and, by design, leaves them in the box. Someone who
// cancels the builder and comes back finds the words again and may type on at the caret, so that the two runs of words merge. The chat remembers which words
// Repeat took (in memory only: a message can hold anything the owner typed), so that the box can say they are still there and offer to clear them.

let handed: { session: string; text: string } | undefined;

/** Repeat took `text` from the box of `session` to the schedule builder. */
export function rememberRepeat(session: string, text: string): void {
  handed = { session, text: text.trim() };
}

/** The box of `session` still holds, and only holds, the words Repeat took. */
export function repeatLeftover(session: string, text: string): boolean {
  return handed !== undefined && handed.session === session && handed.text !== '' && text.trim() === handed.text;
}

/** The words were sent, cleared or changed: the box no longer has a Repeat leftover to point out. */
export function forgetRepeat(): void {
  handed = undefined;
}
