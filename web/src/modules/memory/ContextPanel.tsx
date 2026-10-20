import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Rich } from '../chat/Rich.tsx';
import { useDefaultFolder, useListing } from '../work/workspace-data.ts';
import { folderProblem } from '../work/workspace-model.ts';
import { FolderPicker } from '../work/WorkspaceField.tsx';
import { useProjectFacts, useTextFile } from './memory-data.ts';
import '../chat/chat.css';
import './memory.css';

function ContextFile({ path, name }: { path: string; name: string }) {
  const file = useTextFile(path);
  return (
    <section className="mm-box" aria-label={name}>
      <h3 className="mono">{name}</h3>
      {file === undefined && <p role="status">Reading {name}…</p>}
      {file === null && <p className="mm-note">Hermes did not give this file’s text.</p>}
      {file && file.binary && <p className="mm-note">This file is not text.</p>}
      {file && !file.binary && (
        <>
          {file.text.trim() === '' ? <p className="subtle">The file is empty.</p> : <Rich text={file.text} anchor={`context-${name}`} />}
          {file.truncated && <p className="mm-note">Hermes sent only the start of this large file.</p>}
        </>
      )}
    </section>
  );
}

/** The project context the agent gets for a folder: what Hermes detects there (`project.facts`) and the context files it reads, shown read-only. */
export function ContextPanel({ profile }: { profile: string }) {
  const fallback = useDefaultFolder();
  const [typed, setTyped] = useState<string>();
  const [picking, setPicking] = useState(false);
  const folder = typed ?? fallback ?? '';
  const pathId = useId();
  const { listing } = useListing(folder);
  const problem = listing && folderProblem(listing);
  const facts = useProjectFacts(listing?.kind === 'folder' ? folder : '', profile);

  return (
    <div className="mm-panel">
      <p className="help-text">
        Project context is what Hermes finds in a folder the agent works in: its manifests, package managers, the commands that check the work, and context files such as AGENTS.md that go into the prompt. It is read from Hermes and cannot be edited here.
      </p>
      <div className="mm-path">
        <div className="field">
          <label className="field__label" htmlFor={pathId}>
            Folder
          </label>
          <input id={pathId} className="input input--mono" value={folder} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={problem ? true : undefined} />
          {problem && (
            <p className="field__error" role="alert">
              <Icon name="alert" small />
              {problem}
            </p>
          )}
          <p className="field__help">A full path on the computer that runs Hermes. It starts at the folder Hermes starts in.</p>
        </div>
        <div className="mm-actions">
          <button type="button" className="btn btn--secondary" onClick={() => setPicking(true)}>
            <Icon name="folder" />
            Browse
          </button>
        </div>
      </div>
      {listing?.kind === 'folder' && facts === undefined && <p role="status">Asking Hermes about this folder…</p>}
      {facts === null && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="folder" />
          </span>
          <p>Hermes finds no project here. A folder counts once it is a git repository or has a manifest such as package.json or pyproject.toml. Add an AGENTS.md to give the agent standing instructions for the project.</p>
        </div>
      )}
      {facts && (
        <>
          <dl className="mm-facts" aria-label="Project facts">
            <dt>Root</dt>
            <dd className="mono">{facts.root}</dd>
            <dt>Manifests</dt>
            <dd>{facts.manifests.length > 0 ? facts.manifests.join(', ') : 'None'}</dd>
            <dt>Package managers</dt>
            <dd>{facts.packageManagers.length > 0 ? facts.packageManagers.join(', ') : 'None'}</dd>
            <dt>Check commands</dt>
            <dd className="mono">{facts.verifyCommands.length > 0 ? facts.verifyCommands.join(', ') : 'None found'}</dd>
            <dt>Context files</dt>
            <dd>{facts.contextFiles.length > 0 ? facts.contextFiles.join(', ') : 'None: add an AGENTS.md to the project to give the agent instructions.'}</dd>
          </dl>
          {facts.contextFiles.map((name) => (
            <ContextFile key={`${facts.root}/${name}`} path={`${facts.root}/${name}`} name={name} />
          ))}
        </>
      )}
      {picking && (
        <FolderPicker
          start={listing?.kind === 'folder' ? folder : undefined}
          onPick={(picked) => {
            setTyped(picked);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

