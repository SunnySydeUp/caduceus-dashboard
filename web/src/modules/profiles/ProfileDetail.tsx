import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useParams } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { ProfileCommandsProvider, useProfileCommands } from './ProfileCommands.tsx';
import { GatewayBadge } from './GatewayBadge.tsx';
import { useProfiles, type ProfilesView } from './profiles-data.ts';
import { availableTabs, tabPath } from './profile-tabs.ts';
import type { ProfileCard } from './profiles-model.ts';
import './profiles.css';

/** What a tab renders: the card it is about and the view of every profile (for what a rename must check). */
export interface TabProps {
  card: ProfileCard;
  view: ProfilesView;
}

/** The tabs whose screens have landed. A later ticket adds its tab's screen here, and the tab appears. */
const TAB_SCREENS: Record<string, LazyExoticComponent<ComponentType<TabProps>>> = {
  overview: lazy(() => import('./Overview.tsx').then((m) => ({ default: m.Overview }))),
  identity: lazy(() => import('./Identity.tsx').then((m) => ({ default: m.Identity }))),
  instructions: lazy(() => import('./Instructions.tsx').then((m) => ({ default: m.Instructions }))),
  memory: lazy(() => import('./MemoryFiles.tsx').then((m) => ({ default: m.MemoryFiles }))),
  skills: lazy(() => import('../skills/ProfileSkillsTab.tsx').then((m) => ({ default: m.ProfileSkillsTab }))),
  tools: lazy(() => import('../tools/ProfileToolsTab.tsx').then((m) => ({ default: m.ProfileToolsTab }))),
  model: lazy(() => import('../models/ProfileModelTab.tsx').then((m) => ({ default: m.ProfileModelTab }))),
  files: lazy(() => import('./ProfileFiles.tsx').then((m) => ({ default: m.ProfileFiles }))),
  danger: lazy(() => import('./DangerZone.tsx').then((m) => ({ default: m.DangerZone }))),
};

function Detail({ view }: { view: ProfilesView }) {
  const { name = '', tab = 'overview' } = useParams({ strict: false }) as { name?: string; tab?: string };
  const { effective } = useProfileScope();
  const commands = useProfileCommands();
  const card = view.cards?.find((candidate) => candidate.name === name);
  const tabs = availableTabs(Object.keys(TAB_SCREENS));
  const current = tabs.find((candidate) => candidate.id === tab);
  const Screen = current ? TAB_SCREENS[current.id] : undefined;

  if (!view.cards) {
    return (
      <div className="pf">
        <PageHeader overline="Profile" title={name} />
        {view.failed ? (
          <div className="banner pf-error" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">Hermes did not answer, so this profile could not be loaded.</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        ) : (
          <Loading label="Loading the profile…" lines={4} onRetry={() => void view.reload()} />
        )}
      </div>
    );
  }
  if (!card || !current || !Screen) {
    return (
      <div className="pf">
        <PageHeader overline="Profile" title={card ? card.name : 'Profile not found'} />
        <div className="empty">
          <span className="empty__icon">
            <Icon name="users" />
          </span>
          <p>{card ? 'This profile has no such tab.' : `Hermes has no profile called “${name}”. It may have been renamed or deleted.`}</p>
          <AppLink className="btn btn--primary" to={card ? tabPath(card.name, 'overview') : '/agents/profiles'}>
            {card ? 'Open the overview' : 'Back to Profiles'}
          </AppLink>
        </div>
      </div>
    );
  }

  return (
    <div className="pf pf-detail">
      <PageHeader
        overline={current.id === 'overview' ? 'Profile' : `Profile · ${current.label}`}
        title={card.name}
        subtitle={
          <span className="pf-head__meta">
            <Sigil name={card.name} size="xs" />
            {card.isDefault && (
              <span className="tag" data-tone="accent">
                <Icon name="check" small />
                Default
              </span>
            )}
            {effective?.name === card.name && (
              <span className="tag" data-tone="success">
                Active in this tab
              </span>
            )}
            <GatewayBadge card={card} status={view.statuses[card.name]} />
            <span className="mono">{card.model ?? 'No model set'}</span>
          </span>
        }
        actions={
          <>
            {effective?.name !== card.name && (
              <button type="button" className="btn btn--secondary" onClick={() => commands.useInThisTab(card)}>
                <Icon name="user" />
                Use in this tab
              </button>
            )}
            <AppLink className="btn btn--primary" to={`/chat/new?profile=${encodeURIComponent(card.name)}`}>
              <Icon name="chat" />
              New chat
            </AppLink>
            <button type="button" className="btn btn--ghost btn--icon" aria-label={`More actions for ${card.name}`} aria-haspopup="dialog" onClick={() => commands.openMenu(card)}>
              <Icon name="dots-v" />
            </button>
          </>
        }
      />
      <div className="pf-body">
        <nav className="pf-tabs" aria-label="Profile sections">
          <ul>
            {tabs.map((candidate) => (
              <li key={candidate.id}>
                <AppLink to={tabPath(card.name, candidate.id)} aria-current={candidate.id === current.id ? 'page' : undefined} className={candidate.id === 'danger' ? 'pf-tabs__danger' : undefined}>
                  <Icon name={candidate.icon} small />
                  <span>{candidate.label}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <section className="pf-panel" aria-labelledby="pf-tab-title">
          <h2 id="pf-tab-title" className="pf-panel__title">
            {current.label}
          </h2>
          <Suspense fallback={<Loading label={`Loading ${current.label}…`} lines={4} />}>
            <Screen card={card} view={view} />
          </Suspense>
        </section>
      </div>
    </div>
  );
}

/** A profile's detail: its tabs, with the overview first. */
export function ProfileDetail() {
  const view = useProfiles();
  return (
    <ProfileCommandsProvider cards={view.cards ?? []} reload={view.reload}>
      <Detail view={view} />
    </ProfileCommandsProvider>
  );
}
