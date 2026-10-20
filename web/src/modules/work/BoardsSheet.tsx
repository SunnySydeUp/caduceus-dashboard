// The board switcher: Hermes's boards, and what the owner can do with them — create, rename, archive (with Undo), switch, export and import. A board's
// address is its slug, which Hermes never changes. Everything is Hermes's: this sheet only asks, and the list is read again after each change.
import { useId, useState, type FormEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { archiveBoard, createBoard, exportBoard, importBoard, makeCurrent, renameBoard } from './board-actions.ts';
import { boardSlugProblem, downloadPath, importSlugFor, slugFromName, type BoardSummary } from './board-ops.ts';
import './board-ops.css';

type Screen = { kind: 'list' } | { kind: 'create' } | { kind: 'rename'; board: BoardSummary } | { kind: 'import' } | { kind: 'exported'; file: string; name: string };

/** What the list needs from the page. */
export interface BoardsSheetProps {
  boards: readonly BoardSummary[];
  /** The board the page shows: its address, or `undefined` for the current one. */
  shown: BoardSummary | undefined;
  /** Opens a board (its address goes into the URL). */
  onOpen(slug: string): void;
  /** Reads Hermes's list again. */
  onChanged(): void;
  /** Hermes wrote an export; the page shows where it is (this sheet has closed with the confirmation). */
  onExported(file: string, name: string): void;
  onClose(): void;
}

function TextField({ label, help, error, value, onChange, mono, ...rest }: { label: string; help?: string; error?: string; value: string; onChange(value: string): void; mono?: boolean; name: string; autoFocus?: boolean; placeholder?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className={`input${mono ? ' mono' : ''}`} autoComplete="off" autoCapitalize="none" spellCheck={false} value={value} aria-invalid={error ? true : undefined} aria-describedby={`${id}-help`} onChange={(event) => onChange(event.target.value)} {...rest} />
      <p id={`${id}-help`} className={error ? 'field__error' : 'field__help'}>
        {error ?? help}
      </p>
    </div>
  );
}

function CreateForm({ onDone, onBack }: { onDone(slug: string): void; onBack(): void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [typedSlug, setTypedSlug] = useState(false);
  const [description, setDescription] = useState('');
  const address = typedSlug ? slug : slugFromName(name);
  const problem = address === '' ? undefined : boardSlugProblem(address);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '' || address === '' || problem) return;
    await closeAllLayers();
    const outcome = await createBoard({ slug: address, name, description });
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast(`Created the board “${name.trim()}”.`);
      onDone(outcome.body.slug);
    }
  };
  return (
    <form className="bo-form" onSubmit={(event) => void submit(event)}>
      <TextField name="name" label="Name" value={name} onChange={setName} autoFocus />
      <TextField name="slug" label="Address" mono value={address} onChange={(value) => { setSlug(value); setTypedSlug(true); }} error={problem} help="Used in the web address and by Hermes’s command line. It cannot be changed later." />
      <TextField name="description" label="What it is for (optional)" value={description} onChange={setDescription} />
      <div className="bo-form__bar">
        <button type="button" className="btn btn--secondary" onClick={onBack}>
          Back
        </button>
        <WriteButton type="submit" className="btn btn--primary" disabled={name.trim() === '' || address === '' || problem !== undefined}>
          Create board
        </WriteButton>
      </div>
    </form>
  );
}

function RenameForm({ board, onDone, onBack }: { board: BoardSummary; onDone(): void; onBack(): void }) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const changed = name.trim() !== board.name || description.trim() !== board.description;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!changed || name.trim() === '') return;
    await closeAllLayers();
    const outcome = await renameBoard(board.slug, { ...(name.trim() !== board.name ? { name: name.trim() } : {}), ...(description.trim() !== board.description ? { description: description.trim() } : {}) });
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast(`Renamed the board to “${name.trim()}”.`);
      onDone();
    }
  };
  return (
    <form className="bo-form" onSubmit={(event) => void submit(event)}>
      <TextField name="name" label="Name" value={name} onChange={setName} autoFocus />
      <TextField name="description" label="What it is for" value={description} onChange={setDescription} />
      <p className="field__help">
        Its address, <span className="mono">{board.slug}</span>, stays.
      </p>
      <div className="bo-form__bar">
        <button type="button" className="btn btn--secondary" onClick={onBack}>
          Back
        </button>
        <WriteButton type="submit" className="btn btn--primary" disabled={!changed || name.trim() === ''}>
          Save
        </WriteButton>
      </div>
    </form>
  );
}

function ImportForm({ onDone, onBack }: { onDone(slug: string): void; onBack(): void }) {
  const [archive, setArchive] = useState('');
  const [slug, setSlug] = useState('');
  const [typedSlug, setTypedSlug] = useState(false);
  const address = typedSlug ? slug : importSlugFor(archive);
  const problem = address === '' ? undefined : boardSlugProblem(address);
  const ready = archive.trim().startsWith('/') && address !== '' && !problem;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    await closeAllLayers();
    const outcome = await importBoard(archive, address);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast(`Imported the board as ${outcome.body.slug}.`);
      onDone(outcome.body.slug);
    }
  };
  return (
    <form className="bo-form" onSubmit={(event) => void submit(event)}>
      <p className="subtle">Imports a board that Hermes exported, as a new board. The file is on the Mac that runs Hermes, so give its full path; an export you made here shows its path.</p>
      <TextField name="archive" label="Path of the file" mono value={archive} onChange={setArchive} placeholder="/Users/you/.hermes/kanban/board-exports/…tar.gz" error={archive.trim() !== '' && !archive.trim().startsWith('/') ? 'Use the full path, starting with /.' : undefined} autoFocus />
      <TextField name="slug" label="Address of the new board" mono value={address} onChange={(value) => { setSlug(value); setTypedSlug(true); }} error={problem} help="You type this to confirm. If it is taken, Hermes adds a number." />
      <div className="bo-form__bar">
        <button type="button" className="btn btn--secondary" onClick={onBack}>
          Back
        </button>
        <WriteButton type="submit" className="btn btn--primary" disabled={!ready}>
          Import board
        </WriteButton>
      </div>
    </form>
  );
}

