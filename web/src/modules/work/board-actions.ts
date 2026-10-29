// What Work › Board changes in Hermes, each through `fetchTiered` with the tier the policy map gives it, and how each ends for the owner: a card's
// change is a T0 with a 6 s undo toast; a bulk change is a T2; boards, the nudge and Reclaim are T1; the dispatcher's settings are a T2 and an
// import a T3. The requests are `board-ops.ts`'s (a server test sends the same ones to the real Hermes). Caduceus keeps nothing of what it sends.
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { toast } from '../../shell/toasts.ts';
import { fetchTiered } from '../../tiered.ts';
import type { Confirmation } from '../../tiered-fetch.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import {
  PRIORITY_CHOICES,
  boardRequests,
  bulkRequest,
  cardChangeRequest,
  dispatchRequest,
  readBulk,
  readDispatch,
  readExport,
  settingsRequest,
  undoOf,
  type BulkResult,
  type CardChange,
  type DispatchReport,
  type SettingsChange,
} from './board-ops.ts';
import { STATUS_META, priorityLabel, type BoardTask } from './board-model.ts';
import { requests, type Plain } from './task-requests.ts';

const send = <Body = unknown>(request: Plain, confirm?: Confirmation, alreadyConfirmed = false) => runTiered<Body>(fetchTiered({ ...request, confirm, alreadyConfirmed }));

/** How a status is said in a sentence. */
const statusWord = (status: CardChange & { kind: 'move' }) => (status.to === 'archived' ? 'Archived' : STATUS_META[status.to].label);

/** What a change did, in words: the toast's message. `title` is the card's. */
export function describeChange(title: string, change: CardChange): string {
  if (change.kind === 'move') return change.to === 'archived' ? `Archived “${title}”.` : `Moved “${title}” to ${statusWord(change)}.`;
  if (change.kind === 'assign') return change.to === null ? `Took “${title}” off its profile.` : `Gave “${title}” to ${change.to}.`;
  const label = PRIORITY_CHOICES.find((choice) => choice.value === change.to)?.label ?? priorityLabel(change.to) ?? 'Normal';
  return `“${title}” is now ${label.toLowerCase()} priority${change.to === 0 || PRIORITY_CHOICES.some((choice) => choice.value === change.to) ? '' : ` (${change.to})`}.`;
}

/**
 * One card's change (a T0: no dialog). It is told with a toast, and the toast holds a 6 s Undo that puts the previous value back in Hermes, when Hermes
 * can take it back (a done task that was archived cannot come back as done). The board changes when Hermes says so, through the events.
 */
export async function changeCard(task: BoardTask, change: CardChange, slug?: string): Promise<void> {
  // Archiving takes the task off the board, so it is confirmed first (the other moves are shown on the board and undone at once).
  if (change.kind === 'move' && change.to === 'archived') {
    const ok = await confirmTier({ tier: 'T1', moduleId: 'hermes', action: 'kanban.task-archive', label: `Archive “${task.title}”?`, text: undoOf(task, change) === undefined ? 'It leaves the board. Hermes cannot put it back.' : 'It leaves the board. You can undo it for a few seconds.', object: task.id, profile: task.assignee ?? undefined, confirmLabel: 'Archive' });
    if (!ok) return;
  }
  const outcome = await send(cardChangeRequest(task.id, change, slug));
  if (outcome.kind === 'cancelled') return;
  if (outcome.kind === 'failed') {
    toast(outcome.message, { tone: 'danger' });
    return;
  }
  const back = undoOf(task, change);
  toast(describeChange(task.title, change), {
    ...(back === undefined
      ? { detail: 'Hermes cannot put this back.' }
      : {
          undo: () =>
            void send(cardChangeRequest(task.id, back, slug)).then((restored) => {
              if (restored.kind === 'failed') toast(restored.message, { tone: 'danger' });
              else if (restored.kind === 'done') toast(`Put “${task.title}” back.`);
            }),
        }),
  });
}

/** The words of a bulk change for its confirmation. */
function bulkWords(change: CardChange, n: number): { title: string; confirmLabel: string } {
  const noun = `${n} ${n === 1 ? 'task' : 'tasks'}`;
  if (change.kind === 'move') return change.to === 'archived' ? { title: `Archive ${noun}?`, confirmLabel: `Archive ${noun}` } : { title: `Move ${noun} to ${statusWord(change)}?`, confirmLabel: `Move ${noun}` };
  if (change.kind === 'assign') return { title: change.to === null ? `Take ${noun} off their profiles?` : `Give ${noun} to ${change.to}?`, confirmLabel: change.to === null ? 'Unassign' : 'Assign' };
  return { title: `Change the priority of ${noun}?`, confirmLabel: 'Change priority' };
}

