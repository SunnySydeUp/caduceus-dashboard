// The workspace registry on Work › Projects (M3 #10): Caduceus's own list of named directories, offered in the composer's workspace chip and the Brief
// editor. Add (checked against the allowed folders and Hermes's file list), rename, reorder (↑ and ↓, or drag) and remove. Removing an entry never
// touches the folder. This is the only thing on the page Caduceus keeps; the projects above it are Hermes's.
import { useState, type DragEvent } from 'react';
import type { Workspace } from '@caduceus/contracts/caduceus-api';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { useWorkspaceRegistry } from './projects-data.ts';
import { AddWorkspaceSheet, RenameSheet } from './ProjectSheets.tsx';
import { moveItem, moveItemTo } from './template-model.ts';

export function Workspaces() {
  const { value: entries, error, reload, client } = useWorkspaceRegistry();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Workspace>();
  const [dragging, setDragging] = useState<string>();
  const [announce, setAnnounce] = useState('');
  const ids = entries?.map((entry) => entry.id) ?? [];

  const reorder = async (next: string[], moved: Workspace) => {
    const outcome = await client.reorder(next);
    if (outcome.kind === 'failed') return toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setAnnounce(`${moved.name} is now number ${next.indexOf(moved.id) + 1} of ${next.length}.`);
    reload();
  };

  const remove = async (entry: Workspace) => {
    const outcome = await client.remove(entry);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') return toast(outcome.message, { tone: 'danger' });
    toast(`Removed the workspace “${entry.name}”`, { tone: 'info', detail: 'The folder and its files were not touched.' });
    reload();
  };

  const drop = (event: DragEvent, target: string) => {
    event.preventDefault();
    const moved = entries?.find((entry) => entry.id === dragging);
    if (moved && moved.id !== target) void reorder(moveItemTo(ids, moved.id, target), moved);
    setDragging(undefined);
  };

  return (
    <section className="sb__section pj__workspaces" aria-labelledby="pj-workspaces">
      <div className="row pj__head">
        <h2 id="pj-workspaces">Workspaces</h2>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          Add workspace
        </button>
      </div>
      <p className="subtle">
        A <Term id="workspace">workspace</Term> is a folder you name here so that the composer’s workspace chip and the Brief editor can offer it. Caduceus keeps this list; the folders and their files are never changed by it. Removing a workspace only forgets its name.
      </p>
      {error && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">The workspaces could not be read: {error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={reload}>
            Try again
          </button>
        </div>
      )}
      {!error && entries === undefined && <p role="status">Loading the workspaces…</p>}
      {entries && entries.length === 0 && (
        <div className="empty">
          <Icon name="folder" />
          <h3>No workspaces yet</h3>
          <p>Add a folder you work in often, and it is one tap away when you write a message or a task.</p>
        </div>
      )}
      {entries && entries.length > 0 && (
        <ol className="pj__ws">
          {entries.map((entry, index) => (
            <li key={entry.id} className="pj__wsrow" draggable onDragStart={() => setDragging(entry.id)} onDragEnd={() => setDragging(undefined)} onDragOver={(event) => dragging !== undefined && event.preventDefault()} onDrop={(event) => drop(event, entry.id)} data-dragging={dragging === entry.id || undefined}>
              <Icon name="grip" />
              <span className="pj__wsname">
                <strong>{entry.name}</strong>
                <span className="mono subtle pj__wspath">{entry.path}</span>
              </span>
              <span className="pj__wsactions">
                <WriteButton type="button" className="btn btn--ghost btn--icon" aria-label={`Move ${entry.name} up`} disabled={index === 0} onClick={() => void reorder(moveItem(ids, entry.id, -1), entry)}>
                  <Icon name="chev-u" />
                </WriteButton>
                <WriteButton type="button" className="btn btn--ghost btn--icon" aria-label={`Move ${entry.name} down`} disabled={index === entries.length - 1} onClick={() => void reorder(moveItem(ids, entry.id, 1), entry)}>
                  <Icon name="chev-d" />
                </WriteButton>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setRenaming(entry)}>
                  Rename<span className="sr-only"> {entry.name}</span>
                </button>
                <WriteButton type="button" className="btn btn--ghost btn--sm" onClick={() => void remove(entry)}>
                  <Icon name="trash" />
                  Remove<span className="sr-only"> {entry.name}</span>
                </WriteButton>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="sr-only" role="status">
        {announce}
      </p>
      {adding && <AddWorkspaceSheet client={client} onDone={reload} onClose={() => setAdding(false)} />}
      {renaming && (
        <RenameSheet
          title="Rename workspace"
          initial={renaming.name}
          max={60}
          onClose={() => setRenaming(undefined)}
          save={async (name) => {
            const outcome = await client.rename(renaming, name);
            if (outcome.kind === 'failed') return outcome.message;
            if (outcome.kind === 'done') reload();
            return undefined;
          }}
        />
      )}
    </section>
  );
}
