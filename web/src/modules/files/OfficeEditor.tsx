// The Office editor of Workspace › Files (M7 #02): a Word or PowerPoint document as paragraphs of text, an Excel workbook as the cells of its sheets, edited in
// the page and saved over the original. It edits text and values and leaves everything else in the file as it was (`office/office.ts`). A save keeps the
// bytes it replaces as a snapshot first, is refused when the file changed since it was opened, and is a T1 inside a workspace and a T3 elsewhere. On a phone
// the document opens read-only, with an explicit "Edit anyway".
import { useEffect, useMemo, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { fingerprintBytes, saveOffice } from './files-actions.ts';
import { formatSize, type FileEntry } from './files-model.ts';
import type { OfficeKind } from './office/kinds.ts';
import { openOffice, type OfficeDocument, type TextDocument } from './office/office.ts';
import { columnName, type SheetDocument } from './office/sheets.ts';

/** How much of a long document is drawn before "Show more": a spreadsheet can have a million cells. */
const PARAGRAPHS_SHOWN = 200;
const ROWS_SHOWN = 100;
const COLUMNS_SHOWN = 30;

interface Version {
  id: number;
  at: string;
  bytes: number;
}

function Paragraphs({ document, editing, change }: { document: TextDocument; editing: boolean; change(): void }) {
  const [shown, setShown] = useState(PARAGRAPHS_SHOWN);
  const paragraphs = document.paragraphs();
  return (
    <div className="fl-office__paragraphs">
      {paragraphs.slice(0, shown).map((paragraph) => (
        <div key={paragraph.key} className="fl-paragraph">
          {paragraph.where && <span className="fl-paragraph__where subtle">{paragraph.where}</span>}
          {editing ? (
            <>
              <textarea
                className="input fl-paragraph__text"
                aria-label={`${paragraph.where ? `${paragraph.where}, ` : ''}paragraph ${paragraphs.indexOf(paragraph) + 1}`}
                defaultValue={paragraph.text}
                rows={Math.min(8, paragraph.text.split('\n').length + 1)}
                spellCheck
                onChange={(event) => {
                  document.setText(paragraph.key, event.target.value);
                  change();
                }}
              />
              <div className="fl-paragraph__tools">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label={`Add a paragraph below paragraph ${paragraphs.indexOf(paragraph) + 1}`}
                  onClick={() => {
                    document.addAfter(paragraph.key, '');
                    change();
                  }}
                >
                  <Icon name="plus" />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label={`Remove paragraph ${paragraphs.indexOf(paragraph) + 1}`}
                  onClick={() => {
                    if (document.remove(paragraph.key)) change();
                    else toast('This paragraph holds a picture or a section break, or it is the only one here, so it stays.', { tone: 'warning' });
                  }}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </>
          ) : (
            <p className="fl-paragraph__read">{paragraph.text || ' '}</p>
          )}
        </div>
      ))}
      {paragraphs.length > shown && (
        <button type="button" className="btn btn--secondary" onClick={() => setShown((now) => now + PARAGRAPHS_SHOWN)}>
          Show more ({paragraphs.length - shown} left)
        </button>
      )}
    </div>
  );
}

function Sheets({ document, editing, change }: { document: SheetDocument; editing: boolean; change(): void }) {
  const [index, setIndex] = useState(0);
  const [rowsShown, setRowsShown] = useState(ROWS_SHOWN);
  const sheets = document.sheets();
  const sheet = sheets[Math.min(index, sheets.length - 1)];
  if (!sheet) return <p className="subtle">This workbook has no sheets.</p>;
  // One empty row and column past the data, so that a value can be added there.
  const rows = Math.min(sheet.rows + 1, rowsShown);
  const cols = Math.min(sheet.cols + 1, COLUMNS_SHOWN);
  return (
    <div className="fl-office__sheets">
      {sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="fl-sheet-tabs">
          {sheets.map((candidate, at) => (
            <button key={candidate.name} type="button" role="tab" className="btn btn--secondary btn--sm" aria-selected={sheet === candidate} onClick={() => setIndex(at)}>
              {candidate.name}
            </button>
          ))}
        </div>
      )}
      <div className="fl-scroll" tabIndex={0} role="region" aria-label={`Sheet ${sheet.name}`}>
        <table className="fl-sheet">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Row</span>
              </th>
              {Array.from({ length: cols }, (_, col) => (
                <th key={col} scope="col">
                  {columnName(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr key={`${sheet.name}-${row}`}>
                <th scope="row">{row + 1}</th>
                {Array.from({ length: cols }, (_, col) => {
                  const cell = sheet.cell(row, col);
                  const name = `${columnName(col)}${row + 1}`;
                  return (
                    <td key={col}>
                      {editing ? (
                        <input
                          className="input fl-sheet__cell"
                          aria-label={name}
                          defaultValue={cell.input}
                          readOnly={cell.locked === true}
                          title={cell.locked ? 'Part of a shared or array formula: change it in Excel.' : undefined}
                          autoComplete="off"
                          spellCheck={false}
                          onBlur={(event) => {
                            if (event.target.value === cell.input) return;
                            document.setCell(index, row, col, event.target.value);
                            change();
                          }}
                          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                        />
                      ) : (
                        <span className="fl-sheet__read">{cell.text}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.rows + 1 > rowsShown && (
        <button type="button" className="btn btn--secondary" onClick={() => setRowsShown((now) => now + ROWS_SHOWN)}>
          Show more rows ({sheet.rows + 1 - rowsShown} left)
        </button>
      )}
      {sheet.cols + 1 > COLUMNS_SHOWN && <p className="subtle">Only the first {COLUMNS_SHOWN} columns are shown.</p>}
    </div>
  );
}

export function OfficeEditor({ entry, kind, bytes, inWorkspace, profile, compact, onReload, onSaved }: { entry: FileEntry; kind: OfficeKind; bytes: Uint8Array<ArrayBuffer>; inWorkspace: boolean; profile: string | undefined; compact: boolean; onReload(): void; onSaved(): void }) {
  const opened = useMemo((): { document: OfficeDocument } | { problem: string } => {
    try {
      return { document: openOffice(kind, bytes) };
    } catch (error) {
      return { problem: error instanceof Error ? error.message : 'This document could not be opened.' };
    }
  }, [kind, bytes]);
  const [document, setDocument] = useState<OfficeDocument | undefined>('document' in opened ? opened.document : undefined);
  const [base, setBase] = useState<string>();
  const [editing, setEditing] = useState(!compact);
  const [dirty, setDirty] = useState(false);
  const [, redraw] = useState(0);
  /** Counts the documents shown, so that a version opened in the editor replaces what the fields show. */
  const [generation, setGeneration] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  // It asks only when the path changes: the Save… confirmation is a layer on the history, and closing it is not leaving the page.
  const blocker = useBlocker({ shouldBlockFn: ({ current, next }) => dirty && current.pathname !== next.pathname, enableBeforeUnload: () => dirty, withResolver: true });

  useEffect(() => {
    let current = true;
    void fingerprintBytes(bytes).then((sha) => current && setBase(sha));
    return () => {
      current = false;
    };
  }, [bytes]);

  const loadVersions = async (signal?: AbortSignal) => {
    const res = await fetch(`/_caduceus/api/files/office-snapshots?path=${encodeURIComponent(entry.path)}`, { signal }).catch(() => undefined);
    const body: unknown = await res?.json().catch(() => undefined);
    const listed = typeof body === 'object' && body !== null && 'snapshots' in body && Array.isArray(body.snapshots) ? (body.snapshots as Version[]) : [];
    if (!signal?.aborted) setVersions(listed);
  };
  useEffect(() => {
    const controller = new AbortController();
    void loadVersions(controller.signal);
    return () => controller.abort();
  }, [entry.path]);

  const change = () => {
    setDirty(true);
    redraw((now) => now + 1);
  };

  const save = async () => {
    if (!document || base === undefined) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const saved = document.save() as Uint8Array<ArrayBuffer>;
      const outcome = await saveOffice(entry.path, saved, base, inWorkspace, profile);
      if (outcome.kind === 'saved') {
        setBase(outcome.sha256);
        setDirty(false);
        setConflict(false);
        toast(`${entry.name} saved`, { tone: 'success', detail: 'The version it replaced is kept as a snapshot.' });
        void loadVersions();
        onSaved();
      } else if (outcome.kind === 'conflict') setConflict(true);
      else if (outcome.kind === 'failed') setFailure(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  const openVersion = async (version: Version) => {
    const res = await fetch(`/_caduceus/api/files/office-snapshots/${version.id}`).catch(() => undefined);
    if (!res?.ok) return setFailure('Caduceus could not read that version.');
    try {
      setDocument(openOffice(kind, new Uint8Array(await res.arrayBuffer())));
      setGeneration((now) => now + 1);
      setEditing(true);
      change();
      toast('That version is open in the editor. Save to put it back.', { tone: 'info' });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That version could not be opened.');
    }
  };

  const ownDownload = () => {
    if (!document) return;
    const url = URL.createObjectURL(new Blob([document.save() as Uint8Array<ArrayBuffer>]));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = entry.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  if ('problem' in opened || !document) {
    return (
      <p className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">{'problem' in opened ? opened.problem : 'This document could not be opened.'}</span>
      </p>
    );
  }

  return (
    <div className="fl-editor fl-office">
      {blocker.status === 'blocked' && (
        <div className="banner" data-tone="warning" role="alertdialog" aria-labelledby="fl-office-leave">
          <Icon name="alert" />
          <div className="banner__content">
            <strong id="fl-office-leave">Leave without saving?</strong>
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
      {conflict && (
        <section className="banner" data-tone="warning" role="alert" aria-labelledby="fl-office-conflict">
          <Icon name="alert" />
          <div className="banner__content">
            <strong id="fl-office-conflict">{entry.name} changed on disk after you opened it</strong>
            <p>Nothing was saved. Download your version first if you want to keep it, then reload the document to start from what is on disk.</p>
            <div className="row">
              <button type="button" className="btn btn--secondary btn--sm" onClick={ownDownload}>
                <Icon name="download" />
                Download my version
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={onReload}>
                Reload from disk
              </button>
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
      {!editing && (
        <div className="banner" data-tone="info" role="note">
          <Icon name="eye" />
          <span className="banner__content">This is a read-only preview of the text. The editor is made for a larger screen.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(true)}>
            Edit anyway
          </button>
        </div>
      )}
      {document.kind === 'xlsx' ? <Sheets key={generation} document={document} editing={editing} change={change} /> : <Paragraphs key={generation} document={document} editing={editing} change={change} />}
      {editing && (
        <div className="row">
          <WriteButton type="button" className="btn btn--primary" disabled={busy || !dirty || base === undefined} onClick={() => void save()}>
            <Icon name="check" />
            Save…
          </WriteButton>
          <span className="subtle" role="status">
            {dirty ? 'Unsaved changes' : 'No changes'}
          </span>
        </div>
      )}
      <p className="subtle">
        {inWorkspace ? 'This document is in one of your workspaces: saving asks you to confirm.' : 'This document is outside your workspaces (a protected area): saving needs your passkey and the file’s name typed.'} The editor changes text and values; layout, pictures and charts stay as they are.
      </p>
      {versions.length > 0 && (
        <details className="fl-versions">
          <summary>Earlier versions ({versions.length})</summary>
          <ul className="fl-versions__list">
            {versions.map((version) => (
              <li key={version.id}>
                <span>
                  {new Date(version.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {formatSize(version.bytes)}
                </span>
                <a className="btn btn--ghost btn--sm" href={`/_caduceus/api/files/office-snapshots/${version.id}`} download={entry.name}>
                  <Icon name="download" />
                  Download
                </a>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => void openVersion(version)}>
                  Open in the editor
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
