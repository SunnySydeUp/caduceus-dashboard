import { useRef, useState, type PointerEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { Term } from '../../shell/Term.tsx';
import { ImportProfile } from './ProfileTransfer.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { GatewayBadge } from './GatewayBadge.tsx';
import { ProfileCommandsProvider, useProfileCommands } from './ProfileCommands.tsx';
import { useProfiles, type ProfilesView } from './profiles-data.ts';
import type { GatewayStatus, ProfileCard } from './profiles-model.ts';
import './profiles.css';

/** How long a finger rests on a card before its menu opens: the long-press alternative to the ⋮ button. */
const LONG_PRESS_MS = 500;

function ProfileCardView({ card, status, inTab }: { card: ProfileCard; status: GatewayStatus | undefined; inTab: boolean }) {
  const commands = useProfileCommands();
  const press = useRef<number>(undefined);
  const stopPress = () => window.clearTimeout(press.current);
  const startPress = (event: PointerEvent) => {
    // A mouse has the ⋮ button and a right click; a finger or a pen may hold.
    if (event.pointerType === 'mouse') return;
    press.current = window.setTimeout(() => commands.openMenu(card), LONG_PRESS_MS);
  };
  return (
    <li
      className="pf-card"
      onPointerDown={startPress}
      onPointerUp={stopPress}
      onPointerCancel={stopPress}
      onPointerMove={stopPress}
      onPointerLeave={stopPress}
      onContextMenu={(event) => {
        event.preventDefault();
        commands.openMenu(card);
      }}
    >
      <div className="pf-card__top">
        <Sigil name={card.name} size="md" />
        <div className="pf-card__id">
          <h2 className="pf-card__name">
            <AppLink to={`/agents/profiles/${card.name}`}>{card.name}</AppLink>
          </h2>
          <div className="pf-card__badges">
            {card.isDefault && (
              <span className="tag" data-tone="accent">
                <Icon name="check" small />
                Default
              </span>
            )}
            {inTab && (
              <span className="tag" data-tone="success">
                Active in this tab
              </span>
            )}
          </div>
        </div>
        <button type="button" className="btn btn--ghost btn--icon pf-card__more" aria-label={`Actions for ${card.name}`} aria-haspopup="dialog" onClick={() => commands.openMenu(card)}>
          <Icon name="dots-v" />
        </button>
      </div>
      <p className="pf-card__desc">{card.description || <span className="subtle">No description yet.</span>}</p>
      <ul className="pf-card__meta">
        <li>
          <GatewayBadge card={card} status={status} />
        </li>
        <li className="mono truncate">
          <span className="sr-only">Model: </span>
          {card.model ? `${card.model}${card.provider ? ` · ${card.provider}` : ''}` : 'No model set'}
        </li>
        <li>
          <Icon name="stack" small />
          {card.skillCount} skills
        </li>
      </ul>
    </li>
  );
}

function ProfilesList({ view: { cards, statuses, failed, reload } }: { view: ProfilesView }) {
  const { effective } = useProfileScope();
  const commands = useProfileCommands();
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const shown = cards?.filter((card) => !query || `${card.name} ${card.description} ${card.model ?? ''} ${card.provider ?? ''}`.toLowerCase().includes(query));
  const running = cards?.filter((card) => statuses[card.name]?.gateway_running ?? card.gatewayRunning).length ?? 0;
  const defaultName = cards?.find((card) => card.isDefault)?.name;

  return (
    <div className="pf">
      <PageHeader
        overline="Agents"
        title="Profiles"
        subtitle={cards ? `${cards.length} profile${cards.length === 1 ? '' : 's'} · ${running} gateway${running === 1 ? '' : 's'} running${defaultName ? ` · default: ${defaultName}` : ''}` : 'Every Hermes profile, with its gateway.'}
        actions={
          <>
            <ImportProfile cards={cards ?? []} reload={reload} />
            <WriteButton type="button" className="btn btn--primary" onClick={() => commands.openCreate()}>
              <Icon name="plus" />
              New profile
            </WriteButton>
          </>
        }
      />
      <p className="help-text">
        A <Term id="profile">profile</Term> is a separate Hermes setup. The <Term id="default-profile">default profile</Term> is the one Hermes uses when nothing says otherwise.
      </p>
      {failed && (
        <div className="banner pf-error" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its profiles could not be listed{cards ? ': this is the list from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!cards && !failed && <p role="status">Loading profiles…</p>}
      {cards && cards.length > 3 && (
        <div className="pf-tools">
          <div className="input-wrap pf-search">
            <Icon name="search" />
            <input className="input" type="search" placeholder="Filter profiles" aria-label="Filter profiles" value={filter} onChange={(event) => setFilter(event.target.value)} />
          </div>
        </div>
      )}
      {shown && shown.length > 0 && (
        <ul className="pf-cards" aria-label="Profiles">
          {shown.map((card) => (
            <ProfileCardView key={card.name} card={card} status={statuses[card.name]} inTab={effective?.name === card.name} />
          ))}
        </ul>
      )}
      {cards && shown && shown.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="users" />
          </span>
          {cards.length === 0 ? (
            <>
              <p>Hermes has no profiles to show.</p>
              <WriteButton type="button" className="btn btn--primary" onClick={() => commands.openCreate()}>
                <Icon name="plus" />
                Create profile
              </WriteButton>
            </>
          ) : (
            <>
              <p>No profile matches “{filter}”.</p>
              <button type="button" className="btn btn--secondary" onClick={() => setFilter('')}>
                Clear filter
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Agents › Profiles: one card per Hermes profile, with its live gateway status. */
export function Profiles() {
  const view = useProfiles();
  return (
    <ProfileCommandsProvider cards={view.cards ?? []} reload={view.reload}>
      <ProfilesList view={view} />
    </ProfileCommandsProvider>
  );
}
