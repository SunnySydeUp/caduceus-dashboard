// The sheets and buttons that organise Hermes's sessions from the list (M1 #14): a row's menu, rename, move to a project, projects, clean up, and the
// buttons that switch themselves off, with the reason, while read-only mode is on. What they do is `sessions-actions.ts`; everything changed is Hermes's.
import { useEffect, useId, useMemo, useState, type ButtonHTMLAttributes, type FormEvent } from 'react';
import { gatewayConnection } from '../../gateway.ts';
import { Icon, type IconName } from '../../icons.tsx';
import { writeGate } from '../../offline.ts';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { isReadOnly, useReadOnly } from '../../policy-state.ts';
import { useReach } from '../../shell/connection.ts';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { toast } from '../../shell/toasts.ts';
import { fetchTiered } from '../../tiered.ts';
import { createSessionActions, nameOf, type Outcome, type SessionActions } from './sessions-actions.ts';
import type { SessionItem } from './sessions-model.ts';
import type { Worktree } from './worktrees.ts';
import { PROJECT_TONES, type Project, type ProjectTone } from './sessions-projects.ts';

const READ_ONLY_REASON = 'Read-only mode is on, so nothing can be changed. Turn it off in Settings › Security.';

/** Whether a change to Hermes may be made now, and if not, why: read-only mode, then no network or no Caduceus. */
export function useWriteGate(): { allowed: true } | { allowed: false; reason: string } {
  const readOnly = useReadOnly();
  const gate = writeGate(useReach());
  if (readOnly) return { allowed: false, reason: READ_ONLY_REASON };
  return gate.allowed ? { allowed: true } : { allowed: false, reason: gate.reason };
}

