// System › Maintenance › Updates (M5 #12): whether Hermes and Caduceus have a newer version, Update for each (Tier 2: Caduceus drains, runs it with a live log,
// restarts and checks the result), and What's New, the record of what each update changed. Hermes holds its own version and receipt, and Caduceus its
// deployment; this page asks each time.
import { useEffect, useState } from 'react';
import type { UpdateCheck, UpdateTarget } from '@caduceus/contracts/caduceus-api';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { MaintenanceFrame } from './MaintenanceFrame.tsx';
import { startUpdate } from './update-actions.ts';
import { UpdateLogSheet } from './UpdateLogSheet.tsx';
import { useUpdates } from './updates-data.ts';
import { checkView } from './updates-model.ts';
import { WhatsNew } from './WhatsNew.tsx';
import './maintenance.css';

const LABEL: Record<UpdateTarget, 'Hermes' | 'Caduceus'> = { hermes: 'Hermes', caduceus: 'Caduceus' };

function CheckCard({ target, check, restartable, busy, checking, onCheck, onUpdate }: { target: UpdateTarget; check?: UpdateCheck; restartable: boolean; busy: boolean; checking: boolean; onCheck(): void; onUpdate(): void }) {
  const label = LABEL[target];
  const view = check && checkView(label, check, { restartable });
  const tone = view?.status === 'available' ? 'info' : view?.status === 'unknown' ? 'warning' : 'success';
  return (
    <section className="mt-card" aria-labelledby={`mt-${target}`} data-target={target}>
      <div className="mt-card__top">
        <h2 id={`mt-${target}`} className="mt-card__name">
          {label}
        </h2>
        {view && (
          <span className="mt-badge" data-tone={tone}>
            <Icon name={view.status === 'available' ? 'download' : view.status === 'unknown' ? 'alert' : 'succeeded'} small />
            {view.status === 'available' ? 'Update available' : view.status === 'unknown' ? 'Not checked' : 'Up to date'}
          </span>
        )}
      </div>
      {view ? (
        <>
          <p className="mt-card__headline" role="status">
            {view.headline}
          </p>
          {check && view.status !== 'current' && <p className="mt-note">Installed: {check.current_version}</p>}
          {view.detail && <p className="mt-note">{view.detail}</p>}
          {view.command && (
            <p className="mt-note">
              To update it yourself, run <code className="mt-code">{view.command}</code> on the Mac that runs it.
            </p>
          )}
          {view.changes.length > 0 && (
            <details className="mt-changes">
              <summary>
                What’s changing <span className="subtle">({view.changes.length}{check?.behind && check.behind > view.changes.length ? ` of ${check.behind}` : ''})</span>
              </summary>
              <ul>
                {view.changes.map((change) => (
                  <li key={`${change.sha}${change.summary}`}>
                    {change.summary}
                    {change.author ? <span className="subtle"> · {change.author}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p role="status">{checking ? 'Checking…' : `${label} did not answer. Try again in a moment.`}</p>
      )}
      <div className="mt-card__actions">
        {view?.canUpdate && (
          <WriteButton type="button" className="btn btn--primary btn--sm" disabled={busy} aria-label={`Update ${label}`} onClick={onUpdate}>
            <Icon name="download" small />
            Update {label}
          </WriteButton>
        )}
        <button type="button" className="btn btn--secondary btn--sm" disabled={checking} aria-busy={checking} aria-label={`Check now for ${label}`} onClick={onCheck}>
          <Icon name="refresh" small />
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>
    </section>
  );
}

function UpdatesPage() {
  const updates = useUpdates();
  const [following, setFollowing] = useState<{ id: string; target: UpdateTarget }>();
  const operation = updates.state?.operation;
  const running = operation !== undefined && operation !== null && operation.end === undefined;

  // An update that is under way (started on another tab, or before this page reloaded) is followed from where it is.
  useEffect(() => {
    if (operation && !operation.end && !following) setFollowing({ id: operation.id, target: operation.target });
  }, [operation, following]);

  const begin = async (target: UpdateTarget) => {
    const outcome = await startUpdate(target);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setFollowing({ id: outcome.body.id, target });
  };

  return (
    <MaintenanceFrame
      tab="updates"
      subtitle="Updates for Hermes and Caduceus"
      actions={
        <button type="button" className="btn btn--secondary" disabled={updates.loading} aria-busy={updates.loading} onClick={() => void updates.reload(true)}>
          <Icon name="refresh" />
          Check for updates
        </button>
      }
    >
      <p className="help-text">
        Updating pauses new turns first (a <Term id="update-drain">drain</Term>), runs the update with a live log, restarts, and then checks Hermes’s <Term id="update-receipt">update receipt</Term>. Each update is a <Term id="risk-tiers">Tier 2</Term> action: you confirm with a passkey. <Term id="whats-new">What’s New</Term> keeps what each one changed.
      </p>
      {running && operation && (
        <div className="banner" data-tone="running" role="status">
          <Icon name="running" />
          <span className="banner__content">{LABEL[operation.target]} is being updated.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setFollowing({ id: operation.id, target: operation.target })}>
            Show the log
          </button>
        </div>
      )}
      <div className="mt-cards">
        <CheckCard target="hermes" check={updates.hermes} restartable busy={running} checking={updates.loading} onCheck={() => void updates.reload(true)} onUpdate={() => void begin('hermes')} />
        <CheckCard target="caduceus" check={updates.caduceus} restartable={updates.state?.restartable ?? false} busy={running} checking={updates.loading} onCheck={() => void updates.reload(true)} onUpdate={() => void begin('caduceus')} />
      </div>
      <WhatsNew entries={updates.state?.history} />
      {following && <UpdateLogSheet id={following.id} target={following.target} onFinished={() => void updates.reload()} onClose={() => setFollowing(undefined)} />}
    </MaintenanceFrame>
  );
}

export const UpdatesScreen = () => <UpdatesPage />;
