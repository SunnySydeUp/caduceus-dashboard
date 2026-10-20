// What Agents › Memory › Hindsight and Notes send through the Caduceus server, each through `fetchTiered` with the tier the policy map gives it: recall, reflect, search and
// preview are reads (T0, no dialog), adding a memory is a T1, marking a notes source a T0, and approving the command of an stdio source a T3 (its name typed). The caller
// shows what came back; this says what happened. Nothing a question or a note said is kept anywhere.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { approveRequest, markRequest, parsePreview, parseRecall, parseReflect, parseSearch, previewNoteRequest, recallRequest, reflectRequest, retainRequest, searchNotesRequest, type Question, type Reflection, type RecallHit } from './hindsight-model.ts';
import type { NotePreview, NotesSearchAnswer } from '@caduceus/contracts/hindsight-api';

/** Asks Hindsight what it remembers about a question (a read). */
export async function recall(bank: string, profile: string, question: Question): Promise<ActionOutcome<RecallHit[]>> {
  const outcome = await runTiered(fetchTiered(recallRequest(bank, profile, question)));
  return outcome.kind === 'done' ? { kind: 'done', body: parseRecall(outcome.body) } : outcome;
}

/** Asks Hindsight to answer a question from the bank (a read: it may take half a minute, as Hindsight asks a language model). */
export async function reflect(bank: string, profile: string, question: Question): Promise<ActionOutcome<Reflection>> {
  const outcome = await runTiered(fetchTiered(reflectRequest(bank, profile, question)));
  return outcome.kind === 'done' ? { kind: 'done', body: parseReflect(outcome.body) } : outcome;
}

/** Adds a memory to a bank (T1). */
export function addMemory(bank: string, profile: string, content: string, tags: readonly string[]): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...retainRequest(bank, profile, content, tags),
      confirm: {
        title: `Add this memory to ${bank}?`,
        text: 'Hindsight keeps it in the bank, extracts facts from it in the background and recalls it in later sessions. A memory is not an edit you can take back here: Hindsight has no undo for it in this screen.',
        object: bank,
        profile,
        confirmLabel: 'Add memory',
        recoverability: { undoable: false, note: 'Remove it in Hindsight itself.' },
      },
    }),
  );
}

/** Marks a server as a notes source, or stops (T0: Caduceus’s own preference). */
export function markSource(server: string, profile: string, source: boolean): Promise<ActionOutcome> {
  return runTiered(fetchTiered(markRequest(server, profile, source)));
}

/** Approves running the command of an stdio server (T3: the server’s name typed). */
export function approveSource(server: string, profile: string, command: string | undefined): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...approveRequest(server, profile),
      confirm: {
        title: `Let Caduceus run ${server}?`,
        text: `To search these notes Caduceus starts this command on the computer that runs it, each time you search or open a note, and only calls the server’s read and search tools: ${command ?? server}. It asks again if the command in Hermes’s settings changes.`,
        object: server,
        profile,
        confirmLabel: 'Approve command',
        recoverability: { undoable: true, note: 'Stop using the server as a notes source to take the approval back.' },
      },
    }),
  );
}

/** Searches a notes source (a read). */
export async function searchNotes(server: string, profile: string, query: string): Promise<ActionOutcome<NotesSearchAnswer>> {
  const outcome = await runTiered(fetchTiered(searchNotesRequest(server, profile, query)));
  return outcome.kind === 'done' ? { kind: 'done', body: parseSearch(outcome.body) } : outcome;
}

/** Opens one note of a notes source (a read). */
export async function previewNote(server: string, profile: string, ref: string): Promise<ActionOutcome<NotePreview>> {
  const outcome = await runTiered(fetchTiered(previewNoteRequest(server, profile, ref)));
  return outcome.kind === 'done' ? { kind: 'done', body: parsePreview(outcome.body) } : outcome;
}

/** Says the address Hermes now names for Hindsight is right, so the key is used with it again (T3: the new address typed). */
export function trustAddress(profile: string, from: string, to: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: `/_caduceus/api/hindsight/key-address?profile=${encodeURIComponent(profile)}`,
      body: { to },
      confirm: {
        title: 'Use your Hindsight key with the new address?',
        text: `Hermes first used the Hindsight key of ${profile} with ${from}. Its setting now says ${to}. Only do this if you changed the address yourself: the key is then sent to ${to}.`,
        object: to,
        profile,
        confirmLabel: 'Use my key with it',
        recoverability: { undoable: false, note: 'Change the address back in Hermes and the key stays with the new address; rotate the key in Hindsight if you sent it somewhere wrong.' },
      },
    }),
  );
}
