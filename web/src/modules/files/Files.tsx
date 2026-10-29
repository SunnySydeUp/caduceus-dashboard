import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useParams } from '@tanstack/react-router';
import { Icon, type IconName } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { useWorkspaceRegistry } from '../work/projects-data.ts';
import { FilePreview } from './FilePreview.tsx';
import { deleteEntry, makeFolder, moveEntry, renameEntry, uploadFiles } from './files-actions.ts';
import { useFolder, useWorkspaceCheck } from './files-data.ts';
import { crumbs, downloadUrl, filesUrl, formatSize, nameProblem, parentOf, pathFromSplat, previewKind, splitHidden, underWorkspace, type FileEntry } from './files-model.ts';
import { MovePicker } from './MovePicker.tsx';
import '../profiles/profiles.css';
import './files.css';

/** Entries drawn before "Show more": a home folder can hold thousands. */
const PAGE = 200;

const KIND_ICON: Record<string, IconName> = { directory: 'folder', image: 'camera', code: 'code', markdown: 'book', csv: 'rows', html: 'browser' };

function iconOf(entry: FileEntry): IconName {
  return entry.directory ? 'folder' : (KIND_ICON[previewKind(entry.name)] ?? 'file');
}

function modifiedWords(modified: number | undefined): string {
  return modified === undefined ? '' : new Date(modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface MenuAction {
  id: string;
  icon: IconName;
  label: string;
  sub?: string;
  danger?: boolean;
  href?: { url: string; download: string };
  run?(): void;
}

/** A row's ⋮ menu, as a sheet (mobile spec §2: nothing is hover-only, nothing is swipe-only). */
function EntryMenu({ entry, actions, onClose }: { entry: FileEntry; actions: MenuAction[]; onClose(): void }) {
  return (
    <Sheet title={entry.name} onClose={onClose}>
      <ul className="pf-acts">
        {actions.map((action) => (
          <li key={action.id}>
            {action.href ? (
              <a className="pf-act" href={action.href.url} download={action.href.download} onClick={onClose}>
                <Icon name={action.icon} />
                <span>
                  <span>{action.label}</span>
                  {action.sub && <small>{action.sub}</small>}
                </span>
              </a>
            ) : (
              <button
                type="button"
                className={`pf-act${action.danger ? ' pf-act--danger' : ''}`}
                onClick={() => {
                  onClose();
                  void closeAllLayers().then(action.run);
                }}
              >
                <Icon name={action.icon} />
                <span>
                  <span>{action.label}</span>
                  {action.sub && <small>{action.sub}</small>}
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function NewFolder({ parent, onCreate, onClose }: { parent: string; onCreate(name: string): void; onClose(): void }) {
  const id = useId();
  const [name, setName] = useState('');
  const bad = name.trim() === '' || /[\\/]/.test(name) || name === '.' || name === '..';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!bad) onCreate(name.trim());
  };
  return (
    <Sheet title="New folder" initialFocus={`#${CSS.escape(id)}`} onClose={onClose}>
      <form className="stack fl-form" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor={id}>
            Folder name
          </label>
          <input id={id} className="input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className="subtle">
            Created in <span className="fl-wrap">{parent}</span>. A name, not a path.
          </p>
        </div>
        <div className="row">
          <WriteButton type="submit" className="btn btn--primary" disabled={bad}>
            Create folder…
          </WriteButton>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function RenameSheet({ entry, onRename, onClose }: { entry: FileEntry; onRename(name: string): void; onClose(): void }) {
  const id = useId();
  const [name, setName] = useState(entry.name);
  const problem = nameProblem(name);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!problem) onRename(name);
  };
  return (
    <Sheet title={`Rename ${entry.name}`} initialFocus={`#${CSS.escape(id)}`} onClose={onClose}>
      <form className="stack fl-form" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor={id}>
            New name
          </label>
          <input id={id} className="input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${id}-hint`} aria-invalid={problem !== undefined && name !== entry.name} />
          <p id={`${id}-hint`} className="subtle">
            {problem && name !== entry.name ? problem : 'It stays in the same folder. A name that is already taken is refused, never overwritten.'}
          </p>
        </div>
        <div className="row">
          <WriteButton type="submit" className="btn btn--primary" disabled={problem !== undefined || name === entry.name}>
            Rename
          </WriteButton>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** The screen: the folder on one side and the preview of a file on the other (a phone shows one at a time). */
export function Files() {
  const params = useParams({ strict: false }) as { _splat?: string };
  const path = pathFromSplat(params._splat);
  const { folder, reload } = useFolder(path);
  const { effective } = useProfileScope();
  const profile = effective?.name;
  const navigate = useAppNavigate();
  const compact = useSizeClass() === 'compact';
  const picker = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<FileEntry>();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<FileEntry>();
  const [moving, setMoving] = useState<FileEntry>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [showHidden, setShowHidden] = useState(false);
  // The workspaces Caduceus knows decide the tier of a text save; the server decides in the end.
  const registry = useWorkspaceRegistry();
  const workspaces = useMemo(() => (registry.value ?? []).map((workspace) => workspace.path), [registry.value]);
  const addWorkspace = async (folderPath: string) => {
    const outcome = await registry.client.add(folderPath);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast('Added as a workspace', { detail: 'Changes in this folder now ask only for a confirmation.' });
      registry.reload();
    }
  };
  useEffect(() => setShown(PAGE), [path]);

  const ready = folder.state === 'ready' ? folder : undefined;
  const here = ready?.listing.path;
  const selected = ready?.selected;
  const rootPath = path === undefined ? here : undefined;
  const rememberedRoot = useRef<string | undefined>(undefined);
  if (rootPath) rememberedRoot.current = rootPath;
  const atRoot = here !== undefined && (path === undefined || here === rememberedRoot.current);

  const { shown: unhidden, hidden: hiddenCount } = useMemo(() => splitHidden(ready?.listing.entries ?? [], showHidden), [ready, showHidden]);
  const sorted = unhidden;
  const visible = useMemo(() => sorted.slice(0, shown), [sorted, shown]);
  // Only a folder outside every workspace asks the guard; the answer is the guard's own.
  const workspaceCheck = useWorkspaceCheck(here, here !== undefined && registry.value !== undefined && !underWorkspace(here, workspaces));

  const upload = async (files: File[]) => {
    if (!here || files.length === 0) return;
    setBusy(true);
    try {
      const outcome = await uploadFiles(here, files, profile, underWorkspace(here, workspaces));
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind === 'done') toast(outcome.body.uploaded === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${outcome.body.uploaded} files`, { tone: 'success', detail: here });
      if (outcome.kind !== 'cancelled') await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: FileEntry, contents = false) => {
    const outcome = await deleteEntry(entry, profile, contents, underWorkspace(entry.path, workspaces));
    if (outcome.kind === 'failed') {
      const notEmpty = entry.directory && !contents && /not empty|409/i.test(outcome.message);
      toast(notEmpty ? `${entry.name} is not empty.` : outcome.message, { tone: 'danger', ...(notEmpty ? { action: { label: 'Delete with everything in it…', onClick: () => void remove(entry, true) } } : {}) });
    }
    if (outcome.kind === 'done') {
      toast(`Deleted ${entry.name}`, { tone: 'success' });
      if (selected?.path === entry.path) void navigate(filesUrl(here));
    }
    if (outcome.kind !== 'cancelled') await reload();
  };

  const create = async (name: string) => {
    if (!here) return;
    setCreating(false);
    await closeAllLayers();
    const outcome = await makeFolder(`${here.replace(/\/+$/, '')}/${name}`, profile, underWorkspace(here, workspaces));
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') toast(`Created ${name}`, { tone: 'success' });
    if (outcome.kind !== 'cancelled') await reload();
  };

  /** Renames in place (a T0 in a workspace, a T3 elsewhere): the toast's Undo is the same call with the old name. */
  const rename = async (entry: FileEntry, name: string) => {
    setRenaming(undefined);
    await closeAllLayers();
    if (name === entry.name) return;
    const outcome = await renameEntry(entry.path, name, profile, underWorkspace(entry.path, workspaces));
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      const { from, to } = outcome.body;
      toast(`Renamed ${entry.name} to ${name}`, {
        tone: 'success',
        action: {
          label: 'Undo',
          onClick: () =>
            void renameEntry(to, entry.name, profile, underWorkspace(to, workspaces)).then(async (undone) => {
              toast(undone.kind === 'done' ? `Renamed back to ${entry.name}` : undone.kind === 'failed' ? undone.message : 'Not renamed back', { tone: undone.kind === 'failed' ? 'danger' : 'success' });
              if (undone.kind === 'done' && selected?.path === to) void navigate(filesUrl(from));
              await reload();
            }),
        },
      });
      if (selected?.path === entry.path) void navigate(filesUrl(to));
    }
    if (outcome.kind !== 'cancelled') await reload();
  };

  const move = async (entry: FileEntry, destination: string) => {
    setMoving(undefined);
    await closeAllLayers();
    const outcome = await moveEntry(entry, destination, profile, underWorkspace(entry.path, workspaces) && underWorkspace(destination, workspaces));
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast(`Moved ${entry.name}`, { tone: 'success', detail: `Into ${destination}` });
      if (selected?.path === entry.path) void navigate(filesUrl(here));
    }
    if (outcome.kind !== 'cancelled') await reload();
  };

  const actionsOf = (entry: FileEntry): MenuAction[] => [
    { id: 'open', icon: entry.directory ? 'folder' : 'eye', label: entry.directory ? 'Open folder' : 'Preview', run: () => void navigate(filesUrl(entry.path)) },
    ...(entry.directory ? [] : [{ id: 'download', icon: 'download' as const, label: 'Download', sub: entry.size === undefined ? undefined : formatSize(entry.size), href: { url: downloadUrl(entry.path), download: entry.name } }]),
    { id: 'copy', icon: 'copy', label: 'Copy path', sub: entry.path, run: () => void navigator.clipboard?.writeText(entry.path).then(() => toast('Copied the path'), () => toast('Could not copy: this browser did not allow it', { tone: 'warning' })) },
    { id: 'rename', icon: 'type', label: 'Rename…', sub: entry.name, run: () => setRenaming(entry) },
    { id: 'move', icon: 'arrow-r', label: 'Move to…', run: () => setMoving(entry) },
    { id: 'delete', icon: 'trash', label: entry.directory ? 'Delete folder…' : 'Delete…', danger: true, run: () => void remove(entry) },
  ];

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void upload([...event.dataTransfer.files]);
  };

  const showPreview = selected !== undefined;
  const showList = !compact || !showPreview;

  return (
    <div className="fl" data-preview={showPreview ? 'open' : 'closed'}>
      <PageHeader
        overline="Workspace"
        title="Files"
        subtitle={
          <>
            Your files. Some places are <Term id="protected-area">protected</Term>: changing them needs your passkey.
          </>
        }
      />
      {folder.state === 'loading' && <p role="status">Loading…</p>}
      {folder.state === 'failed' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{folder.message}</span>
          <AppLink className="btn btn--secondary btn--sm" to={folder.back === undefined ? FILES_HOME : filesUrl(folder.back)}>
            {folder.back === undefined ? 'Back to the top' : 'Back to the folder'}
          </AppLink>
        </div>
      )}
      {ready && (
        <div className="fl-split">
          {showList && (
            <section className="fl-browser" data-dragging={dragging || undefined} aria-label="Folder" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
              <div className="fl-bar">
                <nav aria-label="Folder path" className="fl-crumbs">
                  <AppLink to={FILES_HOME}>{rememberedRoot.current ? rememberedRoot.current.split('/').filter(Boolean).at(-1) || 'Top' : 'Top'}</AppLink>
                  {crumbs(here!).filter((crumb) => !rememberedRoot.current || (crumb.path.length > rememberedRoot.current.length && crumb.path.startsWith(rememberedRoot.current))).map((crumb) => (
                    <span key={crumb.path}>
                      <span aria-hidden="true"> / </span>
                      <AppLink to={filesUrl(crumb.path)} aria-current={crumb.path === here ? 'page' : undefined}>
                        {crumb.name}
                      </AppLink>
                    </span>
                  ))}
                </nav>
                <div className="fl-tools">
                  {hiddenCount > 0 && (
                    <button type="button" className="btn btn--ghost btn--sm" aria-pressed={showHidden} onClick={() => setShowHidden((now) => !now)}>
                      <Icon name="eye" />
                      Show hidden{showHidden ? '' : ` (${hiddenCount})`}
                    </button>
                  )}
                  {!atRoot && (
                    <AppLink className="btn btn--secondary btn--sm" to={filesUrl(parentOf(here!))}>
                      <Icon name="folder" />
                      Up
                    </AppLink>
                  )}
                  <input ref={picker} type="file" multiple hidden onChange={(event) => { void upload([...(event.target.files ?? [])]); event.target.value = ''; }} />
                  <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => picker.current?.click()}>
                    <Icon name="arrow-up" />
                    Upload…
                  </WriteButton>
                  <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => setCreating(true)}>
                    <Icon name="plus" />
                    New folder…
                  </WriteButton>
                </div>
              </div>
              {registry.value !== undefined && !underWorkspace(here!, workspaces) && (
                <div className="banner" data-tone="info" role="note">
                  <Icon name="folder" />
                  <div className="banner__content stack">
                    <span>This folder is not in a workspace, so changing things here needs your passkey and a typed name each time.</span>
                    {workspaceCheck?.ok === true && (
                      <>
                        <span>Add it as a workspace and changes here only ask you to confirm.</span>
                        <span>
                          <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => void addWorkspace(here!)}>
                            Add this folder as a workspace
                          </WriteButton>
                        </span>
                      </>
                    )}
                    {workspaceCheck?.ok === false && <span>{workspaceCheck.message}</span>}
                  </div>
                </div>
              )}
              {sorted.length === 0 ? (
                <div className="empty">
                  <span className="empty__icon">
                    <Icon name="folder" />
                  </span>
                  <p>{hiddenCount > 0 ? `Nothing to show here except ${hiddenCount} hidden ${hiddenCount === 1 ? 'item' : 'items'}. Use Show hidden to see ${hiddenCount === 1 ? 'it' : 'them'}.` : 'This folder is empty. Drop files here, or:'}</p>
                  <div className="row">
                    <WriteButton type="button" className="btn btn--primary" onClick={() => picker.current?.click()}>
                      <Icon name="arrow-up" />
                      Upload…
                    </WriteButton>
                    <WriteButton type="button" className="btn btn--secondary" onClick={() => setCreating(true)}>
                      <Icon name="plus" />
                      New folder…
                    </WriteButton>
                  </div>
                </div>
              ) : (
                <ul className="fl-list" data-compact={compact || undefined}>
                  {!compact && (
                    <li className="fl-head" aria-hidden="true">
                      <span>Name</span>
                      <span>Size</span>
                      <span>Modified</span>
                      <span />
                    </li>
                  )}
                  {visible.map((entry) => (
                    <li key={entry.path} className="fl-row" data-selected={selected?.path === entry.path || undefined}>
                      <AppLink className="fl-row__name" to={filesUrl(entry.path)} aria-current={selected?.path === entry.path ? 'true' : undefined}>
                        <Icon name={iconOf(entry)} />
                        <span className="fl-row__text">{entry.name}</span>
                      </AppLink>
                      <span className="fl-row__size">{entry.directory ? '' : entry.size === undefined ? '' : formatSize(entry.size)}</span>
                      <span className="fl-row__time">{modifiedWords(entry.modified)}</span>
                      <button type="button" className="btn btn--ghost btn--icon" aria-label={`Actions for ${entry.name}`} aria-haspopup="dialog" onClick={() => setMenu(entry)}>
                        <Icon name="dots-v" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {sorted.length > shown && (
                <button type="button" className="btn btn--secondary" onClick={() => setShown((now) => now + PAGE)}>
                  Show more ({sorted.length - shown} left)
                </button>
              )}
            </section>
          )}
          {selected && <FilePreview entry={selected} workspaces={workspaces} profile={profile} onClose={() => void navigate(filesUrl(here))} onChanged={() => void reload()} />}
        </div>
      )}
      {menu && <EntryMenu entry={menu} actions={actionsOf(menu)} onClose={() => setMenu(undefined)} />}
      {creating && here && <NewFolder parent={here} onCreate={(name) => void create(name)} onClose={() => setCreating(false)} />}
      {renaming && <RenameSheet entry={renaming} onRename={(name) => void rename(renaming, name)} onClose={() => setRenaming(undefined)} />}
      {moving && <MovePicker entry={moving} start={parentOf(moving.path)} onMove={(destination) => void move(moving, destination)} onClose={() => setMoving(undefined)} />}
    </div>
  );
}

/** The managed root's own address. */
const FILES_HOME = filesUrl(undefined);
