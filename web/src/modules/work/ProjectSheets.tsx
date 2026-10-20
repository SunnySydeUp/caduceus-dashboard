// The sheets of Work › Projects: a new project, a rename, Discover repos and an added workspace. Each confirms through the policy (the dialogs
// are the shared tiered ones) and says what Hermes or Caduceus answered; the page reads again afterwards.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { Field } from './FormParts.tsx';
import type { ProfileProjects, ProjectActions } from './projects-actions.ts';
import { readJson } from './projects-data.ts';
import type { RepoCandidate } from './projects-model.ts';
import { scanFolder } from './projects-scan.ts';
import { FolderPicker } from './WorkspaceField.tsx';
import { isAbsolutePath, useListing } from './workspace-data.ts';
import { folderProblem } from './workspace-model.ts';
import type { WorkspaceRegistryClient } from './workspace-registry.ts';

/** The folder field: typed or browsed, checked against Hermes as it is typed. `value` and `onChange` are the path. */
export function FolderField({ label, help, value, onChange, error }: { label: string; help: string; value: string; onChange(path: string): void; error?: string }) {
  const [browsing, setBrowsing] = useState(false);
  const { listing, loading } = useListing(value);
  const problem = listing && folderProblem(listing);
  const shown = problem ?? error;
  return (
    <>
      <Field label={label} help={help} error={shown}>
        {(aria) => (
          <div className="ws__path">
            <input {...aria} className="input input--mono" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
            <button type="button" className="btn btn--secondary" onClick={() => setBrowsing(true)}>
              <Icon name="folder" />
              Browse
            </button>
          </div>
        )}
      </Field>
      {!shown && loading && (
        <p className="ws__status" role="status">
          Checking the folder…
        </p>
      )}
      {!shown && listing?.kind === 'folder' && (
        <p className="ws__status" role="status" data-tone="ok">
          <Icon name="check" small />
          This folder exists.
        </p>
      )}
      {browsing && (
        <FolderPicker
          start={listing?.kind === 'folder' ? value.trim() : undefined}
          onPick={(picked) => {
            onChange(picked);
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  );
}

/** Makes a project of a name and a folder. */
export function NewProjectSheet({ profile, actions, onDone, onClose }: { profile: string; actions: ProjectActions; onDone(): void; onClose(): void }) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') return setProblem('Give the project a name.');
    if (!isAbsolutePath(folder.trim())) return setProblem('Give the full path of the project’s folder, such as /Users/you/project.');
    setBusy(true);
    const outcome = await actions.create(profile, { name, folder });
    setBusy(false);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') return setProblem(outcome.message);
    toast(`Made the project “${name.trim()}”`, { tone: 'success' });
    onDone();
    onClose();
  };
  return (
    <Sheet title="New project" initialFocus="input" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Name" error={problem && name.trim() === '' ? problem : undefined}>
          {(aria) => <input {...aria} className="input" value={name} maxLength={80} autoComplete="off" onChange={(event) => setName(event.target.value)} />}
        </Field>
        <FolderField label="Folder" help={`The folder on the Mac that runs Hermes that the project’s sessions work in. Hermes keeps the project in the profile ${profile}.`} value={folder} onChange={setFolder} error={problem && name.trim() !== '' ? problem : undefined} />
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            Create project
          </WriteButton>
        </div>
      </form>
    </Sheet>
  );
}

/** Asks for one new name (a project's, a workspace's). `save` answers `undefined` when it worked, `'cancelled'` when the owner declined, or the problem in words. */
export function RenameSheet({ title, initial, max, save, onClose }: { title: string; initial: string; max: number; save(name: string): Promise<string | undefined>; onClose(): void }) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') return setProblem('Give it a name.');
    if (name.trim() === initial) return onClose();
    setBusy(true);
    const outcome = await save(name.trim());
    setBusy(false);
    if (outcome === 'cancelled') return;
    if (outcome !== undefined) return setProblem(outcome);
    onClose();
  };
  return (
    <Sheet title={title} initialFocus="input" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={id}>
            Name
          </label>
          <input id={id} className="input" value={name} maxLength={max} autoComplete="off" aria-invalid={problem ? true : undefined} aria-describedby={`${id}-error`} onChange={(event) => setName(event.target.value)} />
          <p className="field__error" id={`${id}-error`} role="alert">
            {problem && (
              <>
                <Icon name="alert" small />
                {problem}
              </>
            )}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            Rename
          </WriteButton>
        </div>
      </form>
    </Sheet>
  );
}

