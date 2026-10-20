import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { CodeBlock, Rich } from '../chat/Rich.tsx';
import { lineDiff } from '../profiles/behaviour-files.ts';
import { saveText } from './files-actions.ts';
import { usePreview, type Preview } from './files-data.ts';
import { downloadUrl, formatSize, htmlFrame, isEditable, parseCsv, previewKind, sortRows, underWorkspace, type FileEntry } from './files-model.ts';
import { officeKindOf } from './office/kinds.ts';

/** The Office editor and the zip reader behind it load only when a document is opened. */
const OfficeEditor = lazy(() => import('./OfficeEditor.tsx').then((m) => ({ default: m.OfficeEditor })));

function CsvTable({ text }: { text: string }) {
  const rows = useMemo(() => parseCsv(text), [text]);
  const [sort, setSort] = useState<{ column: number; direction: 'asc' | 'desc' }>();
  const [header = [], ...body] = rows;
  const shown = sort ? sortRows(body, sort.column, sort.direction) : body;
  if (rows.length === 0) return <p className="subtle">This file is empty.</p>;
  return (
    <div className="fl-scroll" tabIndex={0} role="region" aria-label="Table">
      <table className="fl-csv">
        <thead>
          <tr>
            {header.map((cell, column) => (
              <th key={column} scope="col" aria-sort={sort?.column === column ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="fl-csv__sort" onClick={() => setSort(sort?.column === column && sort.direction === 'asc' ? { column, direction: 'desc' } : { column, direction: 'asc' })}>
                  {cell || `Column ${column + 1}`}
                  {sort?.column === column && <Icon name={sort.direction === 'asc' ? 'check' : 'x'} />}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={index}>
              {header.map((_, column) => (
                <td key={column}>{row[column] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Editor({ entry, original, inWorkspace, profile, onDone, onSaved }: { entry: FileEntry; original: string; inWorkspace: boolean; profile: string | undefined; onDone(): void; onSaved(): void }) {
  const [text, setText] = useState(original);
  const [base, setBase] = useState(original);
  const [conflict, setConflict] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const dirty = text !== base;
  // What the blocker asks must be true at the moment of the question: a save reloads the file inside the same event, before the state it set has rendered, so
  // the `dirty` of that render would still say "unsaved" and the page would ask whether to leave right after a successful save.
  const unsaved = useRef(false);
  unsaved.current = dirty;
  const blocker = useBlocker({ shouldBlockFn: () => unsaved.current, enableBeforeUnload: () => unsaved.current, withResolver: true });

  const save = async (against = base) => {
    setBusy(true);
    setFailure(undefined);
    try {
      const outcome = await saveText(entry.path, text, against, inWorkspace, profile);
      if (outcome.kind === 'saved') {
        setConflict(undefined);
        setBase(text);
        unsaved.current = false;
        toast(`${entry.name} saved`, { tone: 'success', detail: 'The text it replaced is kept as a snapshot.' });
        onSaved();
      } else if (outcome.kind === 'conflict') setConflict(outcome.current);
      else if (outcome.kind === 'failed') setFailure(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  const rows = conflict === undefined ? [] : lineDiff(conflict, text);
  return (
    <div className="fl-editor">
      {blocker.status === 'blocked' && (
        <div className="banner" data-tone="warning" role="alertdialog" aria-labelledby="fl-leave">
          <Icon name="alert" />
          <div className="banner__content">
            <strong id="fl-leave">Leave without saving?</strong>
            <p>Your edits to {entry.name} will be lost.</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn--primary btn--sm" autoFocus onClick={() => blocker.reset?.()}>
              Keep editing
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => blocker.proceed?.()}>
              Discard
            </button>
          </div>
        </div>
      )}
      {conflict !== undefined && (
        <section className="banner" data-tone="warning" role="alert" aria-labelledby="fl-conflict">
          <Icon name="alert" />
          <div className="banner__content">
            <strong id="fl-conflict">{entry.name} changed on disk after you opened it</strong>
            <p>Nothing was saved. Below is what is on disk now (red) and what you typed (green). Reload the file to start from what is on disk.</p>
            <pre className="fl-diff" tabIndex={0} aria-label="Differences between the file on disk and your text">
              {rows.length === 0 ? '(no differences)' : rows.map((row, index) => (
                <span key={index} className="fl-diff__row" data-kind={row.kind}>
                  {row.kind === 'removed' ? '− ' : row.kind === 'added' ? '+ ' : '  '}
                  {row.text}
                  {'\n'}
                </span>
              ))}
            </pre>
            <div className="row">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setText(conflict);
                  setBase(conflict);
                  setConflict(undefined);
                }}
              >
                Reload from disk
              </button>
              <WriteButton type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void save(conflict)}>
                Save my text over it…
              </WriteButton>
            </div>
          </div>
        </section>
      )}
      {failure && (
        <p className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{failure}</span>
        </p>
      )}
      <textarea className="input input--mono fl-textarea" aria-label={`Text of ${entry.name}`} value={text} spellCheck={false} autoCapitalize="none" autoCorrect="off" onChange={(event) => setText(event.target.value)} />
      <div className="row">
        <WriteButton type="button" className="btn btn--primary" disabled={busy || !dirty} onClick={() => void save()}>
          <Icon name="check" />
          Save…
        </WriteButton>
        <button type="button" className="btn btn--secondary" onClick={onDone}>
          {dirty ? 'Discard changes' : 'Close editor'}
        </button>
        <span className="subtle" role="status">
          {dirty ? 'Unsaved changes' : 'No changes'}
        </span>
      </div>
      <p className="subtle">
        {inWorkspace ? 'This file is in one of your workspaces: saving asks you to confirm.' : 'This file is outside your workspaces (a protected area): saving needs your passkey and the file’s name typed.'}
      </p>
    </div>
  );
}

function Body({ entry, preview, source }: { entry: FileEntry; preview: Preview; source: boolean }) {
  const kind = previewKind(entry.name);
  const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase() : '';
  switch (preview.state) {
    case 'loading':
      return <p role="status">Loading…</p>;
    case 'failed':
      return (
        <p className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{preview.message}</span>
        </p>
      );
    case 'download':
      return (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="file" />
          </span>
          <p>{preview.why === 'too-large' ? `This file is ${formatSize(entry.size ?? 0)}, too big to open here.` : 'This file is not text, so there is nothing to show here.'}</p>
          <a className="btn btn--primary" href={downloadUrl(entry.path)} download={entry.name}>
            <Icon name="download" />
            Download ({formatSize(entry.size ?? 0)})
          </a>
        </div>
      );
    case 'pdf':
      return <iframe className="fl-frame" src={preview.src} title={`${entry.name} (PDF)`} />;
    case 'media':
      if (kind === 'audio') return <audio className="fl-media" controls preload="metadata" src={preview.src} aria-label={entry.name} />;
      if (kind === 'video') return <video className="fl-media" controls preload="metadata" src={preview.src} aria-label={entry.name} />;
      return <img className="fl-image" src={preview.src} alt={entry.name} />;
    case 'text': {
      if (kind === 'markdown' && !source) return <Rich text={preview.text} anchor="file" />;
      if (kind === 'csv' && !source) return <CsvTable text={preview.text} />;
      if (kind === 'html' && !source) {
        const frame = htmlFrame(preview.text);
        return <iframe className="fl-frame" sandbox={frame.sandbox} srcDoc={frame.srcDoc} title={`${entry.name} (HTML preview)`} />;
      }
      return <CodeBlock lang={kind === 'markdown' || kind === 'html' || kind === 'csv' ? (kind === 'html' ? 'html' : kind) : extension} text={preview.text} open={false} />;
    }
  }
}

/** One file: its preview by kind, a Download action and, for text, an editor. */
export function FilePreview({ entry, workspaces, profile, onClose, onChanged }: { entry: FileEntry; workspaces: readonly string[]; profile: string | undefined; onClose(): void; onChanged(): void }) {
  const kind = previewKind(entry.name);
  const { preview, reload } = usePreview(entry, kind);
  const compact = useSizeClass() === 'compact';
  /** The text the editor was opened with, while it is open. */
  const [editFrom, setEditFrom] = useState<string>();
  const [source, setSource] = useState(false);
  const switchable = kind === 'markdown' || kind === 'csv' || kind === 'html';

  useEffect(() => {
    setEditFrom(undefined);
    setSource(false);
  }, [entry.path]);

  const editing = editFrom !== undefined;
  const canEdit = isEditable(kind) && preview.state === 'text';
  return (
    <section className="fl-preview" aria-label={`Preview of ${entry.name}`}>
      <header className="fl-preview__head">
        <button type="button" className="btn btn--ghost btn--icon fl-preview__back" aria-label="Back to the folder" onClick={onClose}>
          <Icon name="x" />
        </button>
        <div className="fl-preview__title">
          <h2>{entry.name}</h2>
          <span className="subtle">{entry.size === undefined ? '' : formatSize(entry.size)}</span>
        </div>
        <div className="fl-preview__actions">
          {switchable && preview.state === 'text' && !editing && (
            <button type="button" className="btn btn--secondary btn--sm" aria-pressed={source} onClick={() => setSource((now) => !now)}>
              {source ? 'Show preview' : 'Show source'}
            </button>
          )}
          {canEdit && !editing && (
            <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => preview.state === 'text' && setEditFrom(preview.text)}>
              <Icon name="type" />
              Edit
            </WriteButton>
          )}
          <a className="btn btn--secondary btn--sm" href={downloadUrl(entry.path)} download={entry.name}>
            <Icon name="download" />
            Download
          </a>
        </div>
      </header>
      <div className="fl-preview__body">
        {editFrom !== undefined ? (
          <Editor
            entry={entry}
            original={editFrom}
            inWorkspace={underWorkspace(entry.path, workspaces)}
            profile={profile}
            onDone={() => setEditFrom(undefined)}
            onSaved={() => {
              reload();
              onChanged();
            }}
          />
        ) : preview.state === 'office' && officeKindOf(entry.name) ? (
          <Suspense fallback={<p role="status">Loading the editor…</p>}>
            <OfficeEditor
              entry={entry}
              kind={officeKindOf(entry.name)!}
              bytes={preview.bytes}
              inWorkspace={underWorkspace(entry.path, workspaces)}
              profile={profile}
              compact={compact}
              onReload={reload}
              onSaved={onChanged}
            />
          </Suspense>
        ) : (
          <Body entry={entry} preview={preview} source={source} />
        )}
      </div>
    </section>
  );
}