/** The switcher, as a sheet on a phone and a dialog elsewhere. */
export function BoardsSheet({ boards, shown, onOpen, onChanged, onExported, onClose }: BoardsSheetProps) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const back = () => setScreen({ kind: 'list' });
  const opened = (slug: string) => {
    onChanged();
    onOpen(slug);
  };

  const exportShown = async (board: BoardSummary) => {
    await closeAllLayers();
    const outcome = await exportBoard(board.slug, board.name);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') onExported(outcome.body.file, board.name);
  };

  const title = screen.kind === 'create' ? 'New board' : screen.kind === 'rename' ? 'Rename board' : screen.kind === 'import' ? 'Import a board' : 'Boards';
  return (
    <Sheet title={title} detents={['auto', 'full']} onClose={onClose}>
          {screen.kind === 'create' && <CreateForm onBack={back} onDone={opened} />}
          {screen.kind === 'rename' && <RenameForm board={screen.board} onBack={back} onDone={() => { onChanged(); back(); }} />}
          {screen.kind === 'import' && <ImportForm onBack={back} onDone={opened} />}
          {screen.kind === 'list' && (
            <div className="bo-boards">
              <div className="plist" role="radiogroup" aria-label="Board">
                {boards.map((board) => (
                  <button key={board.slug} type="button" role="radio" aria-checked={board.slug === shown?.slug} className="plist__row" data-board={board.slug} onClick={() => { onOpen(board.slug); onClose(); }}>
                    <Icon name="stack" />
                    <span className="plist__main">
                      <span className="plist__name">{board.name}</span>
                      <span className="subtle bo-hint">
                        <span className="mono">{board.slug}</span>
                        {board.isCurrent ? ' · Hermes’s current board' : ''}
                        {board.description ? ` · ${board.description}` : ''}
                      </span>
                    </span>
                    <span className="mono subtle">{board.total}</span>
                    <span className="plist__check">{board.slug === shown?.slug && <Icon name="check" />}</span>
                  </button>
                ))}
              </div>
              <div className="bo-boards__acts">
                <WriteButton type="button" className="btn btn--secondary" onClick={() => setScreen({ kind: 'create' })}>
                  <Icon name="plus" />
                  New board…
                </WriteButton>
                <WriteButton type="button" className="btn btn--secondary" onClick={() => setScreen({ kind: 'import' })}>
                  <Icon name="download" />
                  Import…
                </WriteButton>
              </div>
              {shown && (
                <section aria-labelledby="bo-this" className="bo-boards__this">
                  <h3 id="bo-this" className="overline">
                    {shown.name}
                  </h3>
                  <div className="bo-boards__acts">
                    <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => setScreen({ kind: 'rename', board: shown })}>
                      Rename…
                    </WriteButton>
                    {!shown.isCurrent && (
                      <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => void closeAllLayers().then(() => makeCurrent(shown.slug)).then(onChanged)}>
                        Make current in Hermes
                      </WriteButton>
                    )}
                    <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => void exportShown(shown)}>
                      Export…
                    </WriteButton>
                    <WriteButton
                      type="button"
                      className="btn btn--danger-quiet btn--sm"
                      disabled={shown.slug === 'default'}
                      title={shown.slug === 'default' ? 'Hermes always keeps its default board.' : undefined}
                      onClick={() =>
                        void closeAllLayers().then(async () => {
                          const outcome = await archiveBoard(shown.slug, shown.name, opened);
                          if (outcome.kind === 'done') {
                            onChanged();
                            onOpen('');
                          }
                        })
                      }
                    >
                      Archive…
                    </WriteButton>
                  </div>
                  {shown.slug === 'default' && <p className="subtle bo-fine">Hermes always keeps its default board, so it cannot be archived.</p>}
                </section>
              )}
            </div>
          )}
    </Sheet>
  );
}

/** Where Hermes wrote an export: the path on its Mac, to copy, and the file to download. */
export function ExportedSheet({ file, name, onClose }: { file: string; name: string; onClose(): void }) {
  return (
    <Sheet title="Exported board" onClose={onClose}>
      <div className="bo-form">
        <p>Hermes wrote “{name}” to a file on the Mac that runs it. Download it, or import it elsewhere with this path:</p>
        <p className="mono bo-path">{file}</p>
        <div className="bo-form__bar">
          <button type="button" className="btn btn--secondary" onClick={() => void navigator.clipboard?.writeText(file).then(() => toast('Path copied.'))}>
            <Icon name="copy" />
            Copy path
          </button>
          <a className="btn btn--primary" href={downloadPath(file)} download={file.split('/').pop()}>
            <Icon name="download" />
            Download
          </a>
        </div>
      </div>
    </Sheet>
  );
}