/** What a bulk change came to, per task; or why nothing was sent. */
export type BulkOutcome = { kind: 'done'; results: BulkResult[] } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

/** The same change for several cards: a T2 (a passkey), then Hermes answers for each task, and one refusal does not stop the others. */
export async function changeMany(tasks: readonly BoardTask[], change: CardChange, slug?: string): Promise<BulkOutcome> {
  const ids = tasks.map((task) => task.id);
  const { title, confirmLabel } = bulkWords(change, ids.length);
  const outcome = await send(bulkRequest(ids, change, slug), {
    title,
    text: 'Hermes applies the change to each task on its own. Some may be refused (a task in another state, or one a worker has), and you will see which.',
    object: `${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}`,
    confirmLabel,
  });
  if (outcome.kind !== 'done') return outcome;
  return { kind: 'done', results: readBulk(outcome.body, ids) };
}

/** Reclaim (T1): Hermes releases the worker's claim and stops the worker, and the card returns to Ready. */
export async function reclaimTask(task: Pick<BoardTask, 'id' | 'title' | 'assignee'>, slug?: string): Promise<ActionOutcome> {
  const outcome = await send(requests.reclaim(task.id, 'Reclaimed from Caduceus', slug), {
    title: `Reclaim “${task.title}”?`,
    text: 'Hermes releases the worker’s claim without waiting for it to expire, and stops the worker. The task goes back to Ready and can run again.',
    object: task.id,
    profile: task.assignee ?? undefined,
    confirmLabel: 'Reclaim',
  });
  if (outcome.kind === 'done') toast(`Reclaimed “${task.title}”. It is Ready again.`);
  else if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
  return outcome;
}

/** What the dispatcher would do, as Hermes says it: nothing is started (a dry run is a read). */
export async function previewDispatch(ready: readonly string[], slug?: string): Promise<{ kind: 'done'; report: DispatchReport } | { kind: 'failed'; message: string }> {
  const outcome = await send(dispatchRequest({ dryRun: true, slug }));
  return outcome.kind === 'done' ? { kind: 'done', report: readDispatch(outcome.body, ready) } : { kind: 'failed', message: outcome.kind === 'failed' ? outcome.message : 'The preview was not made.' };
}

/** The nudge (T1): Hermes dispatches now instead of waiting for its next tick, and starts a worker for each ready task it may start. It uses the model. */
export async function nudgeDispatcher(ready: readonly string[], slug?: string): Promise<{ kind: 'done'; report: DispatchReport } | { kind: 'cancelled' } | { kind: 'failed'; message: string }> {
  const outcome = await send(dispatchRequest({ slug }), {
    title: 'Nudge the dispatcher?',
    text: 'Hermes looks at the ready tasks on this board now, and starts a worker for each one it may start. Workers use the model. Preview first to see which.',
    object: 'the dispatcher',
    confirmLabel: 'Nudge',
  });
  return outcome.kind === 'done' ? { kind: 'done', report: readDispatch(outcome.body, ready) } : outcome;
}

/** Saves dispatcher settings (T2: a passkey). The page then reads them back from Hermes and shows what Hermes holds. */
export function saveSettings(change: SettingsChange, summary: string): Promise<ActionOutcome> {
  return send(settingsRequest(change), {
    title: 'Change the dispatcher’s settings?',
    text: `${summary} Hermes saves them in its configuration, and the dispatcher uses them from its next pass.`,
    object: 'the dispatcher’s settings',
    confirmLabel: 'Save settings',
    recoverability: { undoable: true, note: 'Change them back here.' },
  });
}

/** Creates a board (T1). Resolves with its address, which the page then opens. */
export async function createBoard(board: { slug: string; name: string; description?: string }): Promise<ActionOutcome<{ slug: string }>> {
  const outcome = await send<{ board?: { slug?: string } }>(boardRequests.create(board), {
    title: `Create the board “${board.name.trim()}”?`,
    text: 'Hermes makes an empty board of its own, with its own tasks.',
    object: board.slug,
    confirmLabel: 'Create board',
  });
  if (outcome.kind !== 'done') return outcome;
  return { kind: 'done', body: { slug: outcome.body.board?.slug ?? board.slug.trim().toLowerCase() } };
}

