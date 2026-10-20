import type { ComponentType } from 'react';
import { useParams } from '@tanstack/react-router';
import { Icon, type IconName } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import '../profiles/profiles.css';
import { AuxiliarySlots } from './AuxiliarySlots.tsx';
import { FallbackChain } from './FallbackChain.tsx';
import { LocalModels } from './LocalModels.tsx';
import { MainModel } from './MainModel.tsx';
import { MixtureOfAgents } from './MixtureOfAgents.tsx';
import { Usage } from './Usage.tsx';
import './models.css';

interface ModelsTab {
  /** The last segment of the address: `/agents/models/auxiliary`. The main model has none. */
  id: string;
  label: string;
  icon: IconName;
  screen: ComponentType<{ profile: string }>;
}

/** The tabs of Agents › Models, in their order. A later ticket adds its screen here and the tab appears. */
const TABS: readonly ModelsTab[] = [
  { id: 'main', label: 'Main model', icon: 'cpu', screen: MainModel },
  { id: 'auxiliary', label: 'Auxiliary slots', icon: 'sliders', screen: AuxiliarySlots },
  { id: 'fallback', label: 'Fallback chain', icon: 'stack', screen: FallbackChain },
  { id: 'moa', label: 'Mixture of Agents', icon: 'subagent', screen: MixtureOfAgents },
  { id: 'usage', label: 'Usage', icon: 'chart', screen: Usage },
  { id: 'local', label: 'Local models', icon: 'database', screen: LocalModels },
];

const tabPath = (id: string) => (id === 'main' ? '/agents/models' : `/agents/models/${id}`);

const SOURCE_WORDS = { url: 'this tab’s profile', device: 'this device’s last profile', hermes: 'Hermes’s default profile' } as const;

/** Agents › Models: the models of the profile this tab is scoped to. */
export function Models() {
  const { tab = 'main' } = useParams({ strict: false }) as { tab?: string };
  const { effective } = useProfileScope();
  const current = TABS.find((candidate) => candidate.id === tab);

  if (!current) {
    return (
      <div className="pf">
        <PageHeader overline="Agents" title="Models" />
        <div className="empty">
          <span className="empty__icon">
            <Icon name="cpu" />
          </span>
          <p>There is no “{tab}” tab in Models.</p>
          <AppLink className="btn btn--primary" to="/agents/models">
            Open the main model
          </AppLink>
        </div>
      </div>
    );
  }
  const Screen = current.screen;

  return (
    <div className="pf md">
      <PageHeader
        overline="Agents"
        title="Models"
        subtitle={
          effective ? (
            <span className="pf-head__meta">
              <Sigil name={effective.name} size="xs" />
              <span>
                Models of <strong>{effective.name}</strong>
              </span>
              <span className="subtle">{SOURCE_WORDS[effective.source]}</span>
            </span>
          ) : undefined
        }
      />
      <div className="pf-body">
        <nav className="pf-tabs" aria-label="Models sections">
          <ul>
            {TABS.map((candidate) => (
              <li key={candidate.id}>
                <AppLink to={tabPath(candidate.id)} aria-current={candidate.id === current.id ? 'page' : undefined}>
                  <Icon name={candidate.icon} small />
                  <span>{candidate.label}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <section className="pf-panel" aria-labelledby="md-tab-title">
          <h2 id="md-tab-title" className="pf-panel__title">
            {current.label}
          </h2>
          {effective ? <Screen key={effective.name} profile={effective.name} /> : <p role="status">Loading…</p>}
        </section>
      </div>
    </div>
  );
}
