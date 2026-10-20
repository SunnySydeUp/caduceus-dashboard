import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { runProviderSetup, saveProviderForm, startProviderSignIn, type SetupResult } from './memory-actions.ts';
import { useProviderDetail, useSignInWatch } from './memory-data.ts';
import { formProblems, visibleFields, type Edits, type FormField, type MemoryProvider, type OauthStatus, type ProviderForm } from './memory-model.ts';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p className="field__error" id={id} role="alert">
      <Icon name="alert" small />
      {message}
    </p>
  ) : null;
}

/** One field of a provider's form, drawn from what Hermes says the field is. */
function FormInput({ field, value, error, onChange }: { field: FormField; value: string; error: string | undefined; onChange(value: string): void }) {
  const id = useId();
  const describedBy = [field.description ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const common = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy } as const;
  const help = (
    <>
      {field.description && (
        <p className="field__help" id={`${id}-help`}>
          {field.description}
        </p>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </>
  );
  if (field.kind === 'bool') {
    return (
      <div className="field">
        <div className="switch-row">
          <label className="field__label" htmlFor={id}>
            {field.label}
          </label>
          <WriteButton type="button" role="switch" className="switch" {...common} aria-checked={value === 'true'} onClick={() => onChange(value === 'true' ? 'false' : 'true')} />
        </div>
        {help}
      </div>
    );
  }
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {field.label}
        {field.required ? ' (required)' : ''}
      </label>
      {field.kind === 'select' ? (
        <select {...common} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.kind === 'json' ? (
        <textarea {...common} className="input input--mono mm-area" rows={5} spellCheck={false} autoCapitalize="off" value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          className={field.kind === 'secret' || field.kind === 'number' ? 'input input--mono' : 'input'}
          type={field.kind === 'secret' ? 'password' : 'text'}
          inputMode={field.kind === 'number' ? 'decimal' : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          placeholder={field.kind === 'secret' && field.isSet ? 'Saved · leave empty to keep' : field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {help}
      {field.url && (
        <p className="field__help">
          <a href={field.url} target="_blank" rel="noreferrer noopener">
            Where to get one
          </a>
        </p>
      )}
    </div>
  );
}

/** The provider's own sign-in: connect with the provider's page, then Hermes says whether it worked and, if not, why. */
function SignIn({ name, profile, status, onStatus }: { name: string; profile: string; status: OauthStatus; onStatus(status: OauthStatus): void }) {
  const [busy, setBusy] = useState(false);
  useSignInWatch(name, profile, status.state === 'pending', onStatus);

  const start = async () => {
    setBusy(true);
    const outcome = await startProviderSignIn(name, profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done' && outcome.body) onStatus(outcome.body);
  };

  return (
    <section className="mm-box" aria-label={`Sign in to ${name}`}>
      <h3>Sign in</h3>
      {status.state === 'connected' || (status.state === 'idle' && status.connected) ? (
        <div className="banner" data-tone="success" role="status">
          <Icon name="check" />
          <span className="banner__content">Connected{status.auth === 'oauth' ? ' with a sign-in' : status.auth === 'apikey' ? ' with an API key' : ''}. Hermes keeps the credential for this profile.</span>
        </div>
      ) : null}
      {status.state === 'pending' && (
        <p role="status" className="mm-note">
          Waiting for the sign-in page: Hermes opened it in the browser of the computer it runs on. Sign in there and allow access; this page updates when Hermes has the answer.
        </p>
      )}
      {status.state === 'error' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">The sign-in did not finish{status.detail ? `: ${status.detail}` : '.'}</span>
        </div>
      )}
      {status.state !== 'pending' && (
        <>
          <p className="mm-note">Connecting opens the provider’s sign-in page on the computer that runs Hermes, so do it at that computer. Caduceus never sees your password.</p>
          <div className="mm-actions">
            <WriteButton type="button" className="btn btn--secondary" disabled={busy} aria-busy={busy} onClick={() => void start()}>
              <Icon name="key" />
              {status.connected || status.state === 'connected' ? 'Connect again…' : 'Connect…'}
            </WriteButton>
          </div>
        </>
      )}
    </section>
  );
}

/** What a provider needs installed, with the button that makes Hermes install it, and how the last run went. */
function Setup({ provider, profile, onDone }: { provider: MemoryProvider; profile: string; onDone(): void }) {
  const [result, setResult] = useState<SetupResult>();
  const [busy, setBusy] = useState(false);
  const setup = provider.setup;
  if (!setup) return null;
  const needs = [...setup.pipDependencies.map((dependency) => `Python package ${dependency}`), ...setup.externalDependencies.map((dependency) => `${dependency.name}${dependency.install ? `: ${dependency.install}` : ''}`)];

  const run = async () => {
    setBusy(true);
    const outcome = await runProviderSetup(provider, profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    setResult(outcome.body);
    toast(outcome.body.ok ? `${provider.name} is set up` : `Setting up ${provider.name} did not finish`, { tone: outcome.body.ok ? 'success' : 'danger' });
    onDone();
  };

  return (
    <section className="mm-box" aria-label={`Set up ${provider.name}`}>
      <h3>Set up</h3>
      {setup.installed ? (
        <p className="mm-note">Everything {provider.name} needs is installed.</p>
      ) : (
        <>
          <p className="mm-note">Hermes needs these before it can use {provider.name}:</p>
          <ul>
            {needs.map((need) => (
              <li key={need} className="mm-code">
                {need}
              </li>
            ))}
          </ul>
          <p className="mm-note">Set up runs them on this computer, with the access of your account, so it is a Tier 3 action: you type the provider’s name.</p>
          <div className="mm-actions">
            <WriteButton type="button" className="btn btn--secondary" disabled={busy} aria-busy={busy} onClick={() => void run()}>
              <Icon name="package" />
              Run setup…
            </WriteButton>
          </div>
        </>
      )}
      {setup.requiredEnv.length > 0 && <p className="mm-note">It also needs the environment variable {setup.requiredEnv.join(', ')}, which you can add on the Keys screen.</p>}
      {result && (
        <ul className="mm-steps" aria-label="What setup did">
          {result.steps.map((step, index) => (
            <li key={index}>
              <strong>{step.name || step.kind}</strong>: {step.status.replaceAll('_', ' ')}
              {step.stderr && step.status === 'failed' && <span className="mm-code"> {step.stderr}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A provider's settings: a full-screen sheet on a phone, a dialog elsewhere, built from the form Hermes gives. */
export function ProviderSheet({ provider, profile, reload, onClose }: { provider: MemoryProvider; profile: string; reload(): Promise<void>; onClose(): void }) {
  const id = useId();
  const detail = useProviderDetail(provider.name, profile);
  const [edits, setEdits] = useState<Edits>({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const loaded = detail.value;
  const form: ProviderForm | undefined = loaded?.form;
  const problems = form ? formProblems(form, edits) : {};
  const shown = attempted ? problems : {};

  const submit = async () => {
    if (!form) return;
    setAttempted(true);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    const outcome = await saveProviderForm(form, edits, profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Saved the ${provider.name} settings for ${profile}`, { detail: `${provider.name} is now its memory provider.` });
    await Promise.all([reload(), detail.reload()]);
    setEdits({});
    setAttempted(false);
  };

  const groups = form ? [...new Set(visibleFields(form, edits).map((field) => field.group))] : [];
  return (
    <Sheet
      title={`${provider.name} · ${profile}`}
      detents={['full']}
      className="mm-sheet"
      onClose={onClose}
      footer={
        form && form.fields.length > 0 ? (
          <div className="mm-actions mm-foot">
            <WriteButton type="submit" form={id} className="btn btn--primary" disabled={busy} aria-busy={busy}>
              <Icon name="check" />
              Save settings…
            </WriteButton>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Close
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="mm-form">
        <p className="mm-note">{provider.description}</p>
        {detail.failed && !loaded && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">Hermes did not answer, so the settings could not be read.</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void detail.reload()}>
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        )}
        {!loaded && !detail.failed && <p role="status">Loading the settings…</p>}
        {loaded && <Setup provider={provider} profile={profile} onDone={() => void Promise.all([reload(), detail.reload()])} />}
        {loaded?.oauth && <SignIn name={provider.name} profile={profile} status={loaded.oauth} onStatus={(status) => (detail.setOauth(status), status.state === 'connected' && void Promise.all([reload(), detail.reload()]))} />}
        {form && form.fields.length === 0 && <p className="mm-note">{provider.name} has no settings Hermes can show. It reads its own configuration files or environment.</p>}
        {form && form.fields.length > 0 && (
          <form
            id={id}
            className="mm-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p className="mm-note">
              Saving also makes {provider.name} the <Term id="memory-provider">memory provider</Term> of {profile}. Saved keys are never shown: leave a key empty to keep it.
              {form.docsUrl && (
                <>
                  {' '}
                  <a href={form.docsUrl} target="_blank" rel="noreferrer noopener">
                    Documentation
                  </a>
                </>
              )}
            </p>
            {groups.map((group) => (
              <fieldset className="mm-group" key={group}>
                {group && <legend>{group}</legend>}
                {visibleFields(form, edits)
                  .filter((field) => field.group === group)
                  .map((field) => (
                    <FormInput key={field.key} field={field} value={edits[field.key] ?? field.value} error={shown[field.key]} onChange={(value) => setEdits((current) => ({ ...current, [field.key]: value }))} />
                  ))}
              </fieldset>
            ))}
            {attempted && Object.keys(problems).length > 0 && (
              <p className="mm-note" role="status">
                Fix the fields marked above to continue.
              </p>
            )}
          </form>
        )}
      </div>
    </Sheet>
  );
}
