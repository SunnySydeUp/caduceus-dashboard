// What the task page changes in Hermes's Kanban, each through `fetchTiered` with the tier the policy map gives it: Run now, Retry,
// Reassign, Reclaim and Terminate are T1, and so is Retry (a route of Caduceus's own, which the server judges and audits; Terminate names the run and the profile); Decompose and Estimate are T1 as well;
// Specify is T1 and the owner then accepts or rejects what it wrote; deleting an attachment is T1 and names the file. Comments,
// links and uploads are T0. The request builders are pure (a test sends them to the real Hermes); the runners add the dialogs.
// Caduceus keeps nothing of what it sends, and never says who wrote a comment: the server stamps the author.
import { fetchTiered } from '../../tiered.ts';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import type { TieredRequest } from '../../tiered-fetch.ts';
import { requests } from './task-requests.ts';
import type { TaskAttachment, TaskFull, TaskRun } from './task-model.ts';

const send = (request: TieredRequest) => runTiered(fetchTiered(request));

export const postComment = (taskId: string, text: string, slug?: string) => send(requests.comment(taskId, text, slug));

/** Run now: the task goes to `ready` (when it is not already) and the dispatcher is nudged, so it need not wait for the next tick. One confirmation covers both steps. */
export async function runNow(task: TaskFull, slug?: string): Promise<ActionOutcome> {
  const confirmed = await confirmTier({
    tier: 'T1',
    moduleId: 'work',
    action: 'POST /api/plugins/kanban/dispatch',
    label: `Run “${task.title}” now?`,
    text: task.assignee
      ? `A worker of ${task.assignee} starts it at once and uses the model. Tasks that are ready may start with it.`
      : 'Nobody is assigned to it, so Hermes has no worker to start: it waits in Ready until you assign a profile. Tasks that are ready may start now.',
    object: task.id,
    profile: task.assignee ?? undefined,
    confirmLabel: 'Run now',
  });
  if (!confirmed) return { kind: 'cancelled' };
  if (task.status !== 'ready') {
    const moved = await send(requests.setStatus(task.id, 'ready', slug));
    if (moved.kind !== 'done') return moved;
  }
  return send({ ...requests.dispatch(slug), alreadyConfirmed: true });
}

export const retry = (task: TaskFull, slug?: string) =>
  send({
    ...requests.retry(task.id, slug),
    confirm: { title: `Retry “${task.title}”?`, text: 'It goes back to Ready, and the dispatcher gives it to a worker again. That uses the model.', object: task.id, profile: task.assignee ?? undefined, confirmLabel: 'Retry' },
  });

export function terminate(task: TaskFull, run: TaskRun, slug?: string): Promise<ActionOutcome> {
  return send({
    ...requests.terminate(run.id, 'Terminated from Caduceus', slug),
    confirm: {
      title: `Terminate run ${run.id}?`,
      text: `The worker of ${run.profile ?? 'the assigned profile'} is stopped now (SIGTERM, then SIGKILL) and the run ends as reclaimed. Its work so far in the workspace stays.`,
      object: `run ${run.id}`,
      profile: run.profile ?? task.assignee ?? undefined,
      confirmLabel: 'Terminate run',
    },
  });
}

export const reclaim = (task: TaskFull, slug?: string) =>
  send({
    ...requests.reclaim(task.id, 'Reclaimed from Caduceus', slug),
    confirm: { title: `Reclaim “${task.title}”?`, text: 'Hermes releases the worker’s claim without waiting for it to expire, and stops the worker. The task can then be run again.', object: task.id, profile: task.assignee ?? undefined, confirmLabel: 'Reclaim' },
  });

export const reassign = (task: TaskFull, profile: string | null, slug?: string) =>
  send({
    ...requests.reassign(task.id, profile, task.status === 'running', slug),
    confirm: {
      title: profile ? `Give “${task.title}” to ${profile}?` : `Take “${task.title}” off ${task.assignee ?? 'its profile'}?`,
      text: task.status === 'running' ? 'A worker has it now: Hermes reclaims it first, which stops that worker.' : 'The next worker to take it is of that profile.',
      object: task.id,
      profile: profile ?? task.assignee ?? undefined,
      confirmLabel: profile ? 'Reassign' : 'Unassign',
    },
  });

export const decompose = (task: TaskFull, slug?: string) =>
  send({
    ...requests.decompose(task.id, slug),
    confirm: { title: `Decompose “${task.title}”?`, text: 'An auxiliary model splits the task into subtasks, which Hermes creates on the board. It uses the model.', object: task.id, profile: task.assignee ?? undefined, confirmLabel: 'Decompose' },
  });

/** Specify: Hermes's auxiliary model writes the brief. Hermes saves it at once and moves the task to Todo, so the page shows what it wrote and the owner accepts it, or Reject puts the old title, brief and column back. */
export const specify = (task: TaskFull, slug?: string) =>
  send({
    ...requests.specify(task.id, slug),
    confirm: { title: `Specify “${task.title}”?`, text: 'An auxiliary model writes a full brief from the title. You see it before you keep it. It uses the model.', object: task.id, profile: task.assignee ?? undefined, confirmLabel: 'Specify' },
  });

export const estimate = (task: TaskFull, slug?: string) =>
  send({
    ...requests.estimate(task.id, slug),
    confirm: { title: `Estimate “${task.title}”?`, text: 'An auxiliary model guesses the tokens the task will take. It changes nothing on the board and uses the model.', object: task.id, profile: task.assignee ?? undefined, confirmLabel: 'Estimate' },
  });

export const rejectSpecified = (taskId: string, snapshot: { title: string; brief: string; status: string }, slug?: string) => send(requests.restore(taskId, snapshot, slug));

export const addLink = (parentId: string, childId: string, slug?: string) => send(requests.link(parentId, childId, slug));
export const removeLink = (parentId: string, childId: string, slug?: string) => send(requests.unlink(parentId, childId, slug));

export const deleteAttachment = (file: TaskAttachment, profile: string | undefined, slug?: string) =>
  send({
    ...requests.deleteAttachment(file.id, slug),
    confirm: { title: `Delete ${file.filename}?`, text: 'Hermes removes the file from the task. Workers can no longer read it, and it cannot be brought back.', object: file.filename, profile, confirmLabel: 'Delete file', recoverability: { undoable: false, note: 'Upload it again from your device.' } },
  });

/**
 * Uploads a file to the task (Tier 0, which `fetchTiered` has nothing to confirm for; it sends JSON only, and an upload is a form).
 * The server stamps who uploaded it.
 */
export async function uploadAttachment(taskId: string, file: File, slug?: string): Promise<ActionOutcome> {
  const form = new FormData();
  form.set('file', file, file.name);
  try {
    const response = await fetch(requests.upload(taskId, slug), { method: 'POST', body: form });
    if (response.ok) return { kind: 'done', body: await response.json().catch(() => undefined) };
    const body: { detail?: unknown; message?: unknown } | undefined = await response.json().catch(() => undefined);
    return { kind: 'failed', message: typeof body?.detail === 'string' ? body.detail : typeof body?.message === 'string' ? body.message : `Hermes answered HTTP ${response.status}.` };
  } catch {
    return { kind: 'failed', message: 'Caduceus could not reach Hermes to upload the file.' };
  }
}