/** Renames a board, or changes what it says it is for (T1). The address stays. */
export function renameBoard(slug: string, fields: { name?: string; description?: string }): Promise<ActionOutcome> {
  return send(boardRequests.rename(slug, fields), { title: `Rename the board ${slug}?`, text: 'Only its name and description change. Its address, and its tasks, stay.', object: slug, confirmLabel: 'Save' });
}

/** Makes a board Hermes's current one (T0), the one its command line and slash commands use when no board is named. */
export async function makeCurrent(slug: string): Promise<void> {
  const outcome = await send(boardRequests.switchTo(slug));
  if (outcome.kind === 'done') toast(`${slug} is now Hermes’s current board.`);
  else if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
}

/** Writes Hermes's export file of a board (T1) and says where it is on the Hermes host. */
export async function exportBoard(slug: string, name: string): Promise<ActionOutcome<{ file: string }>> {
  const outcome = await send(boardRequests.export(slug), {
    title: `Export the board “${name}”?`,
    text: 'Hermes writes the board, its comments and its attachments to a file on the Mac that runs it. Worker logs are not included.',
    object: slug,
    confirmLabel: 'Export',
  });
  if (outcome.kind !== 'done') return outcome;
  const file = readExport(outcome.body);
  return file === undefined ? { kind: 'failed', message: 'Hermes did not say where it wrote the file.' } : { kind: 'done', body: { file } };
}

/**
 * Archives a board (T1). Hermes has no way to take an archive back, so a copy is exported first; Undo imports that copy again, asking for the same
 * address, which the policy allows as a T1 for exactly that file. `restored` runs after an Undo, so the page can show the board again.
 */
export async function archiveBoard(slug: string, name: string, restored: (slug: string) => void): Promise<ActionOutcome> {
  const confirmed = await confirmTier({
    tier: 'T1',
    moduleId: 'work',
    action: 'DELETE /api/plugins/kanban/boards/{slug}',
    label: `Archive the board “${name}”?`,
    text: 'Hermes takes it out of the list of boards. Its tasks stay in the archive, and are not worked on. Caduceus saves a copy first, so Undo can bring it back.',
    object: slug,
    confirmLabel: 'Archive board',
  });
  if (!confirmed) return { kind: 'cancelled' };
  const exported = await send<unknown>(boardRequests.export(slug), undefined, true);
  const file = exported.kind === 'done' ? readExport(exported.body) : undefined;
  if (file === undefined) {
    const message = exported.kind === 'failed' ? exported.message : 'Hermes did not say where it wrote the copy.';
    toast(`Nothing was archived: the copy could not be saved first. ${message}`, { tone: 'danger' });
    return { kind: 'failed', message };
  }
  const archived = await send(boardRequests.archive(slug), undefined, true);
  if (archived.kind === 'failed') {
    toast(archived.message, { tone: 'danger' });
    return archived;
  }
  toast(`Archived the board “${name}”.`, {
    undo: () =>
      void send<{ board?: string }>(boardRequests.restore(file, slug), undefined, true).then((back) => {
        if (back.kind === 'failed') toast(back.message, { tone: 'danger' });
        else if (back.kind === 'done') {
          // Hermes keeps the address of an archived board for the archived board, so it gives the copy another one; it says which.
          const landed = back.body.board ?? slug;
          toast(landed === slug ? `Put the board “${name}” back.` : `Put the board “${name}” back as ${landed}, because Hermes keeps ${slug} for the archived board.`);
          restored(landed);
        }
      }),
  });
  return archived;
}

/** Imports a board archive from the Hermes host as a new board (T3: the owner types the board's address). Resolves with the address it landed under. */
export async function importBoard(archive: string, slug: string): Promise<ActionOutcome<{ slug: string }>> {
  const outcome = await send<{ board?: string; slug?: string }>(boardRequests.importArchive({ archive, slug }), {
    title: 'Import a board?',
    text: 'Hermes makes a new board from the file, with its tasks, comments and attachments. Workers will read those tasks and may act on them, so import only a file you trust.',
    object: slug,
    confirmLabel: 'Import board',
    recoverability: { undoable: true, note: 'Archive the new board.' },
  });
  if (outcome.kind !== 'done') return outcome;
  return { kind: 'done', body: { slug: outcome.body.slug ?? outcome.body.board ?? slug } };
}
