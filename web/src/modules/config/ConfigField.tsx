import { useEffect, useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { canReset, readInput, type ConfigField as Field, type ConfigValue } from './config-model.ts';

/** The id of a field's row in the page, which a link to the field scrolls to. */
export const fieldDomId = (key: string) => `cf-${key.replace(/[^a-z0-9]/gi, '-')}`;

/** A value as the box shows it. */
function textOf(value: ConfigValue): string {
  return Array.isArray(value) ? value.join('\n') : value === null ? '' : String(value);
}

interface ControlProps {
  field: Field;
  value: ConfigValue;
  labelId: string;
  describedBy: string;
  onStage(value: ConfigValue): void;
  /** Drops the edit, so the field is what Hermes has again. */
  onUndo(): void;
  onProblem(problem: string | undefined): void;
}

/** A text, number or list box. It keeps what is typed until it can be read, and takes the value again when something else (a reset) changes it. */
function TextControl({ field, value, labelId, describedBy, onStage, onProblem }: ControlProps) {
  const [text, setText] = useState(textOf(value));
  useEffect(() => {
    // A change from outside (Reset, Discard) shows; what the box already says, however it is spelt, stays as typed.
    const read = readInput(field, text);
    if (!('value' in read) || textOf(read.value) !== textOf(value)) {
      setText(textOf(value));
      onProblem(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new value from outside is a reason to replace the text
  }, [value]);

  const change = (next: string) => {
    setText(next);
    const read = readInput(field, next);
    if ('problem' in read) {
      onProblem(read.problem);
      return;
    }
    onProblem(undefined);
    onStage(read.value);
  };
  const common = { id: `${fieldDomId(field.key)}-c`, 'aria-labelledby': labelId, 'aria-describedby': describedBy, value: text, spellCheck: false, autoCapitalize: 'off', autoComplete: 'off' } as const;
  if (field.kind === 'list') return <textarea {...common} className="input input--mono" rows={Math.min(8, Math.max(3, text.split('\n').length + 1))} onChange={(event) => change(event.target.value)} />;
  if (field.kind === 'number') return <input {...common} className="input input--mono" type="text" inputMode="decimal" onChange={(event) => change(event.target.value)} />;
  return <input {...common} className="input input--mono" type="text" onChange={(event) => change(event.target.value)} />;
}

/** A credential: set or not, never shown. Typing replaces it; Clear removes it. */
function SecretControl({ field, value, labelId, describedBy, onStage, onUndo }: ControlProps) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (value === '' || value === null) setText('');
  }, [value]);
  const clearing = value === '' && field.secretSet;
  return (
    <div className="cf-secret">
      <input
        id={`${fieldDomId(field.key)}-c`}
        className="input input--mono"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        value={text}
        placeholder={clearing ? 'Will be cleared' : field.secretSet ? 'Set. Type to replace it' : 'Not set'}
        onChange={(event) => {
          setText(event.target.value);
          // Emptying the box is taking back what was typed, not clearing the credential: that is what Clear is for.
          if (event.target.value === '') onUndo();
          else onStage(event.target.value);
        }}
      />
      {field.secretSet && !clearing && (
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => {
            setText('');
            onStage('');
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

function Control(props: ControlProps) {
  const { field, value, labelId, describedBy, onStage } = props;
  if (field.readOnlyReason) return <code className="cf-readonly">{textOf(value) || 'empty'}</code>;
  if (field.secret) return <SecretControl {...props} />;
  if (field.kind === 'boolean') {
    return (
      <button type="button" id={`${fieldDomId(field.key)}-c`} className="switch" role="switch" aria-checked={value === true} aria-labelledby={labelId} aria-describedby={describedBy} onClick={() => onStage(value !== true)}>
        <span className="sr-only">{value === true ? 'On' : 'Off'}</span>
      </button>
    );
  }
  if (field.kind === 'select') {
    return (
      <select id={`${fieldDomId(field.key)}-c`} className="input" aria-labelledby={labelId} aria-describedby={describedBy} value={typeof value === 'string' ? value : ''} onChange={(event) => onStage(event.target.value)}>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option === '' ? '(not set)' : option}
          </option>
        ))}
      </select>
    );
  }
  return <TextControl {...props} />;
}

/** What a default is called when it is on the screen. */
function defaultText(field: Field): string {
  if (field.secret) return 'not set';
  if (field.kind === 'boolean') return field.default ? 'on' : 'off';
  if (Array.isArray(field.default)) return field.default.length === 0 ? 'empty' : field.default.join(', ');
  return field.default === null || field.default === '' ? 'empty' : String(field.default);
}

export interface FieldRowProps {
  field: Field;
  /** The edit waiting to be saved for the field, if there is one. */
  staged: ConfigValue | undefined;
  /** A link points at this field: it is highlighted. */
  linked: boolean;
  onStage(field: Field, value: ConfigValue): void;
  onUndo(field: Field): void;
  onReset(field: Field): void;
  onCopyLink(field: Field): void;
}

/** One setting: its name, what Hermes says about it, how it differs from the default, its control, and Reset and Copy link. */
export function FieldRow({ field, staged, linked, onStage, onUndo, onReset, onCopyLink }: FieldRowProps) {
  const labelId = useId();
  const helpId = useId();
  const problemId = useId();
  const [problem, setProblem] = useState<string>();
  const editing = staged !== undefined;
  const value = editing ? staged : field.value;
  const resettable = !field.readOnlyReason && canReset(field, staged);
  const describedBy = [helpId, problem ? problemId : undefined].filter(Boolean).join(' ');
  return (
    <div className={`cf-field${editing ? ' is-pending' : ''}${linked ? ' is-linked' : ''}`} id={fieldDomId(field.key)} data-key={field.key} aria-current={linked ? 'location' : undefined}>
      <div className="cf-field__text">
        <div className="cf-field__label">
          {field.kind === 'list' || field.readOnlyReason || field.kind === 'boolean' || field.secret ? (
            <span id={labelId} className="cf-field__name">
              {field.label}
            </span>
          ) : (
            <label id={labelId} className="cf-field__name" htmlFor={`${fieldDomId(field.key)}-c`}>
              {field.label}
            </label>
          )}
          {field.modified && !editing && (
            <span className="tag" data-tone="info">
              Modified
            </span>
          )}
          {editing && (
            <span className="tag" data-tone="running">
              Unsaved
            </span>
          )}
          {field.restartRequired && (
            <span className="tag" data-tone="warning">
              <Icon name="refresh" small />
              Restart
            </span>
          )}
          {field.inProfile && <span className="tag">In profile</span>}
        </div>
        <code className="cf-field__key">{field.key}</code>
        <p className="cf-field__help" id={helpId}>
          {field.description}
          {field.description && ' '}
          {field.readOnlyReason ?? (field.restartRequired ? 'A gateway restart applies a change.' : '')}
          {!field.readOnlyReason && (field.modified || editing) && resettable && <span className="cf-field__default"> Default: {defaultText(field)}.</span>}
        </p>
        {problem && (
          <p className="field__error" id={problemId} role="alert">
            <Icon name="alert" small />
            {problem}
          </p>
        )}
      </div>
      <div className="cf-field__control">
        <Control field={field} value={value} labelId={labelId} describedBy={describedBy} onStage={(next) => onStage(field, next)} onUndo={() => onUndo(field)} onProblem={setProblem} />
      </div>
      <div className="cf-field__acts">
        {editing && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onUndo(field)}>
            Undo
          </button>
        )}
        {resettable && (
          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Reset ${field.label} to its default (${defaultText(field)})`} title="Reset to default" onClick={() => onReset(field)}>
            <Icon name="history" />
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Copy link to ${field.key}`} title="Copy link" onClick={() => onCopyLink(field)}>
          <Icon name="link" />
        </button>
      </div>
    </div>
  );
}
