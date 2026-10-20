// Step 3: the default workspace. The choices are Caduceus's workspace registry (Work › Projects: named folders on the Mac that runs Hermes); the default is
// Hermes's own `terminal.cwd` of the profile, the folder its agent starts in, so it is written to Hermes by the Terminal screen's action (Tier 3: the
// profile's name is typed) and read back from Hermes. Caduceus keeps no copy.
import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { saveWorkingDirectory } from '../tools/terminal-actions.ts';
import { remoteWorkspace } from '../tools/terminal-model.ts';
import { useTerminal } from '../tools/terminal-data.ts';
import { useWorkspaceRegistry } from '../work/projects-data.ts';
import { AddWorkspaceSheet } from '../work/ProjectSheets.tsx';

export function StepWorkspace({ profile }: { profile: string }) {
  const { value: entries, error, reload, client } = useWorkspaceRegistry();
  const terminal = useTerminal(profile);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string>();
  const current = terminal.value?.cwd;
  const remote = remoteWorkspace(terminal.value);

  const choose = async (path: string) => {
    setBusy(path);
    const outcome = await saveWorkingDirectory(path, profile, remote !== undefined);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`The ${profile} profile now starts in ${path}`, { detail: 'New sessions use it.' });
    await terminal.reload();
  };

  return (
    <div className="stack">
      <p>
        Choose the folder your agent starts in. It is picked from your <Term id="workspace">workspaces</Term>, the folders you have named in Caduceus. Hermes keeps the choice for this profile, so saving it is a <Term id="risk-tiers">Tier 3</Term> action: you confirm with a passkey and type the profile’s name. You can leave this step and set it later in Agents › Tools.
      </p>
      <p className="ob-summary" role="status">
        {terminal.value === undefined ? (terminal.failed ? 'Hermes did not say where its agent starts.' : 'Asking Hermes…') : current ? <>The {profile} profile’s agent starts in <span className="mono">{current}</span>{remote ? ` on ${remote.label}` : ''}.</> : `No default folder is set for the ${profile} profile: Hermes uses the folder it was started in.`}
      </p>
      {error && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">The workspaces could not be read: {error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={reload}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {entries && entries.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="folder" />
          </span>
          <p>You have no workspaces yet.</p>
          <p>Add the folder you work in most, then make it the default.</p>
        </div>
      )}
      {entries && entries.length > 0 && (
        <ul className="ob-checks panel" aria-label="Workspaces">
          {entries.map((entry) => {
            const isDefault = current !== undefined && current.replace(/\/+$/, '') === entry.path.replace(/\/+$/, '');
            return (
              <li key={entry.id} className="ob-check" data-state={isDefault ? 'pass' : undefined}>
                <div className="ob-check__head">
                  <span className="ob-check__label">{entry.name}</span>
                  {isDefault && (
                    <span className="tag" data-tone="accent">
                      Default
                    </span>
                  )}
                </div>
                <p className="ob-check__detail mono">{entry.path}</p>
                {!isDefault && (
                  <WriteButton type="button" className="btn btn--secondary btn--sm ob-check__fix" disabled={busy !== undefined || terminal.value === undefined} aria-busy={busy === entry.path} aria-label={`Use as default folder: ${entry.name}`} onClick={() => void choose(entry.path)}>
                    Use as default
                  </WriteButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <button type="button" className="btn btn--secondary" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          Add a workspace
        </button>
      </div>
      {adding && <AddWorkspaceSheet client={client} onDone={reload} onClose={() => setAdding(false)} />}
    </div>
  );
}
