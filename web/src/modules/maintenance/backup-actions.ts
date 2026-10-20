// What the Backup screen changes or reads (M5 #14), each through `fetchTiered` with the tier the policy map gives the route: making a backup and downloading it are
// both Tier 3 (the archive holds secrets), restoring one Tier 3 and pruning checkpoints Tier 2. Hermes does all of it; Caduceus drains before a restore and restarts after.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { formatBytes, type CheckpointSummary } from './backup-model.ts';

/** What Hermes answers when it starts a backup: the file it is writing, in its own backups folder. */
export interface MadeBackup {
  archive: string;
  name: string;
}

const basename = (archive: string) => archive.split(/[\\/]/).pop() ?? archive;

/** Starts a backup of the whole Hermes home (which holds Caduceus's own folder). Its progress is then followed with `useActionOutput('backup')`. */
export async function createBackup(): Promise<ActionOutcome<MadeBackup>> {
  const outcome = await runTiered<{ archive?: string }>(
    fetchTiered({
      method: 'POST',
      path: '/api/ops/backup',
      body: {},
      confirm: {
        title: 'Make a backup?',
        text: 'Hermes zips its home folder: its settings, keys, sessions, memory, skills and jobs, and Caduceus’s own folder (its passkeys, saved prompts and preferences). The archive holds every key Hermes has. It can take a few minutes and the file is kept on this Mac, in Hermes’s backups folder.',
        object: 'Hermes home',
        confirmLabel: 'Make backup',
        recoverability: { undoable: true, note: 'It only adds a file to Hermes’s backups folder; delete the file to undo it.' },
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const { archive } = outcome.body;
  if (typeof archive !== 'string') return { kind: 'failed', message: 'Hermes did not say where it is writing the backup.' };
  return { kind: 'done', body: { archive, name: basename(archive) } };
}

/** Downloads a backup to this device (Tier 3: the owner types “backup”, since the archive holds secrets). The file is read into memory and saved from there; nothing is cached. */
export async function downloadBackup(archive: string): Promise<ActionOutcome<{ name: string; bytes: number }>> {
  const result = await fetchTiered({
    method: 'GET',
    path: `/api/ops/backup/download?archive=${encodeURIComponent(archive)}`,
    confirm: {
      title: 'Download this backup?',
      text: 'The archive holds your keys, tokens and sessions. Anyone who has the file has them: keep it somewhere safe and delete it when you no longer need it.',
      object: 'backup',
      confirmLabel: 'Download',
      recoverability: { undoable: false, note: 'A copy that leaves this Mac cannot be taken back.' },
    },
  });
  if (result.kind === 'cancelled') return { kind: 'cancelled' };
  if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
  if (!result.response.ok) return { kind: 'failed', message: `Hermes answered HTTP ${result.response.status}.` };
  const blob = await result.response.blob();
  const name = basename(archive);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // The click starts the save; the address may go once it has.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { kind: 'done', body: { name, bytes: blob.size } };
}

const RESTORE_CONFIRM = {
  title: 'Restore this backup?',
  text: 'Hermes copies the backup over its home folder, replacing settings, keys, sessions and memory with the backup’s, and Caduceus’s own folder with it. Caduceus pauses new turns first, then restarts Hermes and itself, so every open page reconnects. Anything made after the backup is lost.',
  object: 'restore',
  confirmLabel: 'Restore backup',
  recoverability: { undoable: false, note: 'Make a backup first if you want to be able to go back.' },
} as const;

/** Restores from a backup file on this device (Tier 3: the owner types “restore”). Resolves once Caduceus has paused turns and Hermes has taken the file; the import is then followed with `useActionOutput('import')`. */
export function restoreFromFile(file: File): Promise<ActionOutcome> {
  const form = new FormData();
  form.set('file', file, file.name);
  form.set('force', 'true');
  return runTiered(fetchTiered({ method: 'POST', path: '/api/ops/import-upload', form, confirm: RESTORE_CONFIRM }));
}

/** Restores from a backup file on the Mac that runs Hermes, by its path (Tier 3). */
export function restoreFromPath(archive: string): Promise<ActionOutcome> {
  return runTiered(fetchTiered({ method: 'POST', path: '/api/ops/import', body: { archive, force: true }, confirm: RESTORE_CONFIRM }));
}

/** Prunes Hermes's checkpoints (Tier 2: a passkey); the dialog names how many there are. The prune is then followed with `useActionOutput('checkpoints-prune')`. */
export function pruneCheckpoints(summary: CheckpointSummary): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: '/api/ops/checkpoints/prune',
      confirm: {
        title: `Prune ${summary.sessions} ${summary.sessions === 1 ? 'session’s' : 'sessions’'} checkpoints?`,
        text: `Hermes holds checkpoints for ${summary.sessions} ${summary.sessions === 1 ? 'session' : 'sessions'} (${summary.files} ${summary.files === 1 ? 'file' : 'files'}, ${formatBytes(summary.bytes)}). It deletes the stale ones and those of folders that no longer exist, then compacts what is left. A session can no longer be rolled back to a checkpoint that is deleted.`,
        object: 'checkpoints',
        confirmLabel: 'Prune checkpoints',
      },
    }),
  );
}
