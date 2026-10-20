import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import type { TabProps } from '../profiles/ProfileDetail.tsx';
import { MainModel } from './MainModel.tsx';
import './models.css';

/** A profile's Model tab: its main model, as Agents › Models shows it, and a way on to the auxiliary slots. */
export function ProfileModelTab({ card }: TabProps) {
  return (
    <div className="stack">
      <MainModel profile={card.name} />
      <div className="banner" data-tone="info">
        <Icon name="info" />
        <div className="banner__content">
          <div className="banner__title">Side tasks have models of their own</div>
          <div className="banner__body">Vision, compression, titles and the other auxiliary slots are set in Models, for the profile this tab works on.</div>
        </div>
        <div className="banner__actions">
          <AppLink className="btn btn--secondary btn--sm" to={`/agents/models/auxiliary?profile=${encodeURIComponent(card.name)}`}>
            Open Models
          </AppLink>
        </div>
      </div>
    </div>
  );
}
