import type { ComponentType } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import '../profiles/profiles.css';
import { CatalogPanel } from './CatalogPanel.tsx';
import { HooksPanel } from './HooksPanel.tsx';
import { McpPanel } from './McpPanel.tsx';
import { PlatformsPanel } from './PlatformsPanel.tsx';
import { RoutingPanel } from './RoutingPanel.tsx';
import { TerminalPanel } from './TerminalPanel.tsx';
import { ToolsetsPanel } from './ToolsetsPanel.tsx';
import './tools.css';

interface ToolsTab {
  id: 'toolsets' | 'mcp' | 'catalogue' | 'platforms' | 'routing' | 'hooks' | 'terminal';
  label: string;
  icon: IconName;
  /** The address of the tab: Toolsets is the module's own. */
  path: string;
  screen: ComponentType<{ profile: string }>;
}

/** The tabs of Agents › Tools & MCP, in their order. */
const TABS: readonly ToolsTab[] = [
  { id: 'toolsets', label: 'Toolsets', icon: 'tool', path: '/agents/tools', screen: ToolsetsPanel },
  { id: 'mcp', label: 'MCP servers', icon: 'plug', path: '/agents/tools/mcp', screen: McpPanel },
  { id: 'catalogue', label: 'Catalogue', icon: 'package', path: '/agents/tools/catalogue', screen: CatalogPanel },
  { id: 'platforms', label: 'Per platform', icon: 'rows', path: '/agents/tools/platforms', screen: PlatformsPanel },
  { id: 'routing', label: 'Tool routing', icon: 'plug', path: '/agents/tools/routing', screen: RoutingPanel },
  { id: 'hooks', label: 'Hooks', icon: 'bolt', path: '/agents/tools/hooks', screen: HooksPanel },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', path: '/agents/tools/terminal', screen: TerminalPanel },
];

const SOURCE_WORDS = { url: 'this tab’s profile', device: 'this device’s last profile', hermes: 'Hermes’s default profile' } as const;

function ToolsPage({ tab }: { tab: ToolsTab['id'] }) {
  const { effective } = useProfileScope();
  const current = TABS.find((candidate) => candidate.id === tab)!;
  const Screen = current.screen;

  return (
    <div className="pf tl">
      <PageHeader
        overline="Agents"
        title="Tools & MCP"
        subtitle={
          effective ? (
            <span className="pf-head__meta">
              <Sigil name={effective.name} size="xs" />
              <span>
                Tools of <strong>{effective.name}</strong>
              </span>
              <span className="subtle">{SOURCE_WORDS[effective.source]}</span>
            </span>
          ) : undefined
        }
      />
      <div className="pf-body">
        <nav className="pf-tabs" aria-label="Tools sections">
          <ul>
            {TABS.map((candidate) => (
              <li key={candidate.id}>
                <AppLink to={candidate.path} aria-current={candidate.id === current.id ? 'page' : undefined}>
                  <Icon name={candidate.icon} small />
                  <span>{candidate.label}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <section className="pf-panel" aria-labelledby="tl-tab-title">
          <h2 id="tl-tab-title" className="pf-panel__title">
            {current.label}
          </h2>
          {effective ? <Screen key={effective.name} profile={effective.name} /> : <p role="status">Loading…</p>}
        </section>
      </div>
    </div>
  );
}

export const ToolsetsScreen = () => <ToolsPage tab="toolsets" />;
export const McpScreen = () => <ToolsPage tab="mcp" />;
export const CatalogueScreen = () => <ToolsPage tab="catalogue" />;
export const PlatformsScreen = () => <ToolsPage tab="platforms" />;
export const RoutingScreen = () => <ToolsPage tab="routing" />;
export const HooksScreen = () => <ToolsPage tab="hooks" />;
export const TerminalScreen = () => <ToolsPage tab="terminal" />;
