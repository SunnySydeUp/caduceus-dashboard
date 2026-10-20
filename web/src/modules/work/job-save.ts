// Saving a job the builder made: the order of what is asked of Hermes, with the words each confirmation shows. The web app's transport
// (`fetchTiered`, in `schedules-actions.ts`) and a test's differ only in how a request is sent; what is sent, and in which order, is here.
import type { Recoverability } from '../../tier-flow.ts';
import type { JobRequest } from './job-actions.ts';
import type { JobPlan } from './job-form.ts';

/** What came of sending a request: it worked (with Hermes's answer), the owner declined, or it failed (with the reason, in words). The same shape as `ActionOutcome` of the profile actions. */
export type SaveOutcome<Body = unknown> = { kind: 'done'; body: Body } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

/** What the confirmation dialog shows for a step: the same fields as the web app's `Confirmation` (`tiered-fetch.ts`), which this pure module cannot import. */
export interface SaveConfirmation {
  title: string;
  text?: string;
  object?: string;
  profile?: string;
  confirmLabel?: string;
  recoverability?: Recoverability;
}

export interface SaveTransport {
  /** Sends a route that is not a read, after the confirmation its tier needs. */
  send(request: JobRequest, confirm: SaveConfirmation): Promise<SaveOutcome>;
}

/** What the confirmations call the job. */
export interface SaveLabel {
  name: string;
  profile: string;
  /** Saving a new job or changing one. */
  change: 'create' | 'edit';
  /** The script the job runs, when the owner is to type its name to confirm (a Script job's file, or a monitor script's): code is confirmed by naming the code, not the job. */
  script?: string;
}

/**
 * Runs the plan: the scripts first (the guarded route saves each into the profile's own scripts folder, the only place Hermes runs one from), then the job. It stops at the first step that does not work, so a job is never made around a script that was not saved.
 * The answer is the job's: for a new job, its id.
 */
export async function savePlan(plan: JobPlan, label: SaveLabel, transport: SaveTransport): Promise<SaveOutcome<{ id?: string }>> {
  const verb = label.change === 'create' ? 'Create' : 'Save';
  const typed = label.script ?? plan.scriptSaves?.[0]?.name ?? label.name;
  for (const save of plan.scriptSaves ?? []) {
    const saved = await transport.send(save.request, {
      title: `Save the script “${save.name}” for ${label.profile}?`,
      text: `A script is code that runs on the Mac that runs Hermes every time the schedule fires. Caduceus saves it in ${label.profile}’s scripts folder, the only place Hermes runs scripts from. Files ending in .sh or .bash run in bash; anything else runs in Python.`,
      object: save.name,
      profile: label.profile,
      confirmLabel: 'Save script',
      recoverability: { undoable: true, note: 'Saving it again replaces the file; deleting the job leaves the file in the scripts folder.' },
    });
    if (saved.kind !== 'done') return saved;
  }
  if (!plan.job) return { kind: 'done', body: {} };
  const runsScript = plan.scriptSaves !== undefined || plan.job.body?.no_agent === true;
  const made = (await transport.send(plan.job, {
    title: `${verb} “${label.name}”?`,
    text:
      label.change === 'create'
        ? `Hermes creates the job in ${label.profile} and runs it on its schedule.${runsScript ? ' It runs a script on the Mac that runs Hermes.' : ' An agent answers its prompt each time, which uses the model.'}`
        : `Hermes changes the job in ${label.profile}. Only what you changed is sent.`,
    object: typed,
    profile: label.profile,
    confirmLabel: label.change === 'create' ? 'Create schedule' : 'Save changes',
    recoverability: label.change === 'create' ? { undoable: true, note: 'Delete the schedule to undo it.' } : undefined,
  })) as SaveOutcome<{ id?: string }>;
  if (made.kind !== 'done' || plan.after === undefined) return made;
  // Hermes's create route has no field for these: the job exists now, so they are set with an update.
  const id = made.body.id;
  const query = `?profile=${encodeURIComponent(label.profile)}`;
  if (id === undefined) return { kind: 'failed', message: `“${label.name}” was created, but Hermes did not say which job it is, so its monitor and delivery options were not set. Open it and edit it to set them.` };
  const set = await transport.send(
    { method: 'PUT', path: `/api/cron/jobs/${encodeURIComponent(id)}${query}`, body: { updates: plan.after } },
    {
      title: `Set the options of “${label.name}”?`,
      text: 'Hermes could not take these options when it created the job, so they are set now: a monitor, a separate target for failures, or attaching the run to a session.',
      object: typed,
      profile: label.profile,
      confirmLabel: 'Set options',
    },
  );
  if (set.kind === 'done') return made;
  return { kind: 'failed', message: `“${label.name}” was created, but its options were not set${set.kind === 'failed' ? `: ${set.message}` : ''}. Open it and edit it to set them.` };
}
