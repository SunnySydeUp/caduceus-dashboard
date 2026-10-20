import { useState } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { approvePending, clearPendingRequests, personWords, revokeApproved } from './pairing-actions.ts';
import { usePairing } from './pairing-data.ts';
import { ageWords, platformName, type ApprovedUser, type PendingRequest } from './pairing-model.ts';
import '../profiles/profiles.css';
import './pairing.css';

/** A request or a user, for the one menu and the busy marks: they are told apart by their platform and id. */
type Row = { kind: 'pending'; request: PendingRequest } | { kind: 'approved'; user: ApprovedUser };

const keyOf = (row: Row) => (row.kind === 'pending' ? `pending:${row.request.platform}:${row.request.requestId || row.request.userId}` : `approved:${row.user.platform}:${row.user.userId}`);
const whoOf = (row: Row) => (row.kind === 'pending' ? row.request : row.user);

interface MenuAction {
  id: string;
  icon: IconName;
  label: string;
  sub?: string;
  danger?: boolean;
  disabled?: boolean;
  run(): void;
}

/** A card's ⋮ menu, as a sheet (mobile spec §2: nothing is hover-only, and nothing is swipe-only). */
function RowMenu({ title, actions, onClose }: { title: string; actions: MenuAction[]; onClose(): void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <ul className="pf-acts">
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              className={`pf-act${action.danger ? ' pf-act--danger' : ''}`}
              disabled={action.disabled}
              onClick={() => {
                onClose();
                // The sheet is closed before the next dialog opens, so the layers never stack.
                void closeAllLayers().then(action.run);
              }}
            >
              <Icon name={action.icon} />
              <span>
                <span>{action.label}</span>
                {action.sub && <small>{action.sub}</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function PersonCard({ row, busy, onApprove, onMenu }: { row: Row; busy: boolean; onApprove?(): void; onMenu(): void }) {
  const who = whoOf(row);
  const name = who.userName || who.userId;
  return (
    <li className="pr-card" data-kind={row.kind}>
      <div className="pr-card__top">
        <Sigil name={name} size="sm" />
        <div className="pr-card__id">
          <h3 className="pr-card__name">{name}</h3>
          <span className="pr-card__meta">
            {platformName(who.platform)}
            {who.userName && <span className="mono"> · {who.userId}</span>}
          </span>
          {row.kind === 'pending' ? <StatusBadge state="waiting" label={`Asked ${ageWords(row.request.ageMinutes)}`} /> : <StatusBadge state="online" label={row.user.approvedAt ? `Approved ${new Date(row.user.approvedAt).toLocaleDateString()}` : 'Approved'} variant="plain" />}
        </div>
      </div>
      {row.kind === 'pending' && !row.request.approvable && <p className="pr-note">An older Hermes wrote this request without an id, so it cannot be approved here. Approve it with its code: <code>hermes pairing approve {row.request.platform} CODE</code>.</p>}
      <div className="pr-card__actions">
        {row.kind === 'pending' && (
          <WriteButton type="button" className="btn btn--primary" disabled={busy || !row.request.approvable} aria-label={`Approve ${name} on ${platformName(who.platform)}`} onClick={onApprove}>
            <Icon name="check" />
            Approve…
          </WriteButton>
        )}
        <button type="button" className="btn btn--ghost btn--icon pr-card__more" aria-label={`Actions for ${name} on ${platformName(who.platform)}`} aria-haspopup="dialog" onClick={onMenu}>
          <Icon name="dots-v" />
        </button>
      </div>
    </li>
  );
}

/** Connect › Pairing: the people who asked a bot for access and the people who have it, for the profile this tab is scoped to. */
export function Pairing() {
  const { effective } = useProfileScope();
  const profile = effective?.name;
  const view = usePairing(profile);
  const [menu, setMenu] = useState<Row>();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const { pending, approved } = view;

  const working = async (key: string, run: () => Promise<void>) => {
    setBusy((now) => new Set(now).add(key));
    try {
      await run();
    } finally {
      setBusy((now) => {
        const next = new Set(now);
        next.delete(key);
        return next;
      });
    }
  };

  const approve = (request: PendingRequest) =>
    profile &&
    working(keyOf({ kind: 'pending', request }), async () => {
      const outcome = await approvePending(request, profile);
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind === 'done') toast(`Approved ${personWords(request)} on ${platformName(request.platform)} for ${profile}`, { detail: 'The bot answers them from now on.' });
      if (outcome.kind !== 'cancelled') await view.reload();
    });

  const revoke = (user: ApprovedUser) =>
    profile &&
    working(keyOf({ kind: 'approved', user }), async () => {
      const outcome = await revokeApproved(user, profile);
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind === 'done') toast(`Revoked ${personWords(user)} on ${platformName(user.platform)} for ${profile}`, { detail: 'The bot no longer answers them.' });
      if (outcome.kind !== 'cancelled') await view.reload();
    });

  const clear = async () => {
    if (!profile || !pending || pending.length === 0) return;
    const outcome = await clearPendingRequests(pending.length, profile);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') toast(`Cleared ${outcome.body.cleared ?? pending.length} pending ${outcome.body.cleared === 1 ? 'request' : 'requests'} for ${profile}`);
    if (outcome.kind !== 'cancelled') await view.reload();
  };

  const menuActions = (row: Row): MenuAction[] => {
    const who = whoOf(row);
    const copy: MenuAction = { id: 'copy', icon: 'copy', label: 'Copy user id', sub: `The id ${platformName(who.platform)} knows them by`, run: () => void navigator.clipboard?.writeText(who.userId).then(() => toast('Copied the user id'), () => toast('Could not copy: this browser did not allow it', { tone: 'warning' })) };
    if (row.kind === 'pending') {
      return [{ id: 'approve', icon: 'check', label: 'Approve…', sub: row.request.approvable ? `Tier 2 · for ${profile}` : 'Needs its code: see the note on the card', disabled: !row.request.approvable, run: () => void approve(row.request) }, copy];
    }
    return [copy, { id: 'revoke', icon: 'user-plus', label: 'Revoke…', sub: `Tier 2 · for ${profile}`, danger: true, run: () => void revoke(row.user) }];
  };

  const loaded = pending !== undefined && approved !== undefined;
  const nothing = loaded && pending.length === 0 && approved.length === 0;

  return (
    <div className="pr">
      <PageHeader
        overline="Connect"
        title="Pairing"
        subtitle={
          profile ? (
            <span className="pr-head__meta">
              <Sigil name={profile} size="xs" />
              <span>
                Pairing of <strong>{profile}</strong>
              </span>
              {loaded && (
                <span className="subtle">
                  {pending.length} waiting · {approved.length} approved
                </span>
              )}
            </span>
          ) : undefined
        }
        actions={
          pending && pending.length > 0 ? (
            <WriteButton type="button" className="btn btn--secondary" onClick={() => void clear()}>
              <Icon name="trash" />
              Clear pending…
            </WriteButton>
          ) : undefined
        }
      />
      <p className="help-text">
        When a stranger sends a direct message to one of your bots, Hermes keeps their request here instead of answering. You approve the people you know. <Term id="pairing">Pairing</Term> is per profile, and per <AppLink to="/connect/channels">channel</AppLink>.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its pairing requests could not be listed{loaded ? ': these are the lists from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!loaded && !view.failed && <p role="status">Loading pairing requests…</p>}
      {nothing && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="user-plus" />
          </span>
          <p>Nobody has asked yet, and nobody is approved.</p>
          <p>
            When someone you do not know messages one of your bots, Hermes gives them a short code and keeps their request here. It shows up live. Approve them if you know who they are. Set up a bot first in <AppLink to="/connect/channels">Channels</AppLink>.
          </p>
        </div>
      )}
      {loaded && !nothing && profile && (
        <>
          <section className="pr-section" aria-labelledby="pr-waiting">
            <h2 id="pr-waiting" className="pr-section__title">
              Waiting for you <span className="pr-count">{pending.length}</span>
            </h2>
            {pending.length === 0 ? (
              <p className="subtle">No request is waiting. A new one appears here as soon as someone messages a bot.</p>
            ) : (
              <ul className="pr-cards" aria-label="Pending requests">
                {pending.map((request) => {
                  const row: Row = { kind: 'pending', request };
                  return <PersonCard key={keyOf(row)} row={row} busy={busy.has(keyOf(row))} onApprove={() => void approve(request)} onMenu={() => setMenu(row)} />;
                })}
              </ul>
            )}
          </section>
          <section className="pr-section" aria-labelledby="pr-approved">
            <h2 id="pr-approved" className="pr-section__title">
              Approved <span className="pr-count">{approved.length}</span>
            </h2>
            {approved.length === 0 ? (
              <p className="subtle">Nobody is approved through pairing yet. People on a platform’s allowed-users list are not listed here.</p>
            ) : (
              <ul className="pr-cards" aria-label="Approved people">
                {approved.map((user) => {
                  const row: Row = { kind: 'approved', user };
                  return <PersonCard key={keyOf(row)} row={row} busy={busy.has(keyOf(row))} onMenu={() => setMenu(row)} />;
                })}
              </ul>
            )}
          </section>
        </>
      )}
      {menu && <RowMenu title={`${whoOf(menu).userName || whoOf(menu).userId} · ${platformName(whoOf(menu).platform)}`} actions={menuActions(menu)} onClose={() => setMenu(undefined)} />}
    </div>
  );
}
