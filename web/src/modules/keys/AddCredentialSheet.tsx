import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import './keys.css';
import './pool-endpoints.css';

type Problems = Partial<Record<'provider' | 'key', string>>;

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p className="field__error" id={id} role="alert">
      <Icon name="alert" small />
      {message}
    </p>
  ) : null;
}

export interface AddCredentialSheetProps {
  profile: string;
  /** The provider to add to, fixed; when absent the owner names one. */
  provider?: string;
  /** Providers that already have a pool: suggestions for the provider field. */
  providers: string[];
  /** Resolves true once Hermes has the credential. */
  onAdd(provider: string, key: string, label: string): Promise<boolean>;
  onClose(): void;
}

/** Adds an API key to a provider's pool. The key lives only in this sheet's state while it is open. */
export function AddCredentialSheet({ profile, provider: fixed, providers, onAdd, onClose }: AddCredentialSheetProps) {
  const id = useId();
  const [provider, setProvider] = useState(fixed ?? '');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [shown, setShown] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const problems: Problems = {};
  if (provider.trim() === '') problems.provider = 'Name the provider, such as openrouter or anthropic.';
  else if (/\s/.test(provider.trim())) problems.provider = 'A provider name has no spaces.';
  if (key.trim() === '') problems.key = 'Paste the API key.';
  else if (/\s/.test(key.trim())) problems.key = 'An API key has no spaces or line breaks.';
  const visible: Problems = attempted ? problems : {};

  const close = () => {
    setKey('');
    onClose();
  };

  const submit = async () => {
    setAttempted(true);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    const done = await onAdd(provider.trim().toLowerCase(), key.trim(), label.trim());
    setBusy(false);
    if (done) close();
  };

  return (
    <Sheet
      title={fixed ? `Add to the ${fixed} pool · ${profile}` : `Add a credential · ${profile}`}
      detents={['full']}
      className="ky-sheet"
      initialFocus="[data-first]"
      onClose={close}
      footer={
        <div className="ky-actions">
          <WriteButton type="submit" form={id} className="btn btn--primary" disabled={busy} aria-busy={busy}>
            <Icon name="check" />
            Add credential…
          </WriteButton>
          <button type="button" className="btn btn--ghost" onClick={close}>
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
        <p className="ky-note">Hermes keeps this key in the profile’s auth store, with the others for the same provider, and rotates between them. It is never shown again.</p>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-provider`}>
            Provider
          </label>
          <input
            id={`${id}-provider`}
            data-first={fixed ? undefined : true}
            className="input input--mono"
            list={fixed ? undefined : `${id}-providers`}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="openrouter"
            readOnly={fixed !== undefined}
            required
            value={provider}
            aria-invalid={visible.provider ? true : undefined}
            aria-describedby={`${id}-provider-error`}
            onChange={(event) => setProvider(event.target.value)}
          />
          {!fixed && (
            <datalist id={`${id}-providers`}>
              {providers.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
          <FieldError id={`${id}-provider-error`} message={visible.provider} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-key`}>
            API key
          </label>
          <div className="ky-secret">
            <input
              id={`${id}-key`}
              data-first={fixed ? true : undefined}
              className="input input--mono"
              type={shown ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              value={key}
              aria-invalid={visible.key ? true : undefined}
              aria-describedby={`${id}-key-error`}
              onChange={(event) => setKey(event.target.value)}
            />
            <button type="button" className="btn btn--secondary btn--icon" aria-label="Show API key" aria-pressed={shown} onClick={() => setShown((current) => !current)}>
              <Icon name="eye" />
            </button>
          </div>
          <FieldError id={`${id}-key-error`} message={visible.key} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-label`}>
            Label (optional)
          </label>
          <input id={`${id}-label`} className="input" autoComplete="off" spellCheck={false} placeholder="Work account" value={label} aria-describedby={`${id}-label-help`} onChange={(event) => setLabel(event.target.value)} />
          <p className="field__help" id={`${id}-label-help`}>
            A name to tell keys apart in the list. Hermes numbers a key that has none.
          </p>
        </div>
        {attempted && Object.keys(problems).length > 0 && (
          <p className="ky-note" role="status">
            Fix the fields marked above to continue.
          </p>
        )}
      </form>
    </Sheet>
  );
}
