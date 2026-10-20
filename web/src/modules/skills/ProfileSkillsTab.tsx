import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import type { TabProps } from '../profiles/ProfileDetail.tsx';
import { editorPath } from './SkillCommands.tsx';
import { InstalledSkills } from './Skills.tsx';
import './skills.css';

/** A profile's Skills tab: its installed skills, as Agents › Skills shows them, and a way to start one. */
export function ProfileSkillsTab({ card }: TabProps) {
  return (
    <div className="stack">
      <div className="row">
        <AppLink className="btn btn--primary" to={editorPath(card.name, 'new')}>
          <Icon name="plus" />
          New skill
        </AppLink>
        <AppLink className="btn btn--secondary" to={`/agents/skills?profile=${encodeURIComponent(card.name)}`}>
          Open Skills
        </AppLink>
      </div>
      <InstalledSkills profile={card.name} />
    </div>
  );
}
