import type { ComponentType } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import '../profiles/profiles.css';
import { BuiltInPanel } from './BuiltInPanel.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { EnginePanel } from './EnginePanel.tsx';
import { GraphPanel } from './GraphPanel.tsx';
import { HindsightPanel } from './HindsightPanel.tsx';
import { useMemoryStatus } from './memory-data.ts';
import { NotesPanel } from './NotesPanel.tsx';
import { ProviderPanel } from './ProviderPanel.tsx';
import { WikiPanel } from './WikiPanel.tsx';
import './memory.css';

interface MemoryTab {
  id: 'provider' | 'hindsight' | 'engine' | 'built-in' | 'graph' | 'context' | 'notes' | 'wiki';
  label: string;
  icon: IconName;
  /** The address of the tab: Provider is the module's own. */
  path: string;
  screen: ComponentType<{ profile: string }>;
}

/** The tabs of Agents › Memory, in their order. Hindsight is a tab only while Hindsight is the profile's memory provider; its address still opens, and says how to turn it on. */
const TABS: readonly MemoryTab[] = [
  { id: 'provider', label: 'Provider', icon: 'database', path: '/agents/memory', screen: ProviderPanel },
  { id: 'hindsight', label: 'Hindsight', icon: 'history', path: '/agents/memory/hindsight', screen: HindsightPanel },
  { id: 'engine', label: 'Context engine', icon: 'cpu', path: '/agents/memory/engine', screen: EnginePanel },
  { id: 'built-in', label: 'Built-in memory', icon: 'file', path: '/agents/memory/built-in', screen: BuiltInPanel },
  { id: 'graph', label: 'Learning graph', icon: 'git', path: '/agents/memory/graph', screen: GraphPanel },
  { id: 'context', label: 'Project context', icon: 'folder', path: '/agents/memory/context', screen: ContextPanel },
  { id: 'notes', label: 'Notes', icon: 'rows', path: '/agents/memory/notes', screen: NotesPanel },
  { id: 'wiki', label: 'LLM Wiki', icon: 'book', path: '/agents/memory/wiki', screen: WikiPanel },
];

const SOURCE_WORDS = { url: 'this tab’s profile', device: 'this device’s last profile', hermes: 'Hermes’s default profile' } as const;

function MemoryPage({ tab }: { tab: MemoryTab['id'] }) {
  const { effective } = useProfileScope();
  const memory = useMemoryStatus(effective?.name);
  const current = TABS.find((candidate) => candidate.id === tab)!;
  // Hindsight is shown as a tab while it is the profile's provider (and while its own address is open, so the tab does not vanish under the owner).
  const shown = TABS.filter((candidate) => candidate.id !== 'hindsight' || candidate.id === tab || memory.value?.active === 'hindsight');
  const Screen = current.screen;

  return (
    <div className="pf mm">
      <PageHeader
        overline="Agents"
        title="Memory"
        subtitle={
          effective ? (
            <span className="pf-head__meta">
              <Sigil name={effective.name} size="xs" />
              <span>
                Memory of <strong>{effective.name}</strong>
              </span>
              <span className="subtle">{SOURCE_WORDS[effective.source]}</span>
            </span>
          ) : undefined
        }
      />
      <div className="pf-body">
        <nav className="pf-tabs" aria-label="Memory sections">
          <ul>
            {shown.map((candidate) => (
              <li key={candidate.id}>
                <AppLink to={candidate.path} aria-current={candidate.id === current.id ? 'page' : undefined}>
                  <Icon name={candidate.icon} small />
                  <span>{candidate.label}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <section className="pf-panel" aria-labelledby="mm-tab-title">
          <h2 id="mm-tab-title" className="pf-panel__title">
            {current.label}
          </h2>
          {effective ? <Screen key={effective.name} profile={effective.name} /> : <p role="status">Loading…</p>}
        </section>
      </div>
    </div>
  );
}

export const ProviderScreen = () => <MemoryPage tab="provider" />;
export const EngineScreen = () => <MemoryPage tab="engine" />;
export const BuiltInScreen = () => <MemoryPage tab="built-in" />;
export const GraphScreen = () => <MemoryPage tab="graph" />;
export const ContextScreen = () => <MemoryPage tab="context" />;
export const WikiScreen = () => <MemoryPage tab="wiki" />;
export const HindsightScreen = () => <MemoryPage tab="hindsight" />;
export const NotesScreen = () => <MemoryPage tab="notes" />;
