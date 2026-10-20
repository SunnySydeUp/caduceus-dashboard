// What a fork from one of the owner's own messages hands to the chat it opens: the words of the message, to edit and send from there (M1 #12).
// Held in memory only (the words are the owner's draft, not Hermes's, and belong in no address) and taken once, by the chat it was for.

let pending: { storedId: string; text: string } | undefined;

/** Leaves `text` for the composer of the chat `storedId` that opens next. A later offer replaces one that no chat took. */
export function offerPrefill(storedId: string, text: string): void {
  pending = { storedId, text };
}

/** Takes the words waiting for `storedId`'s chat, once; `undefined` when there are none or they were for another chat. */
export function takePrefill(storedId: string | undefined): string | undefined {
  if (storedId === undefined || pending?.storedId !== storedId) return undefined;
  const { text } = pending;
  pending = undefined;
  return text;
}
