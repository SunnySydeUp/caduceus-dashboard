// The composer's intent control (M8 #06, calmer in M8 #09): a small "Send as" menu beside Send with Ask, Delegate and Repeat and a line each that says what it does
// (the chosen one is marked with `aria-pressed`), and a chip above the field that names a chosen intent other than Ask and clears it. What each intent does with a
// draft is `composer-intent.ts`'s; this draws the choice.
import { Icon } from '../../icons.tsx';
import { ComposerPopover } from './composer-popover.tsx';
import { INTENTS, INTENT_META, intentChip, intentHint, type Intent } from './composer-intent.ts';

/** The "Send as" menu: the chevron beside Send. `disabled` while a message is on its way. Choosing closes the menu and puts the focus back on the chevron. */
export function SendAsMenu({ intent, agent, disabled, split, onChange }: { intent: Intent; agent: string; disabled: boolean; /** Joined to Send as one pill. */ split: boolean; onChange(next: Intent): void }) {
  return (
    <ComposerPopover
      label="Send as"
      placement="top"
      align="fill"
      className="composer__sendas-pop"
      trigger={(props) => (
        <button {...props} className={split ? 'composer__more' : 'btn btn--ghost btn--icon'} aria-label="How to send" disabled={disabled}>
          <Icon name="chev-u" small />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <p className="pop__title">Send as</p>
          {INTENTS.map((choice) => (
            <button
              key={choice}
              type="button"
              className="pop__item composer__intent-item"
              aria-pressed={intent === choice}
              onClick={() => {
                onChange(choice);
                close(true);
              }}
            >
              <span>
                {INTENT_META[choice].label}
                <small>{intentHint(choice, agent)}</small>
              </span>
              <Icon name="check" small className="pop__tick" />
            </button>
          ))}
        </>
      )}
    </ComposerPopover>
  );
}

/** The chip above the field while an intent other than Ask is chosen; its button goes back to Ask. */
export function IntentChip({ intent, onClear }: { intent: Intent; onClear(): void }) {
  const text = intentChip(intent);
  if (text === undefined) return null;
  return (
    <span className="composer__chip" role="status">
      <span>{text}</span>
      <button type="button" className="composer__chip-clear" aria-label="Back to Ask" onClick={onClear}>
        <Icon name="x" small />
      </button>
    </span>
  );
}
