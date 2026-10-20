// "Move to…" in Workspace › Files (M7 #02): a sheet that walks through the folders of the managed root and names the one to move a file or folder into. It
// reads the same folder listing the screen does, so it can reach only what the screen can; the server checks the destination again.
import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { crumbs, listUrl, parentOf, parseListing, type FileEntry, type Listing } from './files-model.ts';

type Shown = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; listing: Listing };

export function MovePicker({ entry, start, onMove, onClose }: { entry: FileEntry; start: string; onMove(destination: string): void; onClose(): void }) {
  const [folder, setFolder] = useState(start);
  const [shown, setShown] = useState<Shown>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setShown({ state: 'loading' });
    fetch(listUrl(folder), { signal: controller.signal }).then(
      async (res) => {
        const body: unknown = await res.json().catch(() => undefined);
        const listing = res.ok ? parseListing(body) : undefined;
        if (controller.signal.aborted) return;
        if (listing) setShown({ state: 'ready', listing });
        else {
          const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' ? body.message : `Hermes answered HTTP ${res.status}.`;
          setShown({ state: 'failed', message });
        }
      },
      () => !controller.signal.aborted && setShown({ state: 'failed', message: 'Caduceus did not answer, so the folder could not be read.' }),
    );
    return () => controller.abort();
  }, [folder]);

  const folders = shown.state === 'ready' ? shown.listing.entries.filter((candidate) => candidate.directory && candidate.path !== entry.path) : [];
  // A folder cannot go into itself, and a move into the folder it is already in changes nothing.
  const inside = entry.directory && (folder === entry.path || folder.startsWith(`${entry.path}/`));
  const same = folder === parentOf(entry.path);
  const reason = inside ? 'A folder cannot be moved into itself.' : same ? 'It is already in this folder.' : undefined;

  return (
    <Sheet title={`Move ${entry.name} to…`} onClose={onClose}>
      <div className="stack">
        <nav aria-label="Destination folder" className="fl-crumbs">
          {crumbs(folder).map((crumb) => (
            <span key={crumb.path}>
              <span aria-hidden="true"> / </span>
              <button type="button" className="btn btn--ghost btn--sm fl-crumb" aria-current={crumb.path === folder ? 'page' : undefined} onClick={() => setFolder(crumb.path)}>
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
        {shown.state === 'loading' && <p role="status">Loading…</p>}
        {shown.state === 'failed' && (
          <p className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">{shown.message}</span>
          </p>
        )}
        {shown.state === 'ready' && (
          <ul className="pf-acts" aria-label="Folders here">
            {folders.length === 0 && <li className="subtle">No folders in here.</li>}
            {folders.map((candidate) => (
              <li key={candidate.path}>
                <button type="button" className="pf-act" onClick={() => setFolder(candidate.path)}>
                  <Icon name="folder" />
                  <span>{candidate.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="subtle">Into {folder}. A name that is already taken there stops the move.</p>
        {reason && <p className="subtle">{reason}</p>}
        <div className="row">
          <WriteButton type="button" className="btn btn--primary" disabled={shown.state !== 'ready' || reason !== undefined} onClick={() => onMove(folder)}>
            Move here…
          </WriteButton>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Sheet>
  );
}
