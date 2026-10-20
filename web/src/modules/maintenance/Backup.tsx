// System › Maintenance › Backup (M5 #14): make a backup of the Hermes home (which holds Caduceus's own folder) and download it, restore one from a file or a path on
// the Mac, and see and prune Hermes's checkpoints. Hermes makes, restores and prunes; Caduceus drains before a restore and restarts after, and asks for each
// tier's confirmation. The archive holds secrets: it is never cached and is downloaded only after the owner types a confirmation.
import { useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { createBackup, downloadBackup, pruneCheckpoints, restoreFromFile, restoreFromPath } from './backup-actions.ts';
import { useCheckpoints, useLatestBackup } from './backup-data.ts';
import { formatBytes, pruneAdvice } from './backup-model.ts';
import { useActionOutput } from './diagnostics-data.ts';
import { MaintenanceFrame } from './MaintenanceFrame.tsx';
import { RestoreSheet } from './RestoreSheet.tsx';
import './maintenance.css';

/** Hermes's output of one of its actions, in a plain block that follows it until it ends. */
function ActionLog({ name, run, label }: { name: string; run: number; label: string }) {
  const output = useActionOutput(name, run);
  return (
    <div role="status">
      <p className="mt-log-state">
        {output.status === 'running' && (
          <>
            <Icon name="running" small /> Hermes is working…
          </>
        )}
        {output.status === 'ok' && (
          <>
            <Icon name="succeeded" small /> Finished.
          </>
        )}
        {output.status === 'failed' && (
          <span className="mt-error">
            <Icon name="failed" small /> Hermes ended with an error{output.exitCode === null ? '' : ` (exit code ${output.exitCode})`}.
          </span>
        )}
        {output.status === 'lost' && (
          <span className="mt-error">
            <Icon name="alert" small /> Caduceus lost the connection to the output. Hermes may still be working.
          </span>
        )}
      </p>
      {output.status === 'failed' && pruneAdvice(output.lines) && <p className="mt-note">{pruneAdvice(output.lines)}</p>}
      <pre className="mt-log" role="log" aria-label={label} tabIndex={0}>
        {output.lines.length > 0 ? output.lines.join('\n') : 'Waiting for the first line…'}
      </pre>
    </div>
  );
}

function BackupSection() {
  const [latest, remember] = useLatestBackup();
  const [busy, setBusy] = useState<'make' | 'download'>();
  const [run, setRun] = useState(0);
  const [making, setMaking] = useState(false);

  const make = async () => {
    setBusy('make');
    const outcome = await createBackup();
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      remember(outcome.body);
      setMaking(true);
      setRun((before) => before + 1);
    }
  };
  const download = async () => {
    if (!latest) return;
    setBusy('download');
    const outcome = await downloadBackup(latest.archive);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') toast(`Downloaded ${outcome.body.name}`, { detail: `${formatBytes(outcome.body.bytes)}. It holds your keys: keep it safe.` });
  };
  return (
    <section className="mt-card" aria-labelledby="mt-backup">
      <h2 id="mt-backup" className="mt-card__name">
        Make a backup
      </h2>
      <p className="mt-note">
        Hermes zips its home folder: settings, keys, sessions, memory, skills and jobs. Caduceus’s own folder, with its passkeys and saved prompts, is inside it, so a <Term id="backup">backup</Term> brings Caduceus back too. The archive holds every key Hermes has, so making one and downloading it are both <Term id="risk-tiers">Tier 3</Term> actions: a passkey, and you type the name. The file stays on this Mac in Hermes’s backups folder, and no file screen can open it.
      </p>
      <div className="mt-card__actions">
        <WriteButton type="button" className="btn btn--primary btn--sm" disabled={busy !== undefined} aria-busy={busy === 'make'} onClick={() => void make()}>
          <Icon name="archive" small />
          Make backup
        </WriteButton>
        {latest && (
          <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-busy={busy === 'download'} onClick={() => void download()}>
            <Icon name="download" small />
            Download backup
          </WriteButton>
        )}
      </div>
      {latest && (
        <p className="mt-note">
          Latest in this tab: <code className="mt-code">{latest.archive}</code>
        </p>
      )}
      {making && <ActionLog name="backup" run={run} label="Output of the backup" />}
    </section>
  );
}

