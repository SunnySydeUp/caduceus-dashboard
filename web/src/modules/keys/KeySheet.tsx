import { useId, useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { checkTypedKey } from './key-actions.ts';
import { candidateKeys, keyNameProblem, keyValueProblem, keyVerdict, type KeyRow, type KeyVerdict } from './keys-model.ts';
import { VerdictLine } from './VerdictLine.tsx';
import './keys.css';
import './keys-page.css';

/** How many suggestions the list shows at once: a search narrows a catalogue of about a hundred variables. */
const SHOWN = 12;
/** The choice that is a variable of the owner's own. */
const OTHER = '\0other';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p className="field__error" id={id} role="alert">
      <Icon name="alert" small />
      {message}
    </p>
  ) : null;
}

export interface KeySheetProps {
  /** `replace` works on a key that is set; `add` picks one that is not (or names one of the owner's own). */
  mode: 'add' | 'replace';
  profile: string;
  /** The key being replaced. */
  replacing?: KeyRow;
  /** Every key Hermes knows, set or not: what `add` searches. */
  known: readonly KeyRow[];
  /** Saves it; resolves true when Hermes took it, which closes the sheet. */
  onSave(key: KeyRow, value: string): Promise<boolean>;
  onClose(): void;
}

/**
 * Add key and Replace key. The value is typed into a password field and lives only in this component while the sheet is open (it is
 * never put in a message, a toast or storage), and is dropped when the sheet closes. A key can be checked with Hermes's own validation
 * before it is saved.
 */
export function KeySheet({ mode, profile, replacing, known, onSave, onClose }: KeySheetProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | undefined>(replacing?.name);
  const [custom, setCustom] = useState('');
  const [value, setValue] = useState('');
  const [peek, setPeek] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState<'save' | 'check'>();
  const [verdict, setVerdict] = useState<KeyVerdict>();

  const candidates = useMemo(() => candidateKeys(known, query), [known, query]);
  const picked: KeyRow | undefined =
    replacing ?? (chosen === OTHER ? { name: custom.trim(), provider: '', providerLabel: '', description: '', url: undefined, isSet: false, secret: true, custom: true } : known.find((key) => key.name === chosen));
  const problems = {
    key: mode === 'add' ? (chosen === undefined ? 'Choose the key to add.' : chosen === OTHER ? keyNameProblem(custom) : undefined) : undefined,
    value: keyValueProblem(value),
  };
  const shown: Partial<typeof problems> = attempted ? problems : {};

  const check = async () => {
    if (!picked || problems.value || problems.key) return setAttempted(true);
    setBusy('check');
    setVerdict(undefined);
    const outcome = await checkTypedKey(picked.name, value.trim());
    setBusy(undefined);
    setVerdict(outcome.kind === 'done' ? keyVerdict(outcome.body) : { state: 'unreachable', text: outcome.kind === 'failed' ? outcome.message : 'The check was not run.' });
  };
  const submit = async () => {
    setAttempted(true);
    if (!picked || problems.value || problems.key) return;
    setBusy('save');
    const done = await onSave(picked, value.trim());
    setBusy(undefined);
    if (done) onClose();
  };

  const title = mode === 'add' ? `Add a key · ${profile}` : `Replace ${replacing?.name} · ${profile}`;
  const label = picked?.providerLabel || picked?.provider;
  return (
    <Sheet
      title={title}
      detents={['full']}
      className="ky-sheet"
      initialFocus="[data-first]"
      onClose={onClose}
      footer={
        <div className="ky-actions ky-foot">
          <WriteButton type="submit" form={id} className="btn btn--primary" disabled={busy !== undefined} aria-busy={busy === 'save'}>
            <Icon name="fingerprint" />
            {mode === 'add' ? 'Save key…' : 'Replace key…'}
          </WriteButton>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <form
        id={id}
        className="ky-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mode === 'add' && (
          <fieldset className="ky-pick">
            <legend className="field__label">Which key</legend>
            <input
              type="search"
              className="input"
              placeholder="Search providers and variables"
              aria-label="Search keys"
              autoComplete="off"
              spellCheck={false}
              value={query}
              data-first
              onChange={(event) => setQuery(event.target.value)}
            />
            <ul className="ky-pick__list" aria-label="Keys Hermes can use">
              {candidates.slice(0, SHOWN).map((key) => (
                <li key={key.name}>
                  <label className="ky-pick__item">
                    <input type="radio" name={`${id}-key`} checked={chosen === key.name} onChange={() => setChosen(key.name)} />
                    <span className="ky-pick__main">
                      <span className="mono ky-pick__name">{key.name}</span>
                      <span className="ky-pick__sub">{key.providerLabel || key.description}</span>
                    </span>
                  </label>
                </li>
              ))}
              <li>
                <label className="ky-pick__item">
                  <input type="radio" name={`${id}-key`} checked={chosen === OTHER} onChange={() => setChosen(OTHER)} />
                  <span className="ky-pick__main">
                    <span className="ky-pick__name">Another variable</span>
                    <span className="ky-pick__sub">A key for a service Hermes does not list, written to the profile’s .env under a name you choose.</span>
                  </span>
                </label>
              </li>
            </ul>
            {candidates.length > SHOWN && <p className="ky-note">{candidates.length - SHOWN} more match. Type more of the name to narrow the list.</p>}
            {chosen === OTHER && (
              <div className="field">
                <label className="field__label" htmlFor={`${id}-name`}>
                  Variable name
                </label>
                <input id={`${id}-name`} className="input input--mono" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={custom} aria-invalid={shown.key ? true : undefined} aria-describedby={shown.key ? `${id}-name-error` : undefined} onChange={(event) => setCustom(event.target.value)} />
                <FieldError id={`${id}-name-error`} message={shown.key} />
              </div>
            )}
            {chosen !== OTHER && <FieldError id={`${id}-pick-error`} message={shown.key} />}
          </fieldset>
        )}
        {mode === 'replace' && (
          <p className="ky-note">
            {label ? `${label} · ` : ''}
            <span className="mono">{replacing?.name}</span> is set for {profile}. The new value replaces it and the old one is dropped. The old value is not shown.
          </p>
        )}
        <div className="field">
          <label className="field__label" htmlFor={`${id}-value`}>
            {mode === 'replace' ? 'New value' : 'Value'}
          </label>
          <div className="ky-secret">
            <input
              id={`${id}-value`}
              className="input input--mono"
              type={peek ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Paste the key"
              value={value}
              data-first={mode === 'replace' ? '' : undefined}
              aria-invalid={shown.value ? true : undefined}
              aria-describedby={shown.value ? `${id}-value-error` : `${id}-value-help`}
              onChange={(event) => {
                setValue(event.target.value);
                setVerdict(undefined);
              }}
            />
            <button type="button" className="btn btn--ghost btn--icon" aria-label={peek ? 'Hide the value' : 'Show the value'} aria-pressed={peek} onClick={() => setPeek((now) => !now)}>
              <Icon name="eye" />
            </button>
          </div>
          <FieldError id={`${id}-value-error`} message={shown.value} />
          <p className="field__help" id={`${id}-value-help`}>
            Paste is allowed. Nothing is sent until you confirm with your passkey. The value goes to Hermes and nowhere else.
          </p>
        </div>
        <div className="ky-actions">
          <button type="button" className="btn btn--secondary" disabled={busy !== undefined} aria-busy={busy === 'check'} onClick={() => void check()}>
            <Icon name="heartbeat" />
            Check before saving
          </button>
        </div>
        {verdict && <VerdictLine verdict={verdict} />}
      </form>
    </Sheet>
  );
}