/** What Discover repos shows: Hermes's candidates plus those the owner looked for in a folder. */
export function DiscoverSheet({ profile, actions, owned, startFolder, onDone, onClose }: { profile: string; actions: ProjectActions; owned: ProfileProjects | undefined; startFolder: string | undefined; onDone(): void; onClose(): void }) {
  const [found, setFound] = useState<RepoCandidate[]>();
  const [failure, setFailure] = useState<string>();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [folder, setFolder] = useState(startFolder ?? '');
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let current = true;
    actions.discover(profile).then(
      (repos) => current && setFound(repos),
      (error: unknown) => current && setFailure(error instanceof Error ? error.message : 'Hermes did not answer.'),
    );
    return () => {
      current = false;
    };
  }, [actions, profile, round]);

  const taken = (path: string) => owned?.folders.get(path);
  const choose = (path: string, on: boolean) => setChosen((previous) => new Set(on ? [...previous, path] : [...previous].filter((entry) => entry !== path)));

  const scan = async () => {
    setScanning(true);
    setScanNote(undefined);
    try {
      const result = await scanFolder(folder.trim(), (route) => readJson(route));
      if (result.problem) return setScanNote(result.problem);
      setFound((previous) => {
        const known = new Set((previous ?? []).map((repo) => repo.path));
        return [...(previous ?? []), ...result.repos.filter((repo) => !known.has(repo.path))];
      });
      setScanNote(result.repos.length === 0 ? 'No repositories directly inside this folder.' : `Found ${result.repos.length} ${result.repos.length === 1 ? 'repository' : 'repositories'} in this folder.${result.truncated ? ' It has more folders than were checked.' : ''}`);
    } catch (error) {
      setScanNote(error instanceof Error ? error.message : 'Hermes did not answer.');
    } finally {
      setScanning(false);
    }
  };

  const add = async () => {
    const repos = (found ?? []).filter((repo) => chosen.has(repo.path));
    setBusy(true);
    const outcome = await actions.addRepos(profile, repos);
    setBusy(false);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') return toast(outcome.message, { tone: 'danger' });
    if (outcome.failed.length > 0) toast(`Added ${outcome.made}; Hermes refused ${outcome.failed.length}`, { tone: 'warning', detail: outcome.failed.join(' ') });
    else toast(`Added ${outcome.made} ${outcome.made === 1 ? 'project' : 'projects'}`, { tone: 'success' });
    onDone();
    onClose();
  };

  return (
    <Sheet
      title="Discover repos"
      detents={['full']}
      onClose={onClose}
      footer={
        <WriteButton type="button" className="btn btn--primary" disabled={busy || chosen.size === 0} aria-busy={busy} onClick={() => void add()}>
          {chosen.size === 0 ? 'Add as projects' : `Add ${chosen.size} as ${chosen.size === 1 ? 'a project' : 'projects'}`}
        </WriteButton>
      }
    >
      <div className="stack pj-discover">
        <p className="subtle">
          Hermes lists the repositories its sessions worked in and those in the folders its <span className="mono">desktop.repo_scan_roots</span> setting names. To look somewhere else, choose a folder: the repositories directly inside it are added to the list.
        </p>
        <div className="pj-discover__scan">
          <FolderField label="Look in a folder" help="Each folder inside it is checked, one level deep." value={folder} onChange={setFolder} />
          <button type="button" className="btn btn--secondary" disabled={scanning || !isAbsolutePath(folder.trim())} aria-busy={scanning} onClick={() => void scan()}>
            <Icon name="search" />
            Look here
          </button>
        </div>
        {scanNote && (
          <p className="ws__status" role="status">
            {scanNote}
          </p>
        )}
        {failure && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">Hermes did not list its repositories: {failure}</span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setFailure(undefined);
                setRound((previous) => previous + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {!failure && found === undefined && <p role="status">Asking Hermes…</p>}
        {found && found.length === 0 && <p className="subtle">Hermes found no repositories yet. Choose a folder above to look in it.</p>}
        {found && found.length > 0 && (
          <ul className="pj-discover__list" aria-label="Repositories">
            {found.map((repo) => {
              const existing = taken(repo.path);
              const id = `repo-${repo.path}`;
              return (
                <li key={repo.path} className="pj-discover__row">
                  <input id={id} type="checkbox" className="pj-discover__check" checked={chosen.has(repo.path)} disabled={existing !== undefined} onChange={(event) => choose(repo.path, event.target.checked)} />
                  <label htmlFor={id} className="pj-discover__label">
                    <span className="pj-discover__name">{repo.label}</span>
                    <span className="mono subtle pj-discover__path">{repo.path}</span>
                    <span className="subtle pj-discover__meta">{existing !== undefined ? `Already the project “${existing}”` : repo.sessions > 0 ? `${repo.sessions} ${repo.sessions === 1 ? 'session' : 'sessions'} worked here` : 'No sessions yet'}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** Adds a folder to the workspace registry. */
export function AddWorkspaceSheet({ client, onDone, onClose }: { client: WorkspaceRegistryClient; onDone(): void; onClose(): void }) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAbsolutePath(path.trim())) return setProblem('Give the full path of a folder, such as /Users/you/project.');
    setBusy(true);
    const outcome = await client.add(path, name);
    setBusy(false);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') return setProblem(outcome.message);
    toast(`Added the workspace “${outcome.body.name}”`, { tone: 'success' });
    onDone();
    onClose();
  };
  return (
    <Sheet title="Add a workspace" initialFocus="input" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
        <FolderField label="Folder" help="A folder on the Mac that runs Hermes, inside the folders Caduceus lets Hermes work in." value={path} onChange={setPath} error={problem} />
        <Field label="Name (optional)" help="Shown in the composer and the Brief editor. The folder’s name is used when this is empty.">
          {(aria) => <input {...aria} className="input" value={name} maxLength={60} autoComplete="off" onChange={(event) => setName(event.target.value)} />}
        </Field>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            Add workspace
          </WriteButton>
        </div>
      </form>
    </Sheet>
  );
}
