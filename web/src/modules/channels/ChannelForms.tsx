import { useId } from 'react';
import { Icon } from '../../icons.tsx';
import type { BehaviourField, BehaviourSection, BehaviourValue, Channel, ChannelField } from './channels-model.ts';

/** The state of the connection form, which the drawer keeps so that its footer can save it. */
export interface ConnectionDraft {
  /** What was typed, by field key. */
  values: Record<string, string>;
  /** The fields to remove. */
  clear: Set<string>;
  enabled: boolean;
}

/** An address is safe to link to only when it is a web address. */
function webAddress(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function ConnectionField({ field, draft, problem, onChange }: { field: ChannelField; draft: ConnectionDraft; problem: string | undefined; onChange(next: ConnectionDraft): void }) {
  const id = useId();
  const removed = draft.clear.has(field.key);
  const link = webAddress(field.url);
  const describedBy = [field.description || field.url ? `${id}-help` : undefined, problem ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined;
  const toggleRemove = (remove: boolean) => {
    const clear = new Set(draft.clear);
    if (remove) clear.add(field.key);
    else clear.delete(field.key);
    onChange({ ...draft, clear, values: remove ? { ...draft.values, [field.key]: '' } : draft.values });
  };
  return (
    <div className="field ch-field">
      <label className="field__label" htmlFor={id}>
        {field.label}
        {field.required && <span className="ch-required"> (required)</span>}
      </label>
      <input
        id={id}
        className="input input--mono"
        // A credential is typed into a password box and is never shown again: Hermes only ever sends back its redaction.
        type={field.secret ? 'password' : 'text'}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={draft.values[field.key] ?? ''}
        disabled={removed}
        placeholder={removed ? 'Will be removed' : field.isSet ? `Set · ${field.redacted ?? '***'} · type to replace` : 'Not set'}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange({ ...draft, values: { ...draft.values, [field.key]: event.target.value } })}
      />
      {(field.description || link) && (
        <p className="field__help" id={`${id}-help`}>
          {field.description}
          {field.description && link ? ' ' : ''}
          {link && (
            <a href={link} target="_blank" rel="noreferrer noopener">
              Where to find it
            </a>
          )}
        </p>
      )}
      {problem && (
        <p className="field__error" id={`${id}-error`} role="alert">
          <Icon name="alert" small />
          {problem}
        </p>
      )}
      {field.isSet && !field.required && (
        <label className="check">
          <input type="checkbox" checked={removed} onChange={(event) => toggleRemove(event.target.checked)} />
          <span>Remove the saved value</span>
        </label>
      )}
    </div>
  );
}

/** The connection form of a channel: its credentials and settings from Hermes's own list of fields, each write-only. */
export function ConnectionForm({ channel, draft, problems, onChange, formId, onSubmit }: { channel: Channel; draft: ConnectionDraft; problems: Record<string, string>; onChange(next: ConnectionDraft): void; formId: string; onSubmit(): void }) {
  const enabledId = useId();
  const main = channel.fields.filter((field) => !field.advanced);
  const advanced = channel.fields.filter((field) => field.advanced);
  return (
    <form
      id={formId}
      className="ch-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <p className="help-text">Hermes never sends a saved value back. A saved value shows only as the hint Hermes gives (such as 1234…6789), and leaving a field empty keeps it as it is.</p>
      <div className="switch-row">
        <span id={enabledId} className="field__label">
          Enabled
        </span>
        <button type="button" role="switch" className="switch" aria-checked={draft.enabled} aria-labelledby={enabledId} onClick={() => onChange({ ...draft, enabled: !draft.enabled })} />
      </div>
      {main.map((field) => (
        <ConnectionField key={field.key} field={field} draft={draft} problem={problems[field.key]} onChange={onChange} />
      ))}
      {main.length === 0 && <p className="subtle">Hermes lists no settings for {channel.name} here. It may be set up from its own plugin, or from the command line.</p>}
      {advanced.length > 0 && (
        <details className="ch-advanced" open={advanced.some((field) => problems[field.key] !== undefined)}>
          <summary>Advanced ({advanced.length})</summary>
          <div className="ch-form">
            {advanced.map((field) => (
              <ConnectionField key={field.key} field={field} draft={draft} problem={problems[field.key]} onChange={onChange} />
            ))}
          </div>
        </details>
      )}
    </form>
  );
}

function BehaviourControl({ field, value, onChange }: { field: BehaviourField; value: BehaviourValue | undefined; onChange(next: BehaviourValue): void }) {
  const id = useId();
  const inherited = field.value === undefined;
  const helpId = `${id}-help`;
  const note = (
    <>
      {field.help && (
        <p className="field__help" id={helpId}>
          {field.help}
        </p>
      )}
      {inherited && <p className="field__help">Not set: Hermes uses its own default until you save a value.</p>}
    </>
  );
  const describedBy = field.help ? helpId : undefined;
  switch (field.kind) {
    case 'boolean':
      return (
        <div className="field ch-field">
          <div className="switch-row">
            <span id={id} className="field__label">
              {field.label}
            </span>
            <button type="button" role="switch" className="switch" aria-checked={value === true} aria-labelledby={id} aria-describedby={describedBy} onClick={() => onChange(value !== true)} />
          </div>
          {note}
        </div>
      );
    case 'select':
      return (
        <div className="field ch-field">
          <label className="field__label" htmlFor={id}>
            {field.label}
          </label>
          <select id={id} className="input" aria-describedby={describedBy} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
            {typeof value !== 'string' && <option value="">Hermes default</option>}
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {note}
        </div>
      );
    case 'number':
      return (
        <div className="field ch-field">
          <label className="field__label" htmlFor={id}>
            {field.label}
          </label>
          <input id={id} className="input" type="number" aria-describedby={describedBy} inputMode="decimal" step="any" value={typeof value === 'number' && Number.isFinite(value) ? value : ''} onChange={(event) => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))} />
          {note}
        </div>
      );
    case 'list':
      return (
        <div className="field ch-field">
          <label className="field__label" htmlFor={id}>
            {field.label}
          </label>
          <textarea id={id} className="input ch-lines" rows={3} value={Array.isArray(value) ? value.join('\n') : ''} aria-describedby={describedBy} onChange={(event) => onChange(event.target.value.split('\n'))} />
          <p className="field__help">One entry on each line.</p>
          {note}
        </div>
      );
    default:
      return (
        <div className="field ch-field">
          <label className="field__label" htmlFor={id}>
            {field.label}
          </label>
          <input id={id} className="input" type="text" aria-describedby={describedBy} autoComplete="off" value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />
          {note}
        </div>
      );
  }
}

/** The behaviour form: one control for each key, of the kind Hermes's config schema gives it. */
export function BehaviourForm({ sections, draft, onChange, formId, onSubmit }: { sections: readonly BehaviourSection[]; draft: Record<string, BehaviourValue>; onChange(key: string, value: BehaviourValue): void; formId: string; onSubmit(): void }) {
  return (
    <form
      id={formId}
      className="ch-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {sections.map((section) => (
        <fieldset key={section.id} className="ch-fieldset">
          <legend className="overline">{section.title}</legend>
          {section.fields.map((field) => (
            <BehaviourControl key={field.key} field={field} value={field.key in draft ? draft[field.key] : field.value} onChange={(next) => onChange(field.key, next)} />
          ))}
        </fieldset>
      ))}
    </form>
  );
}
