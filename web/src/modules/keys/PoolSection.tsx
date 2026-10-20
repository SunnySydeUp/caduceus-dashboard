import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { AddCredentialSheet } from './AddCredentialSheet.tsx';
import type { PoolEntry, PoolProvider } from './keys-model.ts';
import { addCredential, removeCredential } from './pool-actions.ts';
import './keys.css';
import './pool-endpoints.css';

const STANDING: Record<NonNullable<PoolEntry['status']> | 'unused', { state: StatusState; label: string }> = {
  ok: { state: 'online', label: 'Working' },
  exhausted: { state: 'paused', label: 'Cooling down' },
  dead: { state: 'blocked', label: 'Rejected' },
  unused: { state: 'queued', label: 'Not used yet' },
};

/** Where Hermes got a credential, in words. */
function sourceLabel(source: string): string {
  if (source === 'manual') return 'Added here';
  if (source === 'device_code') return 'Signed in';
  if (source.startsWith('env:')) return `From ${source.slice(4)}`;
  return source;
}

function EntryRow({ provider, entry, busy, onRemove }: { provider: string; entry: PoolEntry; busy: boolean; onRemove(): void }) {
  const standing = STANDING[entry.status ?? 'unused'];
  return (
    <li className="ky-pe-entry">
      <div className="ky-pe-entry__main">
        <strong className="ky-pe-entry__label">{entry.label}</strong>
        <StatusBadge state={standing.state} label={standing.label} variant="plain" />
        <div className="ky-card__tags">
          {entry.source && <span className="tag ky-pe-tag">{sourceLabel(entry.source)}</span>}
          <span className="tag ky-pe-tag">
            {entry.requests} {entry.requests === 1 ? 'request' : 'requests'}
          </span>
          {entry.hasRefresh && <span className="tag ky-pe-tag">Refreshes itself</span>}
        </div>
      </div>
      <WriteButton type="button" className="btn btn--ghost btn--sm ky-pe-danger" disabled={busy} aria-busy={busy} aria-label={`Remove ${entry.label} from the ${provider} pool`} onClick={onRemove}>
        <Icon name="trash" small />
        Remove
      </WriteButton>
    </li>
  );
}

/** System › Keys › Credential pools: the several credentials Hermes holds for each provider, and how each is faring. */
export function PoolSection({ profile, pool, onChanged }: { profile: string; pool: PoolProvider[]; onChanged(): Promise<void> }) {
  const headingId = useId();
  /** The sheet that is open: `provider` is set when it adds to one pool. */
  const [adding, setAdding] = useState<{ provider?: string }>();
  const [removing, setRemoving] = useState<string>();

  const add = async (provider: string, key: string, label: string): Promise<boolean> => {
    const outcome = await addCredential(provider, key, label, profile);
    if (outcome.kind === 'cancelled') return false;
    if (outcome.kind === 'failed') {
      toast(outcome.message, { tone: 'danger' });
      return false;
    }
    toast(`Pooled a key for ${provider}`, { detail: `Profile ${profile}`, tone: 'success' });
    await onChanged();
    return true;
  };

  const remove = async (provider: string, entry: PoolEntry) => {
    setRemoving(`${provider}:${entry.id}`);
    const outcome = await removeCredential(provider, entry, profile);
    setRemoving(undefined);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') {
      toast(outcome.message, { tone: 'danger' });
      // The pool may have moved under the page: look again.
      await onChanged();
      return;
    }
    toast(`Removed ${entry.label} from the ${provider} pool`, { detail: `Profile ${profile}`, tone: 'success' });
    await onChanged();
  };

  return (
    <section className="ky-section" aria-labelledby={headingId}>
      <div className="ky-section__head">
        <h2 className="ky-section__title" id={headingId}>
          <Icon name="stack" />
          Credential pools
          <span className="ky-section__count">{pool.length}</span>
        </h2>
        <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => setAdding({})}>
          <Icon name="plus" small />
          Add credential
        </WriteButton>
      </div>
      <p className="ky-section__lead">
        A <Term id="credential-pool">credential pool</Term> holds several credentials for one provider. Hermes rotates between them and rests one the provider rejects.
      </p>
      {pool.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="stack" />
          </span>
          <p>No pooled credentials</p>
          <p>Add a second key for a provider and Hermes can switch to it when the first runs out or is refused.</p>
          <WriteButton type="button" className="btn btn--primary" onClick={() => setAdding({})}>
            <Icon name="plus" />
            Add credential
          </WriteButton>
        </div>
      ) : (
        <ul className="ky-cards" aria-label="Credential pools">
          {pool.map((group) => (
            <li className="ky-card" key={group.provider}>
              <div className="ky-card__top">
                <div className="ky-card__id">
                  <h3 className="ky-card__name ky-card__name--mono">{group.provider}</h3>
                  <p className="ky-card__sub">{group.entries.length === 1 ? '1 credential' : `${group.entries.length} credentials`}</p>
                </div>
              </div>
              <ul className="ky-pe-entries" aria-label={`Credentials of ${group.provider}`}>
                {group.entries.map((entry) => (
                  <EntryRow key={entry.id || entry.index} provider={group.provider} entry={entry} busy={removing === `${group.provider}:${entry.id}`} onRemove={() => void remove(group.provider, entry)} />
                ))}
              </ul>
              <div className="ky-card__actions">
                <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => setAdding({ provider: group.provider })}>
                  <Icon name="plus" small />
                  Add to this pool
                </WriteButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddCredentialSheet profile={profile} provider={adding.provider} providers={pool.map((group) => group.provider)} onAdd={add} onClose={() => setAdding(undefined)} />}
    </section>
  );
}
