// What the Brief editor changes in Hermes, each request through `fetchTiered` with the tier the policy map gives it. A new task is one
// confirmation (T1) that covers the create and the steps after it; saving an edit is a T0 PATCH. The caller shows toasts and navigates; this says
// what happened. Caduceus keeps nothing of what it sends. What is sent, and in which order, is `brief-task.ts` run by `brief-save.ts`.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { runCreatePlan, type BriefTransport, type CreateOutcome } from './brief-save.ts';
import { editRequest, type BriefFields, type CreatePlan } from './brief-task.ts';
import type { TaskFull } from './task-model.ts';

/** `fetchTiered`, as the plan's transport: the create asks (one dialog for the whole save), the steps after it ride on that answer. */
function transportFor(assignee: string): BriefTransport {
  return {
    send: (request, { confirm, alreadyConfirmed }) =>
      runTiered(
        fetchTiered({
          ...request,
          alreadyConfirmed,
          confirm: confirm && { title: confirm.title, text: confirm.text, object: confirm.object, profile: assignee || undefined, confirmLabel: confirm.confirmLabel },
        }),
      ),
  };
}

/** Saves a new task: the create, then the steps its mode needs (a nudge for Run now, Todo for a draft that waits there). */
export function saveNewTask(plan: CreatePlan, assignee: string): Promise<CreateOutcome> {
  return runCreatePlan(plan, transportFor(assignee));
}

/** Saves what changed on a task that exists; `undefined` outcome means nothing changed. */
export async function saveTaskEdit(task: TaskFull, fields: BriefFields, board: string | undefined): Promise<ActionOutcome | undefined> {
  const request = editRequest(task, fields, board);
  if (request === undefined) return undefined;
  return runTiered(fetchTiered(request));
}
