// What every System › Maintenance screen sits in: its header and the tabs between the screens.
import type { ReactNode } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { consoleHiddenOn } from './console-model.ts';
import { MAINTENANCE_TABS, type MaintenanceTab } from './maintenance-tabs.ts';
import '../profiles/profiles.css';
import './maintenance.css';

export function MaintenanceFrame({ tab, subtitle, actions, children }: { tab: MaintenanceTab['id']; subtitle: string; actions?: ReactNode; children: ReactNode }) {
  const size = useSizeClass();
  // A tab that is not offered on this screen is still shown while it is the one open.
  const tabs = MAINTENANCE_TABS.filter((candidate) => candidate.id === tab || candidate.id !== 'console' || !consoleHiddenOn(size));
  return (
    <div className="pf mt">
      <PageHeader overline="System" title="Maintenance" subtitle={<span className="subtle">{subtitle}</span>} actions={actions} />
      <div className="pf-body">
        <nav className="pf-tabs" aria-label="Maintenance sections">
          <ul>
            {tabs.map((candidate) => (
              <li key={candidate.id}>
                <AppLink to={candidate.path} aria-current={candidate.id === tab ? 'page' : undefined}>
                  <Icon name={candidate.icon} small />
                  <span>{candidate.label}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-panel">{children}</div>
      </div>
    </div>
  );
}
