// Saving a new task from the Brief editor: the order of what is asked of Hermes, and what is said when a step after the create fails. The web
// app's transport (`fetchTiered`, in `brief-actions.ts`) and a test's differ only in how a request is sent; what is sent, and in which order,
// is `createPlan` (`brief-task.ts`) run here.
import { createdTaskId, createWarning, type CreatePlan, type PlanConfirmation } from './brief-task.ts';
import type { Plain } from './task-requests.ts';

/** What came of sending one request: Hermes's answer, the owner declining the confirmation, or a failure with its reason in words. */
export type SendOutcome = { kind: 'done'; body: unknown } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

export interface BriefTransport {
  /** Sends a request. The create carries the confirmation; the steps after it were confirmed with it (`alreadyConfirmed`). */
  send(request: Plain, options: { confirm?: PlanConfirmation; alreadyConfirmed?: boolean }): Promise<SendOutcome>;
}

export type CreateOutcome =
  /** The task exists and every step worked. `warning` is what Hermes said about the dispatcher, if it said anything. */
  | { kind: 'done'; id: string; warning?: string }
  | { kind: 'cancelled' }
  /** `id` is set when the task was made and a later step failed: the task is on the board, not as asked. */
  | { kind: 'failed'; message: string; id?: string };

/** Runs the plan: the create first, then each step that follows, stopping at the first that fails. */
export async function runCreatePlan(plan: CreatePlan, transport: BriefTransport): Promise<CreateOutcome> {
  const made = await transport.send(plan.create, { confirm: plan.confirm });
  if (made.kind !== 'done') return made;
  const id = createdTaskId(made.body);
  if (id === undefined) return { kind: 'failed', message: 'Hermes did not say which task it made.' };
  for (const step of plan.after) {
    const outcome = await transport.send(step(id), { alreadyConfirmed: true });
    if (outcome.kind === 'failed') return { kind: 'failed', id, message: `The task was made (${id}), but a step after it failed: ${outcome.message}` };
    // A step the owner can still cancel is never one of these: the dialog was answered with the create.
    if (outcome.kind === 'cancelled') return { kind: 'failed', id, message: `The task was made (${id}), but a step after it was not sent.` };
  }
  const warning = createWarning(made.body);
  return { kind: 'done', id, ...(warning ? { warning } : {}) };
}
