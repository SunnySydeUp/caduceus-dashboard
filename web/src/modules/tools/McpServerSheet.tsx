import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { argsOf, commandLine, formProblems, type FormProblems, type McpTransport, type ServerForm } from './mcp-model.ts';

const TRANSPORTS = [
  { value: 'http', label: 'HTTP' },
  { value: 'sse', label: 'SSE' },
  { value: 'stdio', label: 'Command' },
] as const satisfies readonly { value: McpTransport; label: string }[];

const AUTHS: Record<'none' | 'header' | 'oauth', string> = { none: 'No sign-in', header: 'Bearer token', oauth: 'OAuth (sign in after adding)' };

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p className="field__error" id={id} role="alert">
      <Icon name="alert" small />
      {message}
    </p>
  ) : null;
}

export interface McpServerSheetProps {
  /** `add`, or `edit` with the name of the server (its form starts from what Hermes has, and its name cannot change). */
  mode: 'add' | 'edit';
  initial: ServerForm;
  profile: string;
  /** Names that are taken (when adding). */
  names: readonly string[];
  /** When editing: the variables the server already has, whose values are kept when left blank. */
  keeps?: readonly string[];
  /** Whether the server already had a Bearer header (it can be kept, not retyped). */
  hadBearer?: boolean;
  onSubmit(form: ServerForm): Promise<boolean>;
  onClose(): void;
}

