import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { checkEndpoint } from './endpoint-actions.ts';
import { API_MODES, endpointProblems, type ApiMode, type EndpointCheck, type EndpointField, type EndpointForm } from './keys-model.ts';
import './keys.css';
import './pool-endpoints.css';

/** How many of an endpoint's models the verdict names before it says "and N more". */
const MODELS_SHOWN = 8;

type Verdict = { kind: 'checked'; check: EndpointCheck } | { kind: 'error'; message: string };

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p className="field__error" id={id} role="alert">
      <Icon name="alert" small />
      {message}
    </p>
  ) : null;
}

function VerdictBox({ verdict, model, savedKeyNote, onPick }: { verdict: Verdict | undefined; model: string; savedKeyNote: boolean; onPick(model: string): void }) {
  if (!verdict) return <div role="status" />;
  const check = verdict.kind === 'checked' ? verdict.check : undefined;
  const tone = check?.ok ? 'success' : check?.reachable ? 'warning' : 'danger';
  const shown = check?.models.slice(0, MODELS_SHOWN) ?? [];
  return (
    <div role="status">
      <div className="banner ky-pe-verdict" data-tone={tone}>
        <Icon name={tone === 'success' ? 'check' : 'alert'} />
        <div className="banner__content">
          {check?.ok ? (
            <p>
              {check.models.length === 0 ? 'Reachable. It did not list any models.' : `Reachable. It lists ${check.models.length} ${check.models.length === 1 ? 'model' : 'models'}:`}
            </p>
          ) : (
            <p>{check ? `${check.reachable ? '' : 'Could not reach the address. '}${check.message || (check.reachable ? 'The address answered, but the check did not pass.' : '')}`.trim() : verdict.kind === 'error' ? verdict.message : ''}</p>
          )}
          {check?.ok && check.message && <p className="ky-note">{check.message}</p>}
          {shown.length > 0 && (
            <div className="ky-pe-models">
              {shown.map((name) => (
                <button key={name} type="button" className="btn btn--secondary btn--sm mono ky-pe-model" aria-pressed={model === name} onClick={() => onPick(name)}>
                  {name}
                </button>
              ))}
              {check && check.models.length > shown.length && <span className="ky-note">and {check.models.length - shown.length} more</span>}
            </div>
          )}
          {shown.length > 0 && <p className="ky-note">Choose a model to put it in the Model field.</p>}
          {savedKeyNote && <p className="ky-note">This check did not send the saved key.</p>}
        </div>
      </div>
    </div>
  );
}

export interface EndpointSheetProps {
  mode: 'add' | 'edit';
  /** What the form starts as: empty to add, what Hermes lists to edit (an edit keeps the endpoint's id, so its name can change). */
  initial: EndpointForm;
  /** Whether Hermes holds a key for the endpoint: it is kept unless one is typed or removal is chosen. */
  hadKey: boolean;
  profile: string;
  /** Resolves true once Hermes has saved the endpoint. */
  onSave(form: EndpointForm): Promise<boolean>;
  onClose(): void;
}

