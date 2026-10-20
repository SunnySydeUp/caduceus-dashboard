// Export and import of a profile on the screen (M4 #12). The work is `profile-transfer.ts` and `profile-archive.ts`: this asks for the file,
// shows what is in it and what name it would get, and says how it went. Both actions are Tier 3 (read-only mode blocks them), and Caduceus keeps nothing.
import { useId, useMemo, useState, type ChangeEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { pageTransfer } from './builder-data.ts';
import { ArchiveError, importPreview, readArchive, type ArchiveSummary } from './profile-archive.ts';
import { exportProfile, importProfile } from './profile-transfer.ts';
import type { ProfileCard } from './profiles-model.ts';

/** Hands the archive to the browser as a download. */
function saveAs(archive: Blob, fileName: string): void {
  const url = URL.createObjectURL(archive);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by the time the click returns; the address is only needed until then.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Export for the Danger zone: Hermes writes the archive, the browser downloads it. */
export function ExportProfile({ card }: { card: ProfileCard }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const outcome = await exportProfile(pageTransfer, card.name);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    saveAs(outcome.archive, outcome.fileName);
    toast(`Exported ${card.name}`, { detail: `Hermes also keeps the archive at ${outcome.hermesPath}`, tone: 'info' });
  };
  return (
    <WriteButton type="button" className="btn btn--secondary" disabled={busy} aria-busy={busy} onClick={() => void run()}>
      <Icon name="download" />
      Export {card.name}…
    </WriteButton>
  );
}

type Read = { state: 'none' } | { state: 'reading' } | { state: 'ready'; summary: ArchiveSummary } | { state: 'refused'; message: string };

/** The import sheet: choose the file, read its list, show the name and the conflicts, then import. A full-screen sheet on a phone, a dialog elsewhere. */
export function ImportSheet({ cards, onClose, onImported }: { cards: readonly ProfileCard[]; onClose(): void; onImported(): Promise<void> }) {
  const id = useId();
  const navigate = useAppNavigate();
  const scope = useProfileScope();
  const [file, setFile] = useState<File>();
  const [read, setRead] = useState<Read>({ state: 'none' });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const taken = useMemo(() => cards.map((card) => card.name), [cards]);
  const preview = read.state === 'ready' ? importPreview(read.summary, name, taken) : undefined;
  const root = cards.find((card) => card.isRoot);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setName('');
    setRead({ state: 'reading' });
    try {
      setRead({ state: 'ready', summary: await readArchive(chosen) });
    } catch (error) {
      setRead({ state: 'refused', message: error instanceof ArchiveError ? error.message : 'This file could not be read as an archive.' });
    }
  };

  const submit = async () => {
    if (!file || !preview?.name || preview.problem || !root || busy) return;
    setBusy(true);
    const outcome = await importProfile(pageTransfer, { file, fileName: file.name, name, rootPath: root.path, now: Date.now() }, preview.name);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Imported the profile ${outcome.name}`, { detail: 'Keys are not in an archive: add them to the new profile.' });
    scope.reload();
    await onImported();
    onClose();
    void navigate(`/agents/profiles/${outcome.name}`);
  };

  const summary = read.state === 'ready' ? read.summary : undefined;
  return (
    <Sheet
      title="Import a profile"
      detents={['full']}
      className="bd-sheet"
      initialFocus="input[type=file]"
      onClose={onClose}
      footer={
        <div className="bd-foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="button" className="btn btn--primary" disabled={busy || !preview?.name || preview.problem !== undefined} aria-busy={busy} onClick={() => void submit()}>
            <Icon name="arrow-up" />
            Import profile…
          </WriteButton>
        </div>
      }
    >
      <div className="bd-step">
        <p className="bd-note">Choose an archive that Hermes exported. Nothing is sent to Hermes until you press Import: first this page reads the archive’s list and shows what the profile would be.</p>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-file`}>
            Archive (.tar.gz)
          </label>
          <input id={`${id}-file`} className="input" type="file" accept=".tar.gz,.tgz,application/gzip,application/x-gzip" onChange={(event) => void choose(event)} />
        </div>
        {read.state === 'reading' && <p role="status">Reading the archive…</p>}
        {read.state === 'refused' && (
          <p className="field__error" role="alert">
            <Icon name="alert" small />
            {read.message}
          </p>
        )}
        {summary && preview && (
          <>
            <dl className="bd-facts" aria-label="What is in the archive">
              <div>
                <dt>File</dt>
                <dd>{file?.name}</dd>
              </div>
              <div>
                <dt>Folder</dt>
                <dd className="mono">{summary.roots.join(', ') || 'none'}</dd>
              </div>
              <div>
                <dt>Holds</dt>
                <dd>
                  {summary.files} file{summary.files === 1 ? '' : 's'}
                  {summary.hasConfig ? ', settings' : ''}
                  {summary.hasSoul ? ', a SOUL' : ''}
                  {summary.skills > 0 ? `, ${summary.skills} skill${summary.skills === 1 ? '' : 's'}` : ''}
                </dd>
              </div>
            </dl>
            {summary.soul && <pre className="bd-excerpt" aria-label="Start of the SOUL">{summary.soul}</pre>}
            <div className="field">
              <label className="field__label" htmlFor={`${id}-name`}>
                Import as
              </label>
              <input id={`${id}-name`} className="input input--mono" value={name} placeholder={summary.roots.length === 1 ? summary.roots[0] : ''} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={preview.problem ? true : undefined} aria-describedby={`${id}-name-help ${id}-name-error`} onChange={(event) => setName(event.target.value)} />
              <p className="field__help" id={`${id}-name-help`}>
                {preview.name && !preview.problem ? `Hermes will make the profile “${preview.name}”.` : 'The name of the new profile. Leave it empty to use the archive’s own.'}
              </p>
              <p className="field__error" id={`${id}-name-error`} role="alert">
                {preview.problem && (
                  <>
                    <Icon name="alert" small />
                    {preview.problem}
                  </>
                )}
              </p>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** The Import button, with its sheet, for the Profiles page. */
export function ImportProfile({ cards, reload }: { cards: readonly ProfileCard[]; reload(): Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <WriteButton type="button" className="btn btn--secondary" onClick={() => setOpen(true)}>
        <Icon name="arrow-up" />
        Import profile…
      </WriteButton>
      {open && <ImportSheet cards={cards} onClose={() => setOpen(false)} onImported={reload} />}
    </>
  );
}