/** The add and edit form of an MCP server: a full-screen sheet on a phone, a dialog elsewhere. */
export function McpServerSheet({ mode, initial, profile, names, keeps, hadBearer, onSubmit, onClose }: McpServerSheetProps) {
  const id = useId();
  const transportLabel = `${id}-transport`;
  const [form, setForm] = useState<ServerForm>(initial);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const problems: FormProblems = formProblems(form, { names, keeps });
  const shown = attempted ? problems : {};
  const set = (change: Partial<ServerForm>) => setForm((current) => ({ ...current, ...change }));

  const submit = async () => {
    setAttempted(true);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    const done = await onSubmit(form);
    setBusy(false);
    if (done) onClose();
  };

  const stdio = form.transport === 'stdio';
  const authValues: ServerForm['auth'][] = ['none', ...(form.transport === 'http' && (mode === 'add' || hadBearer) ? (['header'] as const) : []), 'oauth'];
  const authOptions = authValues.map((value) => ({ value, label: AUTHS[value] }));
  const line = stdio && form.command.trim() ? commandLine(form.command.trim(), argsOf(form.args)) : undefined;

  return (
    <Sheet
      title={mode === 'add' ? `Add an MCP server · ${profile}` : `Edit ${initial.name} · ${profile}`}
      detents={['full']}
      className="tl-sheet"
      initialFocus="[data-first]"
      onClose={onClose}
      footer={
        <div className="tl-actions tl-foot">
          <WriteButton type="submit" form={id} className="btn btn--primary" disabled={busy} aria-busy={busy}>
            <Icon name="check" />
            {mode === 'add' ? 'Add server…' : 'Save changes…'}
          </WriteButton>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <form
        id={id}
        className="tl-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="tl-note">
          An <Term id="mcp-server">MCP server</Term> gives agents more tools. It is reached over a <Term id="mcp-transport">transport</Term>: a web address (HTTP or SSE) or a program Hermes starts (a command).
        </p>
        <div className="field">
          <span className="field__label" id={transportLabel}>
            Transport
          </span>
          <RadioGroup labelledBy={transportLabel} value={form.transport} options={TRANSPORTS} onChange={(transport) => set({ transport, auth: transport === 'sse' && form.auth === 'header' ? 'none' : form.auth })} className="seg" />
        </div>
        {mode === 'add' ? (
          <div className="field">
            <label className="field__label" htmlFor={`${id}-name`}>
              Name
            </label>
            <input id={`${id}-name`} data-first className="input input--mono" autoComplete="off" autoCapitalize="off" spellCheck={false} value={form.name} aria-invalid={shown.name ? true : undefined} aria-describedby={`${id}-name-error`} onChange={(event) => set({ name: event.target.value })} />
            <FieldError id={`${id}-name-error`} message={shown.name} />
          </div>
        ) : null}
        {stdio ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor={`${id}-command`}>
                Command
              </label>
              <input id={`${id}-command`} data-first={mode === 'edit' ? true : undefined} className="input input--mono" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="npx" value={form.command} aria-invalid={shown.command ? true : undefined} aria-describedby={`${id}-command-error`} onChange={(event) => set({ command: event.target.value })} />
              <FieldError id={`${id}-command-error`} message={shown.command} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`${id}-args`}>
                Arguments
              </label>
              <textarea id={`${id}-args`} className="input input--mono tl-area" rows={4} autoCapitalize="off" spellCheck={false} value={form.args} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/me/Documents'} aria-describedby={`${id}-args-help`} onChange={(event) => set({ args: event.target.value })} />
              <p className="field__help" id={`${id}-args-help`}>
                One argument per line, exactly as the program receives it.
              </p>
            </div>
            {line && (
              <p className="tl-note">
                Hermes will start: <code className="tl-code">{line}</code>
              </p>
            )}
            <fieldset className="tl-section">
              <legend>Variables for the program</legend>
              <p className="tl-note">Passed to the program as environment variables. {keeps?.length ? 'Saved values are never shown: leave a value blank to keep it.' : 'Hermes keeps them in the profile’s config.'}</p>
              {form.env.map((row, index) => (
                <div className="tl-envrow" key={index}>
                  <div className="field">
                    <label className="field__label" htmlFor={`${id}-env-key-${index}`}>
                      Variable {index + 1}
                    </label>
                    <input id={`${id}-env-key-${index}`} className="input input--mono" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="API_KEY" value={row.key} onChange={(event) => set({ env: form.env.map((current, at) => (at === index ? { ...current, key: event.target.value } : current)) })} />
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`${id}-env-value-${index}`}>
                      Value {index + 1}
                    </label>
                    <input
                      id={`${id}-env-value-${index}`}
                      className="input input--mono"
                      type="password"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      value={row.value}
                      placeholder={keeps?.includes(row.key.trim()) ? 'Saved · blank keeps' : ''}
                      onChange={(event) => set({ env: form.env.map((current, at) => (at === index ? { ...current, value: event.target.value } : current)) })}
                    />
                  </div>
                  <button type="button" className="btn btn--ghost btn--icon" aria-label={`Remove variable ${index + 1}`} onClick={() => set({ env: form.env.filter((_, at) => at !== index) })}>
                    <Icon name="x" />
                  </button>
                </div>
              ))}
              <FieldError id={`${id}-env-error`} message={shown.env} />
              <div className="tl-actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => set({ env: [...form.env, { key: '', value: '' }] })}>
                  <Icon name="plus" small />
                  Add a variable
                </button>
              </div>
            </fieldset>
          </>
        ) : (
          <>
            <div className="field">
              <label className="field__label" htmlFor={`${id}-url`}>
                Web address
              </label>
              <input id={`${id}-url`} data-first={mode === 'edit' ? true : undefined} className="input input--mono" type="url" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="https://mcp.example.com/mcp" value={form.url} aria-invalid={shown.url ? true : undefined} aria-describedby={`${id}-url-error`} onChange={(event) => set({ url: event.target.value })} />
              <FieldError id={`${id}-url-error`} message={shown.url} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`${id}-auth`}>
                Sign-in
              </label>
              <select id={`${id}-auth`} className="input" value={form.auth} aria-describedby={`${id}-auth-error`} onChange={(event) => set({ auth: event.target.value as ServerForm['auth'] })}>
                {authOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <FieldError id={`${id}-auth-error`} message={shown.auth} />
              {form.auth === 'oauth' && <p className="field__help">After adding, open the server and choose Sign in: Hermes runs the provider’s OAuth flow.</p>}
              {form.auth === 'header' && mode === 'edit' && <p className="field__help">The Bearer token stays as Hermes saved it.</p>}
            </div>
            {form.auth === 'header' && mode === 'add' && (
              <div className="field">
                <label className="field__label" htmlFor={`${id}-token`}>
                  Bearer token
                </label>
                <input id={`${id}-token`} className="input input--mono" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={form.bearerToken} aria-invalid={shown.bearerToken ? true : undefined} aria-describedby={`${id}-token-error ${id}-token-help`} onChange={(event) => set({ bearerToken: event.target.value })} />
                <FieldError id={`${id}-token-error`} message={shown.bearerToken} />
                <p className="field__help" id={`${id}-token-help`}>
                  Hermes keeps it in the profile’s .env file and never sends it back.
                </p>
              </div>
            )}
          </>
        )}
        {attempted && Object.keys(problems).length > 0 && (
          <p className="tl-note" role="status">
            Fix the fields marked above to continue.
          </p>
        )}
      </form>
    </Sheet>
  );
}
