import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import type { TabProps } from '../profiles/ProfileDetail.tsx';
import { ToolsetsPanel } from './ToolsetsPanel.tsx';
import './tools.css';

/** A profile's Tools & MCP tab: its toolsets, as Agents › Tools & MCP shows them, and a way on to the per-platform grid and Tool routing. */
export function ProfileToolsTab({ card }: TabProps) {
  const scope = `?profile=${encodeURIComponent(card.name)}`;
  return (
    <div className="stack">
      <ToolsetsPanel profile={card.name} />
      <div className="banner" data-tone="info">
        <Icon name="info" />
        <div className="banner__content">
          <div className="banner__title">More tools settings</div>
          <div className="banner__body">MCP servers and the catalogue, which toolsets each platform gets, how tools are routed through the Nous Portal, shell hooks, the terminal backend and Computer use are in Tools & MCP, for the profile this tab works on.</div>
        </div>
        <div className="banner__actions">
          <AppLink className="btn btn--secondary btn--sm" to={`/agents/tools/mcp${scope}`}>
            MCP servers
          </AppLink>
          <AppLink className="btn btn--secondary btn--sm" to={`/agents/tools/platforms${scope}`}>
            Per platform
          </AppLink>
          <AppLink className="btn btn--secondary btn--sm" to={`/agents/tools/routing${scope}`}>
            Tool routing
          </AppLink>
          <AppLink className="btn btn--secondary btn--sm" to={`/agents/tools/hooks${scope}`}>
            Hooks
          </AppLink>
          <AppLink className="btn btn--secondary btn--sm" to={`/agents/tools/terminal${scope}`}>
            Terminal
          </AppLink>
        </div>
      </div>
    </div>
  );
}
