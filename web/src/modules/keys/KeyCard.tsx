import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { removeKey, revealKey, testKey } from './key-actions.ts';
import { keyVerdict, type KeyRow, type KeyVerdict } from './keys-model.ts';
import { VerdictLine } from './VerdictLine.tsx';

/** How long a revealed key stays on screen. */
export const REVEAL_SECONDS = 30;
/** How long a copied key stays on the clipboard, where the browser lets the page clear it. */
const CLIPBOARD_CLEAR_MS = 60_000;

/** Puts a revealed key on the clipboard and clears the clipboard 60 seconds later, where the browser allows it. A reload of the page cancels the clearing. */
function copySecret(value: string): void {
  void navigator.clipboard?.writeText(value).then(
    () => {
      toast('Copied the key', { detail: 'Caduceus clears the clipboard in 60 seconds where the browser allows it.', timeout: 4000 });
      setTimeout(() => void navigator.clipboard?.writeText('').catch(() => undefined), CLIPBOARD_CLEAR_MS);
    },
    () => toast('Could not copy: this browser did not allow it. Select the key by hand.', { tone: 'warning' }),
  );
}

/**
 * A revealed key and its countdown. The value lives only in this component: when the time is up, when the page is hidden or when the
 * component goes away, it is dropped, and it is never written anywhere (no storage, no URL, no log).
 */
function Revealed({ keyName, value, onHide }: { keyName: string; value: string; onHide(): void }) {
  const [left, setLeft] = useState(REVEAL_SECONDS);
  const hide = useRef(onHide);
  hide.current = onHide;
  useEffect(() => {
    const tick = setInterval(() => setLeft((now) => now - 1), 1000);
    const away = () => document.visibilityState === 'hidden' && hide.current();
    document.addEventListener('visibilitychange', away);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', away);
    };
  }, []);
  useEffect(() => {
    if (left <= 0) hide.current();
  }, [left]);
  return (
    <div className="ky-reveal" role="group" aria-label={`${keyName} revealed`}>
      <code className="ky-reveal__value mono" data-testid="revealed-key">
        {value}
      </code>
      <p className="ky-reveal__time" role="timer" aria-live="off">
        Hides in {Math.max(left, 0)} s
      </p>
      <div className="ky-actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => copySecret(value)}>
          <Icon name="copy" small />
          Copy
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onHide}>
          <Icon name="lock" small />
          Hide now
        </button>
      </div>
    </div>
  );
}

interface MenuAction {
  id: string;
  icon: 'refresh' | 'trash';
  label: string;
  sub: string;
  danger?: boolean;
  run(): void;
}

function KeyMenu({ keyRow, actions, onClose }: { keyRow: KeyRow; actions: MenuAction[]; onClose(): void }) {
  return (
    <Sheet title={keyRow.name} onClose={onClose}>
      <ul className="pf-acts">
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              className={`pf-act${action.danger ? ' pf-act--danger' : ''}`}
              onClick={() => {
                onClose();
                // The sheet is closed before the next dialog opens, so the layers never stack.
                void closeAllLayers().then(action.run);
              }}
            >
              <Icon name={action.icon} />
              <span>
                <span>{action.label}</span>
                <small>{action.sub}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** One key that is set: masked, with Reveal and Test connection on the card and Replace and Remove in its menu. No gesture does anything here. */
export function KeyCard({ keyRow, profile, onReplace, onChanged }: { keyRow: KeyRow; profile: string; onReplace(key: KeyRow): void; onChanged(): Promise<void> }) {
  const [value, setValue] = useState<string>();
  const [busy, setBusy] = useState<'reveal' | 'test' | 'remove'>();
  const [verdict, setVerdict] = useState<KeyVerdict>();
  const [menu, setMenu] = useState(false);

  const reveal = async () => {
    setBusy('reveal');
    const outcome = await revealKey(keyRow, profile, REVEAL_SECONDS);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setValue(outcome.body);
  };
  const test = async () => {
    setBusy('test');
    setVerdict(undefined);
    const outcome = await testKey(keyRow, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setVerdict(keyVerdict(outcome.body));
  };
  const remove = async () => {
    setBusy('remove');
    const outcome = await removeKey(keyRow, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      setValue(undefined);
      toast(`Removed ${keyRow.name} from ${profile}`, { detail: 'Recorded in the audit log.' });
      await onChanged();
    }
  };

  const label = keyRow.providerLabel || keyRow.provider;
  return (
    <li className="ky-card" data-key={keyRow.name}>
      <div className="ky-card__top">
        <div className="ky-card__id">
          <h3 className="ky-card__name ky-card__name--mono">{keyRow.name}</h3>
          {label && <p className="ky-card__sub">{label}</p>}
        </div>
        <StatusBadge state="online" label="Set" variant="plain" />
      </div>
      {keyRow.description && <p className="ky-card__sub">{keyRow.description}</p>}
      {value === undefined ? (
        <code className="ky-url mono ky-masked" aria-label="The value is hidden">
          ••••••••••••••••
        </code>
      ) : (
        <Revealed keyName={keyRow.name} value={value} onHide={() => setValue(undefined)} />
      )}
      {verdict && <VerdictLine verdict={verdict} />}
      <div className="ky-card__actions">
        {value === undefined && (
          <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-busy={busy === 'reveal'} aria-label={`Reveal ${keyRow.name}`} onClick={() => void reveal()}>
            <Icon name="eye" small />
            Reveal…
          </WriteButton>
        )}
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-busy={busy === 'test'} aria-label={`Test connection of ${keyRow.name}`} onClick={() => void test()}>
          <Icon name="heartbeat" small />
          Test connection
        </button>
        <button type="button" className="btn btn--ghost btn--icon ky-card__more" aria-label={`Actions for ${keyRow.name}`} aria-haspopup="dialog" onClick={() => setMenu(true)}>
          <Icon name="dots-v" />
        </button>
      </div>
      {menu && (
        <KeyMenu
          keyRow={keyRow}
          onClose={() => setMenu(false)}
          actions={[
            { id: 'replace', icon: 'refresh', label: 'Replace…', sub: `Tier 2 · for ${profile}`, run: () => onReplace(keyRow) },
            { id: 'remove', icon: 'trash', label: 'Remove…', sub: `Tier 2 · from ${profile}`, danger: true, run: () => void remove() },
          ]}
        />
      )}
    </li>
  );
}
