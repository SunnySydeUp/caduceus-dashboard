import { useId, useState, type FormEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { useListing } from '../work/workspace-data.ts';
import { folderProblem } from '../work/workspace-model.ts';
import { RemoteBadge } from './RemoteBadge.tsx';
import { chooseBackend, saveWorkingDirectory } from './terminal-actions.ts';
import { useTerminal } from './terminal-data.ts';
import { remoteWorkspace, type TerminalBackend } from './terminal-model.ts';
import './tools.css';

const STATUS_WORDS = { ready: 'Ready', 'needs-setup': 'Needs setup', unavailable: 'Cannot be checked' } as const;
const STATUS_TONES = { ready: 'success', 'needs-setup': 'warning', unavailable: 'danger' } as const;

/** The profile's terminal: the backends Hermes lists (local, SSH, Docker and the rest) with their readiness, a switch, and the working directory. */
export function TerminalPanel({ profile }: { profile: string }) {
  const view = useTerminal(profile);
  const compact = useSizeClass() === 'compact';
  const [busy, setBusy] = useState<string>();
  const [restartNote, setRestartNote] = useState<string>();
  const data = view.value;
  const remote = remoteWorkspace(data);

  const choose = async (backend: TerminalBackend) => {
    setBusy(backend.name);
    const outcome = await chooseBackend(backend, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    setRestartNote(outcome.body.restartNote);
    await view.reload();
    toast(`${profile} runs its commands on ${backend.label} now`, { detail: backend.status === 'ready' ? 'New sessions use it.' : backend.detail || 'It still needs setup before it works.' });
  };

  return (
    <div className="tl-panel">
      <p className="help-text">
        The <Term id="terminal-backend">terminal backend</Term> decides where the commands and files of <strong>{profile}</strong>’s agent live: on the Mac that runs Hermes, or on another machine or in a container. The choices are the ones Hermes lists. A change reaches new sessions; a chat that is already open keeps its terminal.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its terminal backends could not be listed{data ? ': this is the list from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {restartNote && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="info" />
          <div className="banner__content">
            <div className="banner__title">Restart required</div>
            <div className="banner__body">{restartNote}</div>
          </div>
        </div>
      )}
      {!data && !view.failed && <p role="status">Loading terminal backends…</p>}
      {data && (
        <ul className="tl-cards" aria-label="Terminal backends" data-layout={compact ? 'list' : 'grid'}>
          {data.backends.map((backend) => (
            <li className="tl-card" key={backend.name} data-backend={backend.name}>
              <div className="tl-card__top">
                <div className="tl-card__id">
                  <h3 className="tl-card__name">{backend.label}</h3>
                  <span className="tl-card__key mono">{backend.name}</span>
                </div>
              </div>
              <p className="tl-card__desc">{backend.description}</p>
              <div className="tl-card__tags">
                {backend.active && (
                  <span className="tag" data-tone="info">
                    <Icon name="check" small />
                    Active
                  </span>
                )}
                <span className="tag" data-tone={STATUS_TONES[backend.status]}>
                  {STATUS_WORDS[backend.status]}
                </span>
                {backend.remote && <span className="tag">Remote workspace</span>}
              </div>
              {backend.detail && <p className="tl-note">{backend.detail}</p>}
              {!backend.active && (
                <div className="tl-card__actions">
                  <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-busy={busy === backend.name} onClick={() => void choose(backend)}>
                    <Icon name="terminal" small />
                    Use {backend.label}…
                  </WriteButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && (
        <p className="tl-note">
          The host, user, image and the other settings of a backend are keys under <code className="tl-code">terminal:</code> in the profile’s config: change them in <AppLink to={`/system/config?profile=${encodeURIComponent(profile)}`}>System › Config</AppLink>.
        </p>
      )}
      {data && <WorkingDirectory key={`${profile}:${data.cwd ?? ''}`} profile={profile} saved={data.cwd} remote={remote} reload={view.reload} />}
    </div>
  );
}

function WorkingDirectory({ profile, saved, remote, reload }: { profile: string; saved: string | undefined; remote: ReturnType<typeof remoteWorkspace>; reload(): Promise<void> }) {
  const id = useId();
  const [draft, setDraft] = useState(saved ?? '');
  const [busy, setBusy] = useState(false);
  const typed = draft.trim();
  // Under the local backend Hermes can look at the folder; under a remote one it can only look on its own Mac, which is not where the agent works.
  const { listing, loading } = useListing(remote ? '' : draft);
  const problem = !remote && listing ? folderProblem(listing) : undefined;
  const unchanged = typed === (saved ?? '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (typed === '' || unchanged) return;
    setBusy(true);
    const outcome = await saveWorkingDirectory(typed, profile, remote !== undefined);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`${profile} starts its commands in ${typed}`, { detail: 'New sessions use it.' });
    await reload();
  };

  return (
    <form className="tl-box" onSubmit={(event) => void submit(event)} aria-labelledby={`${id}-title`}>
      <div className="tl-box__head">
        <h3 id={`${id}-title`}>Working directory</h3>
        <RemoteBadge remote={remote} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={id}>
          Folder the terminal starts in
        </label>
        <input id={id} className="input input--mono" value={draft} spellCheck={false} autoCapitalize="none" autoCorrect="off" autoComplete="off" placeholder={remote ? 'A path on the remote machine' : '/Users/you/project'} aria-invalid={problem ? true : undefined} aria-describedby={`${id}-help`} onChange={(event) => setDraft(event.target.value)} />
        <p className="field__help" id={`${id}-help`}>
          {remote
            ? <>A path on {remote.label}, where the agent works: a <Term id="remote-workspace">remote workspace</Term>. Hermes cannot check it from here: it only sees the folders of its own Mac.</>
            : saved
              ? 'A full path on the Mac that runs Hermes. New sessions of this profile start there.'
              : 'A full path on the Mac that runs Hermes. Until you choose one, Hermes starts new sessions in its own default folder.'}
        </p>
        {problem && (
          <p className="field__error" role="alert">
            <Icon name="alert" small />
            {problem}
          </p>
        )}
        {!remote && !problem && loading && typed !== '' && (
          <p className="tl-note" role="status">
            Checking the folder…
          </p>
        )}
      </div>
      <div className="tl-actions">
        <WriteButton type="submit" className="btn btn--primary" disabled={busy || typed === '' || unchanged || problem !== undefined}>
          <Icon name="check" />
          Save folder…
        </WriteButton>
      </div>
    </form>
  );
}