/** The add and edit form of a custom endpoint. A key typed here lives only in this sheet's state while it is open. */
export function EndpointSheet({ mode, initial, hadKey, profile, onSave, onClose }: EndpointSheetProps) {
  const id = useId();
  const [form, setForm] = useState<EndpointForm>(initial);
  const [shownKey, setShownKey] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<EndpointField, true>>>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>();

  const problems = endpointProblems(form);
  const failing = Object.keys(problems).length > 0;
  const visible = (field: EndpointField): string | undefined => (attempted || touched[field] ? problems[field] : undefined);
  const touch = (field: EndpointField) => setTouched((current) => ({ ...current, [field]: true }));
  const set = (change: Partial<EndpointForm>) => {
    setForm((current) => ({ ...current, ...change }));
    // What the last check found was about the old address, key or API.
    if ('baseUrl' in change || 'apiKey' in change || 'apiMode' in change) setVerdict(undefined);
  };

  const close = () => {
    setForm((current) => ({ ...current, apiKey: '' }));
    onClose();
  };

  const submit = async () => {
    setAttempted(true);
    if (failing) return;
    setBusy(true);
    const done = await onSave(form);
    setBusy(false);
    if (done) close();
  };

  const check = async () => {
    if (problems.baseUrl || problems.apiKey) {
      setTouched((current) => ({ ...current, baseUrl: true, apiKey: true }));
      return;
    }
    setChecking(true);
    const outcome = await checkEndpoint(form, profile);
    setChecking(false);
    if (outcome.kind === 'cancelled') return;
    setVerdict(outcome.kind === 'done' ? { kind: 'checked', check: outcome.body } : { kind: 'error', message: outcome.message });
  };

  const keptKey = mode === 'edit' && hadKey;
  const errorOf = (field: EndpointField) => `${id}-${field}-error`;

  return (
    <Sheet
      title={mode === 'add' ? `Add a custom endpoint · ${profile}` : `Edit ${initial.name} · ${profile}`}
      detents={['full']}
      className="ky-sheet"
      initialFocus="[data-first]"
      onClose={close}
      footer={
        <div className="ky-actions">
          <WriteButton type="submit" form={id} className="btn btn--primary" disabled={busy || (attempted && failing)} aria-busy={busy}>
            <Icon name="check" />
            {mode === 'add' ? 'Add endpoint…' : 'Save changes…'}
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
        <div className="field">
          <label className="field__label" htmlFor={`${id}-name`}>
            Name
          </label>
          <input id={`${id}-name`} data-first className="input" autoComplete="off" spellCheck={false} placeholder="Home server" required value={form.name} aria-invalid={visible('name') ? true : undefined} aria-describedby={errorOf('name')} onBlur={() => touch('name')} onChange={(event) => set({ name: event.target.value })} />
          <FieldError id={errorOf('name')} message={visible('name')} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-baseUrl`}>
            Address
          </label>
          <input
            id={`${id}-baseUrl`}
            className="input input--mono"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="http://127.0.0.1:8000/v1"
            required
            value={form.baseUrl}
            aria-invalid={visible('baseUrl') ? true : undefined}
            aria-describedby={`${errorOf('baseUrl')} ${id}-baseUrl-help`}
            onBlur={() => touch('baseUrl')}
            onChange={(event) => set({ baseUrl: event.target.value })}
          />
          <FieldError id={errorOf('baseUrl')} message={visible('baseUrl')} />
          <p className="field__help" id={`${id}-baseUrl-help`}>
            The base URL of the server’s API, usually ending in /v1.
          </p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-model`}>
            Model
          </label>
          <input id={`${id}-model`} className="input input--mono" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="llama-3.1-8b-instruct" required value={form.model} aria-invalid={visible('model') ? true : undefined} aria-describedby={errorOf('model')} onBlur={() => touch('model')} onChange={(event) => set({ model: event.target.value })} />
          <FieldError id={errorOf('model')} message={visible('model')} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-apiKey`}>
            API key (optional)
          </label>
          <div className="ky-secret">
            <input
              id={`${id}-apiKey`}
              className="input input--mono"
              type={shownKey ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={keptKey ? 'Leave empty to keep the saved key' : ''}
              disabled={form.clearKey}
              value={form.apiKey}
              aria-invalid={visible('apiKey') ? true : undefined}
              aria-describedby={`${errorOf('apiKey')} ${id}-apiKey-help`}
              onBlur={() => touch('apiKey')}
              onChange={(event) => set({ apiKey: event.target.value })}
            />
            <button type="button" className="btn btn--secondary btn--icon" aria-label="Show API key" aria-pressed={shownKey} disabled={form.clearKey} onClick={() => setShownKey((current) => !current)}>
              <Icon name="eye" />
            </button>
          </div>
          <FieldError id={errorOf('apiKey')} message={visible('apiKey')} />
          <p className="field__help" id={`${id}-apiKey-help`}>
            Hermes stores it in the profile’s environment and never shows it again. Servers on your own machine often need none.
          </p>
          {keptKey && (
            <label className="check">
              <input type="checkbox" checked={form.clearKey} onChange={(event) => set({ clearKey: event.target.checked, apiKey: event.target.checked ? '' : form.apiKey })} />
              <span>Remove the saved key</span>
            </label>
          )}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-apiMode`}>
            API
          </label>
          <select id={`${id}-apiMode`} className="input" value={form.apiMode} onChange={(event) => set({ apiMode: event.target.value as ApiMode })}>
            {API_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-contextLength`}>
            Context window in tokens (optional)
          </label>
          <input id={`${id}-contextLength`} className="input input--mono" inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="32768" value={form.contextLength} aria-invalid={visible('contextLength') ? true : undefined} aria-describedby={`${errorOf('contextLength')} ${id}-contextLength-help`} onBlur={() => touch('contextLength')} onChange={(event) => set({ contextLength: event.target.value })} />
          <FieldError id={errorOf('contextLength')} message={visible('contextLength')} />
          <p className="field__help" id={`${id}-contextLength-help`}>
            Leave it empty and Hermes works it out.
          </p>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.discoverModels} onChange={(event) => set({ discoverModels: event.target.checked })} />
          <span>Let Hermes discover the endpoint’s models</span>
        </label>
        <div className="ky-pe-check">
          <button type="button" className="btn btn--secondary" disabled={checking} aria-busy={checking} onClick={() => void check()}>
            <Icon name="heartbeat" />
            Check endpoint
          </button>
          <p className="ky-note">Asks the address for its models and tries a request. It sends the key typed above, if any.</p>
        </div>
        <VerdictBox verdict={verdict} model={form.model.trim()} savedKeyNote={keptKey && form.apiKey.trim() === ''} onPick={(model) => set({ model })} />
        {attempted && failing && (
          <p className="ky-note" role="status">
            Fix the fields marked above to continue.
          </p>
        )}
      </form>
    </Sheet>
  );
}
