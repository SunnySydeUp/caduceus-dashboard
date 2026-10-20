// What every Agents › Skills screen is wrapped in: the title block (with the profile the tab is scoped to) and the sections of Skills.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink, useRouteInfo } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import '../profiles/profiles.css';
import './skills.css';

const SOURCE_WORDS = { url: 'this tab’s profile', device: 'this device’s last profile', hermes: 'Hermes’s default profile' } as const;

const SECTIONS: { path: string; label: string; icon: IconName }[] = [
  { path: '/agents/skills', label: 'Installed', icon: 'stack' },
  { path: '/agents/skills/hub', label: 'Hub', icon: 'package' },
  { path: '/agents/skills/learn', label: 'Learn a skill', icon: 'book' },
  { path: '/agents/skills/curator', label: 'Curator', icon: 'archive' },
];

/** The sections of Skills as links; the one being shown is the current page. */
function SkillsSections() {
  const { pathname } = useRouteInfo();
  return (
    <nav className="sk-sections" aria-label="Skills sections">
      <ul>
        {SECTIONS.map((section) => (
          <li key={section.path}>
            <AppLink to={section.path} aria-current={section.path === pathname ? 'page' : undefined}>
              <Icon name={section.icon} small />
              <span>{section.label}</span>
            </AppLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A Skills screen: its title, the profile it works on, the sections, and the screen itself. */
export function SkillsFrame({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const { effective } = useProfileScope();
  return (
    <div className="pf sk-page">
      <PageHeader
        overline="Agents"
        title={title}
        subtitle={
          effective ? (
            <span className="pf-head__meta">
              <Sigil name={effective.name} size="xs" />
              <span>
                Skills of <strong>{effective.name}</strong>
              </span>
              <span className="subtle">{SOURCE_WORDS[effective.source]}</span>
            </span>
          ) : undefined
        }
        actions={actions}
      />
      <SkillsSections />
      {children}
    </div>
  );
}
