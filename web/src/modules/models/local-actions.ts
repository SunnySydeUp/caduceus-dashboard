// The changes Agents › Models › Local models makes in Hermes, each through `fetchTiered` with the tier the policy map gives the route (all
// Tier 1: the owner confirms, and a download says how much disk it needs). The caller shows toasts and reloads; Caduceus keeps nothing.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { pauseRequest, resumeRequest, type LocalJob } from './local-models.ts';
import { activateRequest, bytesLabel, deleteRequest, downloadBrowsedRequest, downloadRequest, ejectRequest, freedMessage, installRuntimeRequest, quickstartRequest, serverRequest, sideloadRequest, type CatalogRow, type LocalRequest, type RepoFile, type StagedModel } from './local-models.ts';

function send(request: LocalRequest, confirm: { title: string; text: string; confirmLabel: string; object: string; profile?: string }): Promise<ActionOutcome> {
  return runTiered(fetchTiered({ method: request.method, path: request.path, body: request.body, confirm }));
}

/** Downloads the build Hermes picked for this Mac. The confirmation states the disk space. */
export function downloadModel(row: CatalogRow): Promise<ActionOutcome> {
  return send(downloadRequest(row.id), {
    title: `Download ${row.name}?`,
    text: `This needs ${row.sizeLabel} of disk space in Hermes’s models folder and can take a long time. ${row.fitSummary}. Hermes downloads it in the background; you can leave this page.`,
    confirmLabel: 'Download',
    object: row.name,
  });
}

/** Downloads one build from a Hugging Face repo. */
export function downloadFromRepo(repo: string, file: RepoFile): Promise<ActionOutcome> {
  const request = downloadBrowsedRequest(repo, file.paths);
  return send(request, {
    title: `Download ${file.label} from ${repo}?`,
    text: `This needs ${bytesLabel(file.sizeBytes)} of disk space in Hermes’s models folder${file.paths.length > 1 ? ` (${file.paths.length} parts)` : ''}. The file comes from Hugging Face as it is; Hermes does not check it beyond its size.`,
    confirmLabel: 'Download',
    object: repo,
  });
}

/** Registers a GGUF file that is already on this Mac. */
export function sideloadModel(path: string): Promise<ActionOutcome> {
  return send(sideloadRequest(path), {
    title: 'Add this file to the local models?',
    text: `Hermes links ${path} into its models folder, so it takes no extra disk space (it copies the file only if it cannot link). The original stays where it is.`,
    confirmLabel: 'Add model',
    object: path,
  });
}

/** Installs the llama.cpp runtime. */
export function installRuntime(profile: string): Promise<ActionOutcome> {
  return send(installRuntimeRequest(profile), {
    title: 'Install the local runtime?',
    text: 'Hermes downloads llama.cpp for this Mac (a few hundred megabytes) and unpacks it in its own folder. Nothing else on this Mac changes.',
    confirmLabel: 'Install runtime',
    object: 'llama.cpp',
    profile,
  });
}

/** One job: runtime if missing, the recommended model if missing, and the profile's main model set to it. */
export function quickStart(profile: string, row: CatalogRow | undefined, needsRuntime: boolean): Promise<ActionOutcome> {
  return send(quickstartRequest(profile, row?.id), {
    title: `Set up ${row?.name ?? 'a local model'} for ${profile}?`,
    text: `${needsRuntime ? 'Hermes installs the local runtime, ' : 'Hermes '}downloads ${row ? `${row.sizeLabel} for ${row.name}` : 'the model it recommends for this Mac'} if it is not on disk, starts the local server and makes the model the main model of ${profile}.`,
    confirmLabel: 'Start setup',
    object: profile,
    profile,
  });
}

/** Makes a model on disk the profile's main model and starts the server. */
export function activateModel(model: StagedModel, profile: string): Promise<ActionOutcome> {
  return send(activateRequest(model.id, profile), {
    title: `Use ${model.id} as the main model of ${profile}?`,
    text: 'Hermes starts the local server if it is off and writes the model to the profile’s config. The model is loaded into memory the first time something asks it.',
    confirmLabel: 'Activate',
    object: model.id,
    profile,
  });
}

/** Frees a model's memory. */
export function ejectModel(model: StagedModel): Promise<ActionOutcome> {
  return send(ejectRequest(model.id), { title: `Eject ${model.id}?`, text: 'Hermes frees the memory the model uses. The next question loads it again.', confirmLabel: 'Eject', object: model.id });
}

/** Starts or stops the local server. */
export function setServer(action: 'start' | 'stop'): Promise<ActionOutcome> {
  return send(serverRequest(action), action === 'start'
    ? { title: 'Start the local server?', text: 'Hermes starts llama.cpp and keeps it on when Hermes starts.', confirmLabel: 'Start server', object: 'local server' }
    : { title: 'Stop the local server?', text: 'Hermes stops llama.cpp, frees all of its memory and keeps it off until you start it again. A profile that uses a local model cannot answer meanwhile.', confirmLabel: 'Stop server', object: 'local server' });
}

/** Stops a download where it is; the files stay and it can be carried on. */
export function pauseDownload(job: Pick<LocalJob, 'id' | 'target'>): Promise<ActionOutcome> {
  return send(pauseRequest(job.id), { title: `Pause the download of ${job.target}?`, text: 'Hermes stops downloading and keeps what it has. You can carry on from where it stopped.', confirmLabel: 'Pause', object: job.target });
}

/** Carries on a paused download. */
export function resumeDownload(job: Pick<LocalJob, 'id' | 'target'>): Promise<ActionOutcome> {
  return send(resumeRequest(job.id), { title: `Carry on downloading ${job.target}?`, text: 'Hermes starts again where it stopped and reuses the files it already checked.', confirmLabel: 'Carry on', object: job.target });
}

/** Deletes a model's files. */
export function deleteModel(model: StagedModel): Promise<ActionOutcome<{ message: string }>> {
  return send(deleteRequest(model.id), {
    title: `Delete ${model.id}?`,
    text: `Hermes removes the model’s files and frees ${model.sizeLabel}. A model you added from a file on this Mac is only unlinked: the original stays.${model.active ? ' It is the main model of a profile, which will have no model that works.' : ''}`,
    confirmLabel: 'Delete model',
    object: model.id,
  }).then((outcome) => (outcome.kind === 'done' ? { kind: 'done', body: { message: freedMessage(model) } } : outcome));
}
