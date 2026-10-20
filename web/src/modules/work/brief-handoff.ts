// What another screen hands to the Brief editor: a brief to start from (Chat's "Make this a task"). It is held in memory only (a chat can hold
// anything the owner pasted: it belongs in no address and in no storage) and is taken once, by the editor that opens next.

/** The text a new Brief starts with. Each part is Markdown (or empty) and goes into the section of its name. */
export interface BriefPrefill {
  title: string;
  goal: string;
  context: string;
  /** Where it came from, as the References section lists it: a link to the chat session, for instance. */
  references: string;
}

let pending: BriefPrefill | undefined;

/** Leaves a brief for the next new-task editor to start from. A later offer replaces an earlier one that no editor took. */
export function offerBrief(prefill: BriefPrefill): void {
  pending = prefill;
}

/** Takes the brief waiting for the editor, once; `undefined` when there is none. */
export function takeBrief(): BriefPrefill | undefined {
  const taken = pending;
  pending = undefined;
  return taken;
}