/** A button that changes something in Hermes: switched off with its reason, as a tooltip and as text for assistive technology, while it cannot. */
export function ChangeButton({ disabled, title, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const gate = useWriteGate();
  const reasonId = useId();
  if (gate.allowed) {
    return (
      <button {...rest} disabled={disabled} title={title}>
        {children}
      </button>
    );
  }
  return (
    <>
      <button {...rest} disabled aria-describedby={reasonId} title={gate.reason}>
        {children}
      </button>
      <span id={reasonId} className="sr-only">
        {gate.reason}
      </span>
    </>
  );
}

/** The engine of the list's actions, for this tab's profile. */
export function useSessionActions(profile: string): SessionActions {
  return useMemo(() => createSessionActions({ send: fetchTiered, connection: gatewayConnection(), confirm: confirmTier, readOnly: isReadOnly, profile }), [profile]);
}

/**
 * Says how an action ended: a toast, with an Undo for a change Hermes can take back, and a danger toast for a refusal. A declined confirmation says nothing.
 * `settled` runs after every ending that changed (or tried to change) something, and again after an undo: the list reads Hermes again there.
 */
export function report(outcome: Outcome, settled: () => void): void {
  if (outcome.kind === 'cancelled') return;
  if (outcome.kind === 'failed') {
    toast(outcome.message, { tone: 'danger' });
  } else {
    const { undo } = outcome;
    toast(outcome.message, {
      ...(undo === undefined
        ? {}
        : {
            undo: () =>
              void undo().then((back) => {
                if (back.kind === 'failed') toast(back.message, { tone: 'danger' });
                else if (back.kind === 'done') toast(back.message);
                settled();
              }),
          }),
    });
  }
  settled();
}

/** Closes the sheet the action was chosen in, so that the confirmation dialog it may open does not stack on it, then runs the action. */
export function afterSheet(run: () => void): void {
  void closeAllLayers().then(run);
}

export interface MenuEntry {
  id: string;
  icon: IconName;
  label: string;
  sub?: string;
  danger?: boolean;
  /** A change to Hermes: switched off while read-only mode is on. */
  writes: boolean;
  disabled?: string;
  run(): void;
}

export function MenuList({ entries }: { entries: MenuEntry[] }) {
  return (
    <ul className="sl-acts">
      {entries.map((entry) => {
        const body = (
          <>
            <Icon name={entry.icon} />
            <span>
              <span>{entry.label}</span>
              {entry.sub && <small>{entry.sub}</small>}
            </span>
          </>
        );
        const className = `sl-act${entry.danger ? ' sl-act--danger' : ''}`;
        const Button = entry.writes ? ChangeButton : 'button';
        return (
          <li key={entry.id}>
            <Button type="button" className={className} data-act={entry.id} disabled={entry.disabled !== undefined} title={entry.disabled} onClick={entry.run}>
              {body}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export interface RowMenuProps {
  item: SessionItem;
  /** The row's project, when the list is grouped by project and it is in one. */
  project: Project | undefined;
  /** The linked git worktree the session works in, when its workspace is one. */
  worktree: Worktree | undefined;
  archivedView: boolean;
  onClose(): void;
  onPin(): void;
  onArchive(): void;
  onUnread(): void;
  onRename(): void;
  onRegenerateTitle(): void;
  onMove(): void;
  onMoveOut(): void;
  onDuplicate(): void;
  onNewWorktree(): void;
  onRemoveWorktree(): void;
  onExport(): void;
  onShare(): void;
  onSelect(): void;
  onDelete(): void;
}

/** A row's ⋮ menu (and what a long press opens): everything a swipe does, and the rest, so that no action is only a gesture. */
export function RowMenu({ item, project, worktree, archivedView, onClose, onPin, onArchive, onUnread, onRename, onRegenerateTitle, onMove, onMoveOut, onDuplicate, onNewWorktree, onRemoveWorktree, onExport, onShare, onSelect, onDelete }: RowMenuProps) {
  const entries: MenuEntry[] = [
    { id: 'pin', icon: 'pin', label: item.pinned ? 'Unpin' : 'Pin', sub: item.pinned ? undefined : 'Keep it at the top of the list', writes: true, run: onPin },
    { id: 'archive', icon: 'archive', label: item.archived || archivedView ? 'Restore from archive' : 'Archive', sub: item.archived || archivedView ? undefined : 'Out of the list, still in Hermes', writes: true, run: onArchive },
    { id: 'unread', icon: 'eye', label: item.unread ? 'Mark as read' : 'Mark as unread', writes: true, run: onUnread },
    { id: 'rename', icon: 'draft', label: 'Rename…', writes: true, run: onRename },
    { id: 'regenerate-title', icon: 'refresh', label: 'Regenerate title…', sub: 'Ask Hermes’s title model for a new name', writes: true, run: onRegenerateTitle },
    { id: 'move', icon: 'folder', label: 'Move to a project…', writes: true, run: onMove },
    ...(project === undefined ? [] : [{ id: 'move-out', icon: 'x' as const, label: `Take out of ${project.name}`, writes: true, run: onMoveOut }]),
    { id: 'duplicate', icon: 'copy', label: 'Duplicate', sub: 'A new session with every message of this one', writes: true, run: onDuplicate },
    {
      id: 'new-worktree',
      icon: 'git',
      label: 'New session in a worktree…',
      sub: 'A separate copy of the files on a new branch',
      writes: true,
      ...(item.cwd === '' ? { disabled: 'This session has no workspace folder to make a worktree of.' } : {}),
      run: onNewWorktree,
    },
    ...(worktree === undefined ? [] : [{ id: 'remove-worktree', icon: 'trash' as const, label: 'Remove worktree…', sub: 'Deletes the folder this session works in', danger: true, writes: true, run: onRemoveWorktree }]),
    { id: 'export', icon: 'download', label: 'Export…', sub: 'Markdown, a web page or JSON, as a file', writes: false, run: onExport },
    { id: 'share', icon: 'link', label: 'Share link…', sub: 'A read-only copy, for devices on your tailnet', writes: true, run: onShare },
    { id: 'select', icon: 'check', label: 'Select', sub: 'Choose several sessions', writes: false, run: onSelect },
    { id: 'delete', icon: 'trash', label: 'Delete…', sub: 'Hermes cannot bring it back', danger: true, writes: true, run: onDelete },
  ];
  return (
    <Sheet title={nameOf(item)} onClose={onClose}>
      <MenuList entries={entries} />
    </Sheet>
  );
}

/** Renaming a session: the title Hermes keeps. Empty clears it, and the row goes back to the start of the conversation. */
export function RenameSheet({ item, onSave, onClose }: { item: SessionItem; onSave(title: string): void; onClose(): void }) {
  const [title, setTitle] = useState(item.title);
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() !== item.title) onSave(title.trim());
    else onClose();
  };
  return (
    <Sheet title="Rename session" initialFocus="input" onClose={onClose}>
      <form className="field" onSubmit={submit}>
        <label className="field__label" htmlFor={id}>
          Title
        </label>
        <input id={id} className="input" value={title} maxLength={200} placeholder={item.preview || 'Untitled chat'} autoComplete="off" onChange={(event) => setTitle(event.target.value)} />
        <p className="field__help">Leave it empty to go back to the start of the conversation.</p>
        <div className="sl-sheet__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <ChangeButton type="submit" className="btn btn--primary">
            Rename
          </ChangeButton>
        </div>
      </form>
    </Sheet>
  );
}

/** The colours a project can have, as swatches the owner picks one of (or none). */
function ToneChoice({ label, value, onPick }: { label: string; value: ProjectTone | undefined; onPick(tone: ProjectTone | undefined): void }) {
  return (
    <div className="sl-tones" role="radiogroup" aria-label={label}>
      {[undefined, ...PROJECT_TONES].map((tone) => (
        <ChangeButton key={tone ?? 'none'} type="button" role="radio" aria-checked={tone === value} aria-label={tone === undefined ? 'No colour' : tone} className="sl-tone" data-tone={tone} onClick={() => onPick(tone)}>
          {tone === undefined ? <Icon name="x" small /> : <span className="dot" aria-hidden="true" />}
        </ChangeButton>
      ))}
    </div>
  );
}

/** Making a project: a name, the folder its sessions work in, and a colour. Hermes holds it. */
export function NewProjectSheet({ onCreate, onClose }: { onCreate(project: { name: string; folder: string; tone: ProjectTone | undefined }): void; onClose(): void }) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [tone, setTone] = useState<ProjectTone>();
  const nameId = useId();
  const folderId = useId();
  const ready = name.trim() !== '' && folder.trim() !== '';
  return (
    <Sheet title="New project" initialFocus="input" onClose={onClose}>
      <form
        className="sl-sheet__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onCreate({ name, folder, tone });
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor={nameId}>
            Name
          </label>
          <input id={nameId} className="input" value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={folderId}>
            Folder
          </label>
          <input id={folderId} className="input input--mono" value={folder} spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder="/Users/you/work/project" onChange={(event) => setFolder(event.target.value)} />
          <p className="field__help">The folder on the Hermes host that its sessions work in. A session moved into the project goes there.</p>
        </div>
        <div className="field">
          <span className="field__label">Colour</span>
          <ToneChoice label="Colour" value={tone} onPick={setTone} />
        </div>
        <div className="sl-sheet__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <ChangeButton type="submit" className="btn btn--primary" disabled={!ready}>
            Create project…
          </ChangeButton>
        </div>
      </form>
    </Sheet>
  );
}

/** Renaming and recolouring a project, as Hermes keeps it. */
export function ProjectSheet({ project, onRename, onRecolour, onClose }: { project: Project; onRename(name: string): void; onRecolour(tone: ProjectTone | undefined): void; onClose(): void }) {
  const [name, setName] = useState(project.name);
  const id = useId();
  return (
    <Sheet title={`Project ${project.name}`} initialFocus="input" onClose={onClose}>
      <div className="sl-sheet__form">
        <form
          className="field"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== '' && name.trim() !== project.name) onRename(name.trim());
          }}
        >
          <label className="field__label" htmlFor={id}>
            Name
          </label>
          <div className="cfg-inline">
            <input id={id} className="input" value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} />
            <ChangeButton type="submit" className="btn btn--secondary" disabled={name.trim() === '' || name.trim() === project.name}>
              Rename…
            </ChangeButton>
          </div>
        </form>
        <div className="field">
          <span className="field__label">Colour</span>
          <ToneChoice label="Colour" value={project.tone} onPick={(tone) => tone !== project.tone && onRecolour(tone)} />
        </div>
        {project.folder && (
          <p className="field__help">
            Folder: <code>{project.folder}</code>
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** Choosing where sessions go: one of the profile's projects, or out of projects altogether. */
export function MoveSheet({ items, actions, profile, onPick, onNewProject, onMoveOut, onClose }: { items: readonly SessionItem[]; actions: SessionActions; profile: string; onPick(project: Project): void; onNewProject(): void; onMoveOut(): void; onClose(): void }) {
  const [projects, setProjects] = useState<Project[]>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    let current = true;
    actions.listProjects(profile).then(
      (list) => current && setProjects(list.filter((project) => !project.archived)),
      (error: unknown) => current && setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      current = false;
    };
  }, [actions, profile]);
  const what = items.length === 1 ? 'this session' : `${items.length} sessions`;
  return (
    <Sheet title={`Move ${what}`} detents={['half', 'full']} onClose={onClose}>
      <p className="subtle sl-sheet__note">
        A project is a folder in Hermes. Moving {what} to one makes Hermes work in that folder from the next message on.
      </p>
      {problem && (
        <p className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{problem}</span>
        </p>
      )}
      {projects === undefined && !problem && <p className="subtle">Loading projects…</p>}
      {projects !== undefined && projects.length === 0 && <p className="subtle">This profile has no projects yet.</p>}
      <ul className="sl-acts">
        {(projects ?? []).map((project) => (
          <li key={project.id}>
            <ChangeButton type="button" className="sl-act" data-act="project" disabled={project.folder === undefined} title={project.folder === undefined ? 'This project has no folder yet. Give it one in Hermes first.' : undefined} onClick={() => onPick(project)}>
              <span className="sl-dot" data-tone={project.tone ?? 'neutral'} aria-hidden="true" />
              <span>
                <span>{project.name}</span>
                <small className="mono">{project.folder ?? 'No folder yet'}</small>
              </span>
            </ChangeButton>
          </li>
        ))}
        <li>
          <ChangeButton type="button" className="sl-act" data-act="new-project" onClick={onNewProject}>
            <Icon name="plus" />
            <span>New project…</span>
          </ChangeButton>
        </li>
        <li>
          <ChangeButton type="button" className="sl-act" data-act="out" onClick={onMoveOut}>
            <Icon name="x" />
            <span>
              <span>No project</span>
              <small>Hermes’s default folder</small>
            </span>
          </ChangeButton>
        </li>
      </ul>
    </Sheet>
  );
}

/** The toolbar's clean up: delete the empty sessions, and prune the old ones. Both count first, and neither is done from here: Hermes's own confirmation comes next. */
export function CleanUpSheet({ actions, profile, onEmpty, onPrune, onClose }: { actions: SessionActions; profile: string; onEmpty(): void; onPrune(days: number): void; onClose(): void }) {
  const [empty, setEmpty] = useState<number | string>();
  const [days, setDays] = useState('90');
  const [matched, setMatched] = useState<string>();
  const daysId = useId();
  const age = Number(days);
  const valid = Number.isFinite(age) && age >= 1;
  useEffect(() => {
    let current = true;
    actions.countEmpty(profile).then(
      (count) => current && setEmpty(count),
      (error: unknown) => current && setEmpty(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      current = false;
    };
  }, [actions, profile]);
  useEffect(() => setMatched(undefined), [days]);
  const count = async () => {
    const preview = await actions.previewPrune(profile, { olderThanDays: age });
    setMatched(preview.kind === 'previewed' ? `${preview.matched} session${preview.matched === 1 ? '' : 's'} ended more than ${age} day${age === 1 ? '' : 's'} ago.` : preview.message);
  };
  return (
    <Sheet title="Clean up" onClose={onClose}>
      <div className="sl-sheet__form">
        <section className="field">
          <h3 className="field__label">Empty sessions</h3>
          <p className="field__help">Chats that ended with no messages in them.</p>
          <p aria-live="polite">{empty === undefined ? 'Counting…' : typeof empty === 'string' ? empty : `${empty} empty session${empty === 1 ? '' : 's'} in ${profile}.`}</p>
          <ChangeButton type="button" className="btn btn--secondary" data-act="delete-empty" disabled={typeof empty !== 'number' || empty === 0} onClick={onEmpty}>
            <Icon name="trash" small />
            Delete empty sessions…
          </ChangeButton>
        </section>
        <section className="field">
          <h3 className="field__label">Prune old sessions</h3>
          <label className="field__help" htmlFor={daysId}>
            Delete ended sessions that were last active more than this many days ago.
          </label>
          <div className="cfg-inline">
            <input id={daysId} className="input mono" type="number" inputMode="numeric" min={1} step={1} value={days} onChange={(event) => setDays(event.target.value)} />
            <button type="button" className="btn btn--secondary" disabled={!valid} onClick={() => void count()}>
              Count
            </button>
          </div>
          {matched && <p aria-live="polite">{matched}</p>}
          <ChangeButton type="button" className="btn btn--danger-quiet" data-act="prune" disabled={!valid} onClick={() => onPrune(age)}>
            <Icon name="trash" small />
            Prune…
          </ChangeButton>
        </section>
      </div>
    </Sheet>
  );
}