function RestoreSection({ onStarted }: { onStarted(): void }) {
  const file = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File>();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState<'file' | 'path'>();

  const send = async (via: 'file' | 'path') => {
    const picked = chosen;
    if (via === 'file' && !picked) return;
    setBusy(via);
    const outcome = via === 'file' ? await restoreFromFile(picked!) : await restoreFromPath(path.trim());
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') onStarted();
  };
  const fromPath = (event: FormEvent) => {
    event.preventDefault();
    if (path.trim() !== '') void send('path');
  };
  return (
    <section className="mt-card" aria-labelledby="mt-restore">
      <h2 id="mt-restore" className="mt-card__name">
        Restore a backup
      </h2>
      <p className="mt-note">
        A <Term id="backup-restore">restore</Term> copies a backup over Hermes’s home folder, and Caduceus’s own folder with it. Caduceus pauses new turns first, then restarts Hermes and itself. It is a <Term id="risk-tiers">Tier 3</Term> action: a passkey, and you type “restore”. It is not available in read-only mode or offline.
      </p>
      <div className="mt-restore">
        <label className="mt-restore__label" htmlFor="mt-restore-file">
          From a file on this device
        </label>
        <div className="mt-bar">
          <input ref={file} id="mt-restore-file" className="mt-restore__file" type="file" accept=".zip,application/zip" onChange={(event) => setChosen(event.target.files?.[0])} />
          <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={!chosen || busy !== undefined} aria-busy={busy === 'file'} onClick={() => void send('file')}>
            <Icon name="arrow-up" small />
            Restore from file
          </WriteButton>
        </div>
        {chosen && <p className="mt-note">{chosen.name}, {formatBytes(chosen.size)}. The file is sent to Caduceus, which passes it to Hermes: up to 100 MB. A larger backup is restored from its path.</p>}
        {busy === 'file' && (
          <p className="mt-log-state" role="status">
            <Icon name="running" small /> Pausing new turns, then sending the file to Hermes…
          </p>
        )}
      </div>
      <form className="mt-restore" onSubmit={fromPath}>
        <label className="mt-restore__label" htmlFor="mt-restore-path">
          From a path on the Mac that runs Hermes
        </label>
        <div className="mt-bar">
          <input id="mt-restore-path" className="input mt-restore__path" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="/Users/you/Downloads/hermes-backup.zip" value={path} onChange={(event) => setPath(event.target.value)} />
          <WriteButton type="submit" className="btn btn--secondary btn--sm" disabled={path.trim() === '' || busy !== undefined} aria-busy={busy === 'path'}>
            <Icon name="arrow-up" small />
            Restore from path
          </WriteButton>
        </div>
        {busy === 'path' && (
          <p className="mt-log-state" role="status">
            <Icon name="running" small /> Pausing new turns, then starting the restore…
          </p>
        )}
      </form>
    </section>
  );
}

function CheckpointsSection() {
  const { summary, failed, loading, reload } = useCheckpoints();
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(0);
  const [pruning, setPruning] = useState(false);
  const prune = async () => {
    if (!summary) return;
    setBusy(true);
    const outcome = await pruneCheckpoints(summary);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      setPruning(true);
      setRun((before) => before + 1);
    }
  };
  return (
    <section className="mt-card" aria-labelledby="mt-checkpoints">
      <h2 id="mt-checkpoints" className="mt-card__name">
        Checkpoints
      </h2>
      <p className="mt-note">
        Before an agent changes files, Hermes snapshots them as <Term id="checkpoint">checkpoints</Term> so a session can roll back. They take space and a backup leaves them out. Pruning is a <Term id="risk-tiers">Tier 2</Term> action: a passkey.
      </p>
      <p className="mt-card__headline" role="status" aria-busy={loading}>
        {summary ? summary.text : failed ? 'Hermes did not list its checkpoints.' : 'Reading the checkpoints…'}
      </p>
      <div className="mt-card__actions">
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={!summary || summary.sessions === 0 || busy} aria-busy={busy} onClick={() => void prune()}>
          <Icon name="trash" small />
          Prune checkpoints
        </WriteButton>
        <button type="button" className="btn btn--ghost btn--sm" disabled={loading} onClick={() => void reload()}>
          <Icon name="refresh" small />
          Refresh checkpoints
        </button>
      </div>
      {pruning && <ActionLog name="checkpoints-prune" run={run} label="Output of the prune" />}
    </section>
  );
}

export function Backup() {
  const [restoring, setRestoring] = useState(false);
  return (
    <MaintenanceFrame tab="backup" subtitle="Back up, restore and prune checkpoints">
      <p className="help-text">
        A backup is Hermes’s own: it is made, restored and checked by Hermes. Keep one before an update or a config migration, and keep it safe, since it holds your keys.
      </p>
      <div className="mt-cards">
        <BackupSection />
        <RestoreSection onStarted={() => setRestoring(true)} />
        <CheckpointsSection />
      </div>
      {restoring && <RestoreSheet onFinished={() => undefined} onClose={() => setRestoring(false)} />}
    </MaintenanceFrame>
  );
}
