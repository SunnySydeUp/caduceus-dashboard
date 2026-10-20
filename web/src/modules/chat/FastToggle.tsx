// Fast mode's button (M1 #18) in a fast chat's composer, which turns the tab's Fast mode off. A chat turns it on from the Fast mode row of This chat (`ComposerChips.tsx`).
import { Icon } from '../../icons.tsx';
import { fastMode, setFastMode } from './fast-session.ts';
import { useStore } from './use-store.ts';

const OFF = { on: false };

/** Fast mode's button in a fast chat's composer: label, icon and the warning colour say it is on, and the same button turns it off. */
export function FastToggle() {
  const { on } = useStore(fastMode, OFF);
  return (
    <button type="button" className="chip fast-toggle" aria-pressed={on} title={on ? 'Fast mode is on: prompts go straight to a model. Turn it off' : 'Fast mode: send prompts straight to a model, with no agent and nothing saved'} onClick={() => setFastMode(!on)}>
      <Icon name="bolt" small />
      <span>Fast</span>
    </button>
  );
}
