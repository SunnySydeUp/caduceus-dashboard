import { Icon } from '../icons.tsx';
import type { CrewStateName } from '../modules/crew/crew-state.ts';
import { SIGIL_STATE_MARKS, sigilFor } from './sigil-model.ts';

export type SigilSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * A profile's mark: four cells in one hue, drawn from its name, so the profile looks the same everywhere. It is decorative (`aria-hidden`): it
 * always sits beside the name. `state` adds a ring and a badge in the corner; both are shapes of their own, and the state's words (`crewStateLabel`)
 * belong beside it, so no state is told by colour alone. `data-profile` names the profile, so that something that belongs to it (an answered decision
 * folding into its agent) can find where it is drawn. `all` is the All profiles scope and shows its icon instead. Sizes are in `sigil.css`.
 */
export function Sigil({ name, size = 'md', state }: { name: string; size?: SigilSize; state?: CrewStateName }) {
  if (name === 'all') {
    return (
      <span className="sigil sigil--all" data-size={size} aria-hidden="true">
        <Icon name="users" />
      </span>
    );
  }
  const { pattern, hue } = sigilFor(name);
  const mark = state ? SIGIL_STATE_MARKS[state] : undefined;
  return (
    <span className="sigil" data-size={size} data-hue={hue} data-profile={name} data-state={mark && mark.ring !== 'none' ? state : undefined} aria-hidden="true">
      {pattern.map((cell, at) => (
        <i key={at} data-cell={cell} />
      ))}
      {mark?.icon && (
        <b>
          <Icon name={mark.icon} />
        </b>
      )}
    </span>
  );
}

/** The mark of "nobody": a task or a card with no profile assigned. */
export function UnassignedSigil({ size = 'md' }: { size?: SigilSize }) {
  return <span className="sigil sigil--none" data-size={size} aria-hidden="true" />;
}
