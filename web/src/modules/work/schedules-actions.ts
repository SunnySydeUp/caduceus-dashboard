// The changes Work › Schedules makes in Hermes, each through `fetchTiered` with the tier the policy map gives it: Run now, Pause,
// Resume and Delete are T1; Duplicate and Restore create a job, which is T1, or T3 (the copy's name typed) when it runs a script.
// The caller shows toasts and reloads; this says what happened. Caduceus keeps nothing of what it sends.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { actionRequest, canRestore, droppedOptions, duplicateRequest, restoreRequest, type JobRequest } from './job-actions.ts';
import type { JobPlan } from './job-form.ts';
import { savePlan, type SaveLabel } from './job-save.ts';
import type { Job } from './schedules-model.ts';

const send = (request: JobRequest, confirm: Parameters<typeof fetchTiered>[0]['confirm']) => runTiered(fetchTiered({ ...request, confirm }));

/** Runs the job once now, outside its schedule. Hermes answers when the run is over, which an agent can take minutes to be. */
export function runNow(job: Job): Promise<ActionOutcome> {
  return send(actionRequest(job, 'trigger'), {
    title: `Run “${job.name}” now?`,
    text: `It runs once, outside its schedule (${job.schedule}); the next scheduled run is unchanged.${job.type === 'script' || job.type === 'task' ? ' It runs a script on the Mac that runs Hermes.' : ' An agent answers its prompt, which uses the model.'}`,
    object: job.name,
    profile: job.profile,
    confirmLabel: 'Run now',
  });
}

export function pauseJob(job: Job): Promise<ActionOutcome> {
  return send(actionRequest(job, 'pause'), { title: `Pause “${job.name}”?`, text: 'It stops running until you resume it. Its history stays.', object: job.name, profile: job.profile, confirmLabel: 'Pause' });
}

export function resumeJob(job: Job): Promise<ActionOutcome> {
  return send(actionRequest(job, 'resume'), { title: `Resume “${job.name}”?`, text: `It runs again on its schedule (${job.schedule}).`, object: job.name, profile: job.profile, confirmLabel: 'Resume' });
}

/** What Delete says it does: where Hermes can create the job again it can be undone for a few seconds, otherwise it says it cannot. */
export function deleteConfirmation(job: Job): string {
  return canRestore(job)
    ? 'Hermes removes the job and its schedule. You can undo this for a few seconds afterwards; the job then comes back as a new one, without its past runs.'
    : 'Hermes removes the job and its schedule. This cannot be undone: Caduceus cannot create the job again with everything it has.';
}

export function deleteJob(job: Job): Promise<ActionOutcome> {
  return send(actionRequest(job, 'delete'), { title: `Delete “${job.name}”?`, text: deleteConfirmation(job), object: job.name, profile: job.profile, confirmLabel: 'Delete' });
}

/** Puts a deleted job back. Hermes makes it a new job, so the answer carries the new id. */
export function restoreJob(job: Job): Promise<ActionOutcome<{ id?: string }>> {
  return runTiered(fetchTiered({ ...restoreRequest(job), confirm: { title: `Put “${job.name}” back?`, text: 'Hermes creates the job again with the same schedule and settings.', object: job.name, profile: job.profile, confirmLabel: 'Put back' } }));
}

/** A paused copy. A script job's copy runs the same script, so it is a T3 and asks for the copy's name. */
export function duplicateJob(job: Job): Promise<ActionOutcome<{ id?: string; name?: string }>> {
  const request = duplicateRequest(job);
  const name = String(request.body?.name);
  const left = droppedOptions(job);
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Duplicate “${job.name}”?`,
        text: `Hermes creates “${name}”, paused, in ${job.profile}.${left.length > 0 ? ` The copy does not have ${left.join(', ')}, which Hermes cannot set when it creates a job.` : ''}${request.body?.script ? ' The copy runs the same script on the Mac that runs Hermes.' : ''}`,
        object: name,
        profile: job.profile,
        confirmLabel: 'Duplicate',
        recoverability: { undoable: true, note: 'Delete the copy to undo it.' },
      },
    }),
  );
}

/** Saves what the schedule builder made. Every step goes through `fetchTiered` with the tier the policy gives it: a job that runs no script is a T1; a script is saved through the guarded route (T3) and a job that runs one is a T3 with its name typed. */
export function saveJob(plan: JobPlan, label: SaveLabel): Promise<ActionOutcome<{ id?: string }>> {
  return savePlan(plan, label, { send });
}
