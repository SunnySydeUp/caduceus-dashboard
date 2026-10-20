// The one change Observe › Logs makes: Truncate file, a Tier 3 operation Caduceus performs itself on the Mac that runs Hermes (guarded file
// operation, R11). It goes through `fetchTiered` like any Hermes route that is not a read: the shared dialog asks the owner to type the
// file's name, and the server binds that to this request. The caller shows the toast.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { LOG_FILE_CHOICES, type LogFileName } from './logs-model.ts';

/** Empties the log file of `profile` (T3). Hermes keeps writing to it, and starts it again from the top. */
export function truncateLog(file: LogFileName, profile: string): Promise<ActionOutcome<{ bytes: number }>> {
  const disk = LOG_FILE_CHOICES.find((choice) => choice.value === file)!.disk;
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: '/_caduceus/api/logs/truncate',
      body: { file, profile },
      confirm: {
        title: `Truncate ${disk} for ${profile}?`,
        text: `Everything in ${disk} is deleted from this Mac, for good, for every reader of it. Hermes carries on writing new lines to it. It cannot be undone.`,
        object: disk,
        profile,
        confirmLabel: 'Truncate file',
        recoverability: { undoable: false, note: 'The lines are deleted from the file on the Mac that runs Hermes.' },
      },
    }),
  );
}

/** Saves `text` as a file the browser downloads. */
export function saveAsFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
